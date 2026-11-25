import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, Circle, SpinnerGap, ArrowSquareOut, GoogleLogo } from '@phosphor-icons/react';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMcpStore } from '../../stores/mcpStore';
import { useOpenAiStore, codexReady } from '../../stores/openaiStore';
import { useAccountStore } from '../../stores/accountStore';
import { useT } from '../../lib/i18n';
import { stripAnsi } from '../../lib/strip-ansi';
import { AiAvatar } from '../shared/AiAvatar';
import { bridge, onDownloadProgress } from '../../lib/tauri-bridge';
import { startStep, afterWelcome, afterAssistant, afterSignIn, type Assistant } from '../../lib/onboarding';

const AUTH_POLL_MS = 2000;
const CLAUDE_UPGRADE_URL = 'https://claude.ai/upgrade';
const CHATGPT_PRICING_URL = 'https://chatgpt.com/pricing';
const PRIVACY_URL = 'https://stavebak.cz/privacy';

function openUrl(url: string) {
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => {});
}

/**
 * First-run onboarding. The user picks the assistant (Claude or ChatGPT, required)
 * and is offered the Stavebák account (can be skipped). Only the runtime of the
 * chosen assistant is installed (Claude Code or Codex), in the background, and it
 * only surfaces on failure. Users who already have everything never see a screen.
 */
export function SetupWizard() {
  const t = useT();
  const step = useSetupStore((s) => s.step);
  const cli = useSetupStore((s) => s.cli);
  const cliPercent = useSetupStore((s) => s.cliPercent);
  const error = useSetupStore((s) => s.error);
  const authStatus = useSetupStore((s) => s.authStatus);
  const accountName = useSetupStore((s) => s.accountName);
  const stavebakDone = useSetupStore((s) => s.stavebakDone);
  const setSetupCompleted = useSettingsStore((s) => s.setSetupCompleted);
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const openai = useOpenAiStore();

  const [waitingForLogin, setWaitingForLogin] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false);
  const [subscribeClicked, setSubscribeClicked] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const accountBusy = useAccountStore((s) => s.busy);
  const accountError = useAccountStore((s) => s.error);
  const accountStatus = useAccountStore((s) => s.status);

  const finish = useCallback(async () => {
    try {
      await useMcpStore.getState().ensureDefaultServer();
      useMcpStore.getState().checkHealth();
    } catch { /* MCP is verified again in settings diagnostics */ }
    setSetupCompleted(true);
  }, [setSetupCompleted]);

  const checkAuth = useCallback(async (): Promise<boolean> => {
    try {
      const auth = await bridge.checkClaudeAuth();
      const s = useSetupStore.getState();
      s.setAuthStatus(auth.authenticated ? 'ok' : 'missing');
      s.setAccountName(auth.account ?? null);
      return auth.authenticated;
    } catch {
      useSetupStore.getState().setAuthStatus('missing');
      return false;
    }
  }, []);

  const install = useCallback(async () => {
    const s = useSetupStore.getState();
    s.setCli('installing');
    s.setCliPercent(0);
    const unlisten = await onDownloadProgress((e) => useSetupStore.getState().setCliPercent(e.percent));
    try {
      await bridge.installClaudeCli();
      const status = await bridge.checkClaudeCli();
      if (!status.installed) throw new Error('CLI not found after download');
      useSetupStore.getState().setCliInfo(status.version ?? null, status.path ?? null);
      useSetupStore.getState().setCli('ready');
    } catch (err) {
      useSetupStore.getState().setCli('failed', stripAnsi(String(err)));
    } finally {
      unlisten();
    }
  }, []);

  // Detect on mount: fast path straight into the app, otherwise show welcome
  // and start installing the runtime in the background right away.
  useEffect(() => {
    let cancelled = false;
    // Dev harness: render a given screen without running detection
    const preview = import.meta.env.DEV ? (window as any).__onboardingPreview : undefined;
    if (preview) {
      useSetupStore.getState().setCli('ready');
      useSetupStore.getState().setStep(preview);
      return;
    }
    (async () => {
      const s = useSetupStore.getState();
      const stavebakOk = await bridge.stavebakAuthStatus().catch(() => false);
      s.setStavebakDone(stavebakOk);
      let installed = false;
      try {
        const status = await bridge.checkClaudeCli();
        installed = status.installed && !status.git_bash_missing;
        if (status.installed) s.setCliInfo(status.version ?? null, status.path ?? null);
      } catch { /* treated as not installed */ }
      if (cancelled) return;

      let claudeOk = false;
      if (installed) {
        s.setCli('ready');
        claudeOk = await checkAuth();
      } else {
        // Claude Code is downloaded only once the user picks Claude
        s.setCli('missing');
      }
      await useOpenAiStore.getState().refresh();
      if (cancelled) return;
      const assistantOk = useSettingsStore.getState().aiProvider === 'codex'
        ? codexReady(useOpenAiStore.getState())
        : claudeOk;
      const first = startStep({ assistantOk, stavebakOk });
      if (first === null) {
        await finish();
        return;
      }
      s.setStep(first);
    })();
    return () => { cancelled = true; };
  }, []);

  // Once the user started signing in, poll until the CLI reports a login.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (step !== 'claude' || !(waitingForLogin || subscribeClicked) || cli !== 'ready') return;
    pollRef.current = setInterval(async () => {
      if (await checkAuth()) {
        setWaitingForLogin(false);
        useSettingsStore.getState().setAiProvider('claude');
        useSetupStore.getState().setStep(afterSignIn({ stavebakOk: useSetupStore.getState().stavebakDone }));
      }
    }, AUTH_POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, waitingForLogin, subscribeClicked, cli, checkAuth]);

  // The CLI opens the browser itself. If it exits with an error, say so instead
  // of spinning forever; the terminal fallback also takes a pasted sign-in code.
  const handleLogin = useCallback(() => {
    setWaitingForLogin(true);
    setLoginFailed(false);
    bridge.startClaudeLogin().catch(async () => {
      if (await checkAuth()) return;
      setWaitingForLogin(false);
      setLoginFailed(true);
    });
  }, [checkAuth]);

  const handleTerminalLogin = useCallback(() => {
    setWaitingForLogin(true);
    setLoginFailed(false);
    bridge.openTerminalLogin().catch(() => {
      setWaitingForLogin(false);
      setLoginFailed(true);
    });
  }, []);

  const goNextFromWelcome = () => {
    useSetupStore.getState().setStep(afterWelcome());
  };

  // The assistant is chosen: install its runtime if needed, then sign in or go on.
  const chooseAssistant = async (chosen: Assistant) => {
    if (chosen === 'codex' && !useOpenAiStore.getState().codex) await useOpenAiStore.getState().refresh();
    const ready = chosen === 'claude' ? authStatus === 'ok' : codexReady(useOpenAiStore.getState());
    if (ready) useSettingsStore.getState().setAiProvider(chosen);
    if (chosen === 'claude' && ['missing', 'failed'].includes(useSetupStore.getState().cli)) install();
    if (chosen === 'codex' && !useOpenAiStore.getState().codex?.installed && useOpenAiStore.getState().installPercent === null) {
      useOpenAiStore.getState().installCodex();
    }
    useSetupStore.getState().setStep(afterAssistant(chosen, { assistantOk: ready, stavebakOk: stavebakDone }));
  };

  // ChatGPT: once Codex is installed and there is a way to pay (plan or API key), go on.
  const chatgptReady = codexReady(openai);
  useEffect(() => {
    if (step !== 'chatgpt' || !chatgptReady) return;
    useSettingsStore.getState().setAiProvider('codex');
    useSetupStore.getState().setStep(afterSignIn({ stavebakOk: useSetupStore.getState().stavebakDone }));
  }, [step, chatgptReady]);

  const loginStavebak = async () => {
    if (await useAccountStore.getState().login()) {
      useSetupStore.getState().setStavebakDone(true);
      useSetupStore.getState().setStep('done');
    }
  };

  if (step === 'checking') return null;

  return (
    <div className="w-full max-w-[400px] px-6 select-none">
      <div className="flex justify-center mb-6">
        <AiAvatar size="w-12 h-12" rounded="rounded-xl" />
      </div>

      {step === 'welcome' && (
        <>
          <Heading title={t('onb.welcome.title')} subtitle={t('onb.welcome.subtitle')} />
          <p className="text-xs text-text-tertiary mb-2">{t('onb.need')}</p>
          <Checklist claudeDone={aiProvider === 'codex' ? chatgptReady : authStatus === 'ok'} stavebakDone={stavebakDone} />
          <p className="text-xs text-text-tertiary leading-snug -mt-3 mb-6">{t('onb.how')}</p>
          <PrimaryButton onClick={goNextFromWelcome}>{t('onb.start')}</PrimaryButton>
        </>
      )}

      {step === 'assistant' && (
        <>
          <StepLabel n={1} />
          <Heading title={t('onb.assistant.title')} subtitle={t('onb.assistant.desc')} />
          <div className="space-y-2 mb-4">
            <AssistantOption
              name="Claude"
              desc={t('onb.assistant.claude')}
              ready={authStatus === 'ok'}
              onClick={() => { chooseAssistant('claude'); }}
            />
            <AssistantOption
              name="ChatGPT"
              desc={t('onb.assistant.chatgpt')}
              ready={codexReady(openai)}
              onClick={() => { chooseAssistant('codex'); }}
            />
          </div>
          <p className="text-xs text-text-tertiary leading-snug text-center">{t('onb.assistant.later')}</p>
        </>
      )}

      {step === 'chatgpt' && (
        <>
          <StepLabel n={1} />
          <Heading title={t('onb.chatgpt.title')} subtitle={t('onb.chatgpt.desc')} />
          <p className="text-xs text-text-tertiary leading-snug mb-4 text-center">
            {t('settings.chatgptPrivacy')}{' '}
            <button onClick={() => openUrl(PRIVACY_URL)}
              className="underline underline-offset-2 hover:text-text-primary cursor-pointer">
              {t('onb.chatgpt.privacy')}
            </button>
          </p>
          <ChatGptSignIn />
          <BackToAssistant />
        </>
      )}

      {step === 'claude' && (
        <>
          <StepLabel n={1} />
          <Heading title={t('onb.claude.title')} subtitle={t('onb.claude.desc')} />
          <p className="text-xs text-text-tertiary leading-snug mb-4 text-center">{t('onb.claude.why')}</p>

          {cli === 'failed' ? (
            <div className="space-y-3">
              <p className="text-sm text-text-primary">{t('onb.prepareFailed')}</p>
              <PrimaryButton onClick={install}>{t('onb.retry')}</PrimaryButton>
              <button onClick={() => setShowDetails(!showDetails)}
                className="block mx-auto text-xs text-text-tertiary hover:text-text-primary">
                {t('onb.details')}
              </button>
              {showDetails && error && (
                <pre className="text-xs text-text-muted font-mono whitespace-pre-wrap break-all
                  bg-bg-secondary rounded-md px-3 py-2 max-h-32 overflow-y-auto">{error}</pre>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <PrimaryButton onClick={handleLogin} disabled={cli !== 'ready' || waitingForLogin}>
                {t('onb.claude.login')}
              </PrimaryButton>
              <SecondaryButton onClick={() => { setSubscribeClicked(true); openUrl(CLAUDE_UPGRADE_URL); }}>
                <ArrowSquareOut size={13} />
                {t('onb.claude.subscribe')}
              </SecondaryButton>
              <div className="min-h-5 pt-2 text-center text-xs text-text-tertiary">
                {cli !== 'ready' ? (
                  <Status>{t('onb.preparing')}{cliPercent > 0 ? ` ${cliPercent} %` : ''}</Status>
                ) : waitingForLogin ? (
                  <Status>{t('onb.claude.waiting')}</Status>
                ) : loginFailed ? (
                  <span className="text-text-primary">{t('onb.claude.failed')}</span>
                ) : subscribeClicked ? (
                  t('onb.claude.subscribeHint')
                ) : null}
              </div>
              {cli === 'ready' && (waitingForLogin || loginFailed) && (
                <button onClick={handleTerminalLogin}
                  className="block mx-auto text-xs text-text-tertiary hover:text-text-primary underline underline-offset-2">
                  {t('onb.claude.terminal')}
                </button>
              )}
            </div>
          )}
          <BackToAssistant />
        </>
      )}

      {step === 'stavebak' && (
        <>
          <StepLabel n={2} />
          <Heading title={t('onb.stavebak.title')} subtitle={t('onb.stavebak.desc')} />
          <div className="rounded-lg border border-border px-4 py-3 mb-4 text-xs text-text-tertiary leading-snug">
            <div className="text-sm text-text-primary mb-0.5">{t('onb.stavebak.trialTitle')}</div>
            {t('onb.stavebak.trialDesc')}
          </div>
          <div className="space-y-2">
            <SecondaryButton onClick={loginStavebak} disabled={accountBusy}>
              <GoogleLogo size={14} weight="bold" />
              {t('onb.stavebak.google')}
            </SecondaryButton>
            <div className="min-h-5 pt-1 text-center text-xs text-text-tertiary">
              {accountBusy ? <Status>{t('onb.stavebak.waiting')}</Status>
                : accountError ? <span className="text-text-primary">{t('onb.stavebak.failed')}</span> : null}
            </div>
            <button onClick={() => useSetupStore.getState().setStep('done')}
              className="block mx-auto text-xs text-text-tertiary hover:text-text-primary cursor-pointer">
              {t('onb.stavebak.later')}
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <>
          <Heading title={t('onb.done.title')} subtitle={t('onb.done.desc')} />
          <Checklist
            claudeDone={aiProvider === 'codex' ? chatgptReady : authStatus === 'ok'}
            stavebakDone={stavebakDone}
            claudeNote={assistantNote(aiProvider, accountName, openai.status, t)}
            stavebakNote={accountStatus?.plan === 'trial'
              ? t('onb.stavebak.trialUntil').replace('{date}', new Date(accountStatus.trialEndsAt).toLocaleDateString('cs-CZ'))
              : undefined}
          />
          <PrimaryButton onClick={finish}>{t('onb.done.cta')}</PrimaryButton>
        </>
      )}
    </div>
  );
}

/* ================================================================
   Pieces
   ================================================================ */

/** Na kroku Hotovo: kdo je přihlášený u vybraného asistenta. */
function assistantNote(
  provider: Assistant,
  claudeAccount: string | null,
  openaiStatus: ReturnType<typeof useOpenAiStore.getState>['status'],
  t: (key: string) => string,
): string | undefined {
  if (provider === 'claude') {
    return claudeAccount ? `Claude · ${t('onb.signedInAs').replace('{account}', claudeAccount)}` : undefined;
  }
  if (openaiStatus?.chatgpt_signed_in) {
    return `ChatGPT · ${t('onb.signedInAs').replace('{account}', openaiStatus.chatgpt_email ?? 'ChatGPT')}`;
  }
  return openaiStatus?.api_key_set ? `ChatGPT · ${t('asst.chatgpt.viaKey')}` : undefined;
}

function BackToAssistant() {
  const t = useT();
  return (
    <button onClick={() => useSetupStore.getState().setStep('assistant')}
      className="block mx-auto mt-4 text-xs text-text-tertiary hover:text-text-primary cursor-pointer">
      {t('onb.assistant.back')}
    </button>
  );
}

function AssistantOption({ name, desc, ready, onClick }: { name: string; desc: string; ready: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button onClick={onClick}
      className="w-full text-left rounded-lg border border-border px-4 py-3 hover:bg-bg-secondary cursor-pointer flex gap-3 items-start">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">{name}</div>
        <div className="text-xs text-text-tertiary mt-0.5 leading-snug">{desc}</div>
      </div>
      {ready && (
        <span className="inline-flex items-center gap-1 text-xs text-[#0F766E] flex-shrink-0 mt-0.5">
          <CheckCircle size={14} weight="fill" />{t('asst.signedIn')}
        </span>
      )}
    </button>
  );
}

/**
 * Přihlášení k ChatGPT: hlavně „Continue with ChatGPT“ (plán ChatGPT), méně výrazně API klíč OpenAI.
 * Codex se mezitím stahuje na pozadí; dál se jde, až je stažený a je čím platit.
 */
function ChatGptSignIn() {
  const t = useT();
  const { status, codex, busy, error, installPercent, loginChatgpt, installCodex, setApiKey } = useOpenAiStore();
  const [keyOpen, setKeyOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const signedIn = !!status && (status.chatgpt_signed_in || status.api_key_set);
  const installFailed = !codex?.installed && installPercent === null && !!error;

  return (
    <div className="space-y-2">
      {status?.siwc_available !== false && (
        <PrimaryButton onClick={() => { loginChatgpt(); }} disabled={busy || signedIn}>
          {t('chatgpt.continue')}
        </PrimaryButton>
      )}
      <SecondaryButton onClick={() => openUrl(CHATGPT_PRICING_URL)}>
        <ArrowSquareOut size={13} />
        {t('onb.chatgpt.subscribe')}
      </SecondaryButton>
      <div className="min-h-5 pt-2 text-center text-xs text-text-tertiary">
        {busy ? (
          <Status>{t('onb.claude.waiting')}</Status>
        ) : installPercent !== null ? (
          <Status>{t('onb.preparing')}{installPercent > 0 ? ` ${installPercent} %` : ''}</Status>
        ) : installFailed ? (
          <span className="text-text-primary">{t('onb.prepareFailed')}</span>
        ) : error ? (
          <span className="text-text-primary">{t('onb.chatgpt.failed')}</span>
        ) : null}
      </div>
      {installFailed && (
        <PrimaryButton onClick={() => { installCodex(); }}>{t('onb.retry')}</PrimaryButton>
      )}
      {error && (
        <>
          <button onClick={() => setShowDetails(!showDetails)}
            className="block mx-auto text-xs text-text-tertiary hover:text-text-primary cursor-pointer">
            {t('onb.details')}
          </button>
          {showDetails && (
            <pre className="text-xs text-text-muted font-mono whitespace-pre-wrap break-all
              bg-bg-secondary rounded-lg px-3 py-2 max-h-32 overflow-y-auto">{error}</pre>
          )}
        </>
      )}
      {!signedIn && (
        keyOpen ? (
          <div className="pt-2 space-y-2">
            <p className="text-xs text-text-tertiary leading-snug">{t('onb.chatgpt.keyHint')}</p>
            <div className="flex items-center gap-2">
              <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="sk-…" autoComplete="off" spellCheck={false}
                className="flex-1 h-9 text-sm bg-transparent border border-border rounded-lg px-3 text-text-primary" />
              <button disabled={busy || !draft.trim()}
                onClick={async () => { if (await setApiKey(draft.trim())) setDraft(''); }}
                className="h-9 px-3 rounded-lg text-sm text-text-primary border border-border hover:bg-bg-secondary
                  disabled:opacity-40 disabled:cursor-default cursor-pointer">
                {t('settings.apiKeySave')}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setKeyOpen(true)}
            className="block mx-auto text-xs text-text-tertiary hover:text-text-primary underline underline-offset-2 cursor-pointer">
            {t('onb.chatgpt.useKey')}
          </button>
        )
      )}
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center mb-6">
      <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
      <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{subtitle}</p>
    </div>
  );
}

function StepLabel({ n }: { n: number }) {
  return <p className="text-center text-xs text-text-tertiary mb-2 tabular-nums">{n} / 2</p>;
}

function Checklist({ claudeDone, stavebakDone, claudeNote, stavebakNote }: {
  claudeDone: boolean;
  stavebakDone: boolean;
  claudeNote?: string;
  stavebakNote?: string;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-border divide-y divide-border-subtle mb-6">
      <ChecklistItem done={claudeDone} title={t('onb.claude.item')} desc={claudeNote ?? t('onb.claude.itemDesc')} />
      <ChecklistItem done={stavebakDone} title={t('onb.stavebak.item')} desc={stavebakNote ?? t('onb.stavebak.itemDesc')} />
    </div>
  );
}

function ChecklistItem({ done, title, desc }: { done: boolean; title: string; desc: string }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      {done
        ? <CheckCircle size={16} weight="fill" className="text-[#0F766E] mt-0.5 flex-shrink-0" />
        : <Circle size={16} className="text-text-tertiary mt-0.5 flex-shrink-0" />}
      <div className="min-w-0">
        <div className="text-sm text-text-primary">{title}</div>
        <div className="text-xs text-text-tertiary mt-0.5 leading-snug">{desc}</div>
      </div>
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SpinnerGap size={12} className="animate-spin" />
      {children}
    </span>
  );
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-9 rounded-lg text-sm font-medium text-white send-button
        disabled:opacity-40 disabled:cursor-default cursor-pointer"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-9 rounded-lg text-sm text-text-primary border border-border
        hover:bg-bg-secondary flex items-center justify-center gap-2 cursor-pointer
        disabled:opacity-40 disabled:cursor-default"
    >
      {children}
    </button>
  );
}

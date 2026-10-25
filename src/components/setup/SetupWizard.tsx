import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, Circle, SpinnerGap, ArrowSquareOut, GoogleLogo } from '@phosphor-icons/react';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMcpStore } from '../../stores/mcpStore';
import { useAccountStore } from '../../stores/accountStore';
import { useT } from '../../lib/i18n';
import { stripAnsi } from '../../lib/strip-ansi';
import { AiAvatar } from '../shared/AiAvatar';
import { bridge, onDownloadProgress } from '../../lib/tauri-bridge';
import { startStep, nextStep } from '../../lib/onboarding';

const AUTH_POLL_MS = 2000;
const CLAUDE_UPGRADE_URL = 'https://claude.ai/upgrade';

function openUrl(url: string) {
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => {});
}

/**
 * First-run onboarding. The user sees two plain-language requirements
 * (Claude subscription, Stavebák account); installing the Claude Code
 * runtime happens silently in the background and only surfaces on failure.
 * Users who already have everything never see a screen.
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

  const [waitingForLogin, setWaitingForLogin] = useState(false);
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
        install();
      }
      if (cancelled) return;
      const first = startStep({ claudeOk, stavebakOk });
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
        useSetupStore.getState().setStep(nextStep({ claudeOk: true, stavebakOk: useSetupStore.getState().stavebakDone }));
      }
    }, AUTH_POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, waitingForLogin, subscribeClicked, cli, checkAuth]);

  const handleLogin = useCallback(() => {
    setWaitingForLogin(true);
    bridge.startClaudeLogin().catch(() => { /* login continues in the browser */ });
  }, []);

  const goNextFromWelcome = () => {
    useSetupStore.getState().setStep(nextStep({ claudeOk: authStatus === 'ok', stavebakOk: stavebakDone }));
  };

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
          <Checklist claudeDone={authStatus === 'ok'} stavebakDone={stavebakDone} />
          <p className="text-xs text-text-tertiary leading-snug -mt-3 mb-6">{t('onb.how')}</p>
          <PrimaryButton onClick={goNextFromWelcome}>{t('onb.start')}</PrimaryButton>
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
              <div className="h-5 pt-2 text-center text-xs text-text-tertiary">
                {cli !== 'ready' ? (
                  <Status>{t('onb.preparing')}{cliPercent > 0 ? ` ${cliPercent} %` : ''}</Status>
                ) : waitingForLogin ? (
                  <Status>{t('onb.claude.waiting')}</Status>
                ) : subscribeClicked ? (
                  t('onb.claude.subscribeHint')
                ) : null}
              </div>
            </div>
          )}
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
          </div>
        </>
      )}

      {step === 'done' && (
        <>
          <Heading title={t('onb.done.title')} subtitle={t('onb.done.desc')} />
          <Checklist
            claudeDone={authStatus === 'ok'}
            stavebakDone={stavebakDone}
            claudeNote={accountName ? t('onb.signedInAs').replace('{account}', accountName) : undefined}
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

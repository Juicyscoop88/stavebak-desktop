import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle, CaretRight } from '@phosphor-icons/react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useOpenAiStore, codexReady } from '../../stores/openaiStore';
import { bridge, type AiProvider } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';
const CLAUDE_BILLING_URL = 'https://claude.ai/settings/billing';

function openUrl(url: string) {
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => {});
}

const smallButton = `px-2.5 py-1 rounded-md text-xs border border-border
  text-text-secondary hover:text-text-primary hover:bg-bg-secondary disabled:opacity-40 cursor-pointer`;

/**
 * Výběr asistenta pro projektanty: dvě karty (Claude, ChatGPT) s tím, co to znamená, kolik to stojí
 * a proč je to v pořádku. Bez technických pojmů; API klíč je schovaný v Pokročilých.
 */
export function AssistantSection() {
  const t = useT();
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const setAiProvider = useSettingsStore((s) => s.setAiProvider);
  const openai = useOpenAiStore();
  const [claude, setClaude] = useState<{ ok: boolean; label: string | null } | null>(null);

  useEffect(() => {
    openai.refresh();
    bridge.checkClaudeAuth()
      .then((a) => {
        const plan = a.subscription ? a.subscription.charAt(0).toUpperCase() + a.subscription.slice(1) : null;
        setClaude({ ok: a.authenticated, label: [a.account, plan].filter(Boolean).join(' · ') || null });
      })
      .catch(() => setClaude({ ok: false, label: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chatgptReady = codexReady(openai);
  const choose = async (p: AiProvider) => {
    if (p === 'codex' && !chatgptReady) {
      if (!openai.codex?.installed) await openai.installCodex();
      if (!useOpenAiStore.getState().status?.chatgpt_signed_in && !useOpenAiStore.getState().status?.api_key_set) {
        if (!(await openai.loginChatgpt())) return;
      }
    }
    setAiProvider(p);
  };

  const plan = openai.status?.chatgpt_plan;
  const chatgptStatus = openai.status?.chatgpt_signed_in
    ? [openai.status.chatgpt_email, plan && plan.charAt(0).toUpperCase() + plan.slice(1)].filter(Boolean).join(' · ')
    : openai.status?.api_key_set ? t('asst.chatgpt.viaKey') : t('asst.notSignedIn');

  return (
    <section className="py-4 border-b border-border-subtle">
      <h3 className="text-xs font-medium text-text-tertiary mb-1">{t('asst.title')}</h3>
      <p className="text-xs text-text-tertiary leading-snug mb-3">{t('asst.intro')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ProviderCard
          name="Claude"
          maker={t('asst.claude.maker')}
          selected={aiProvider === 'claude'}
          status={claude?.ok ? (claude.label ?? t('asst.signedIn')) : claude ? t('asst.notSignedIn') : '…'}
          points={[t('asst.claude.p1'), t('asst.claude.p2')]}
          onSelect={() => { choose('claude'); }}
          selectLabel={t('asst.use')}
          selectedLabel={t('asst.inUse')}
          actions={claude?.ok ? (
            <button className={smallButton} onClick={() => openUrl(CLAUDE_BILLING_URL)}>{t('asst.manageSub')}</button>
          ) : claude ? (
            <button className={smallButton} onClick={() => { bridge.startClaudeLogin().catch(() => {}); }}>{t('asst.signIn')}</button>
          ) : null}
        />
        <ProviderCard
          name="ChatGPT"
          maker={t('asst.chatgpt.maker')}
          selected={aiProvider === 'codex'}
          status={chatgptStatus}
          points={[t('asst.chatgpt.p1'), t('asst.chatgpt.p2'), t('asst.chatgpt.p3')]}
          onSelect={() => { choose('codex'); }}
          selectLabel={openai.installPercent !== null ? `${t('asst.preparing')} ${openai.installPercent} %` : t('asst.use')}
          selectedLabel={t('asst.inUse')}
          busy={openai.busy || openai.installPercent !== null}
          actions={openai.status?.chatgpt_signed_in ? (
            <>
              <button className={smallButton} onClick={() => openUrl(MANAGE_USAGE_URL)}>{t('chatgpt.manageUsage')}</button>
              <button className={smallButton} disabled={openai.busy} onClick={() => { openai.logoutChatgpt(); }}>{t('settings.signOut')}</button>
            </>
          ) : openai.status?.siwc_available ? (
            <button className={smallButton} disabled={openai.busy} onClick={() => { openai.loginChatgpt(); }}>{t('chatgpt.continue')}</button>
          ) : (
            <span className="text-xs text-text-tertiary">{t('asst.chatgpt.soon')}</span>
          )}
        />
      </div>
      {openai.error && <p className="pt-2 text-xs text-text-primary leading-snug">{openai.error}</p>}

      <Disclosure title={t('asst.how.title')}>
        <ul className="space-y-1.5 list-disc pl-4">
          <li>{t('asst.how.1')}</li>
          <li>{t('asst.how.2')}</li>
          <li>{t('asst.how.3')}</li>
          <li>{t('asst.how.4')}</li>
          <li>{t('asst.how.5')}</li>
        </ul>
      </Disclosure>

      <Disclosure title={t('asst.key.title')}>
        <ApiKeyBox />
      </Disclosure>
    </section>
  );
}

function ProviderCard({ name, maker, selected, status, points, onSelect, selectLabel, selectedLabel, actions, busy }: {
  name: string;
  maker: string;
  selected: boolean;
  status: string;
  points: string[];
  onSelect: () => void;
  selectLabel: string;
  selectedLabel: string;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3.5 flex flex-col gap-2.5
      ${selected ? 'border-[#0F766E] bg-[#0F766E]/[0.04]' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-text-primary">{name}</div>
          <div className="text-xs text-text-tertiary">{maker}</div>
        </div>
        {selected ? (
          <span className="inline-flex items-center gap-1 text-xs text-[#0F766E] font-medium">
            <CheckCircle size={14} weight="fill" />{selectedLabel}
          </span>
        ) : (
          <button className={smallButton} disabled={busy} onClick={onSelect}>{selectLabel}</button>
        )}
      </div>
      <div className="text-xs text-text-secondary truncate">{status}</div>
      <ul className="space-y-1 text-xs text-text-tertiary leading-snug">
        {points.map((p) => <li key={p}>{p}</li>)}
      </ul>
      {actions && <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div>}
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary cursor-pointer">
        <CaretRight size={10} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
      </button>
      {open && <div className="mt-2 pl-3.5 text-xs text-text-tertiary leading-relaxed">{children}</div>}
    </div>
  );
}

/** API klíč OpenAI: vysvětlení lidsky, pak pole. */
function ApiKeyBox() {
  const t = useT();
  const { status, busy, setApiKey, clearApiKey } = useOpenAiStore();
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2">
      <p>{t('asst.key.what')}</p>
      <p>{t('asst.key.when')}</p>
      <p>{t('asst.key.safe')}</p>
      {status?.api_key_set ? (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-text-secondary">{t('settings.openaiApiKeySet')}</span>
          <button className={smallButton} onClick={() => { clearApiKey(); }}>{t('settings.apiKeyRemove')}</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-…" autoComplete="off" spellCheck={false}
            className="w-48 text-xs bg-transparent border border-border rounded-md px-2 py-1 text-text-primary" />
          <button className={smallButton} disabled={busy || !draft.trim()}
            onClick={async () => { if (await setApiKey(draft)) setDraft(''); }}>
            {t('settings.apiKeySave')}
          </button>
        </div>
      )}
    </div>
  );
}

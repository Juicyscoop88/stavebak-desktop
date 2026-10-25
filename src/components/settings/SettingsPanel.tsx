import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { X, CaretRight } from '@phosphor-icons/react';
import { useSettingsStore, MODEL_OPTIONS, type Locale } from '../../stores/settingsStore';
import { useAccountStore } from '../../stores/accountStore';
import { useMcpStore } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';
import { APP_NAME } from '../../lib/edition';
import { bridge } from '../../lib/tauri-bridge';
import { ChangelogModal } from '../shared/ChangelogModal';
import { isPermissionError, isNetworkError } from './settingsUtils';

const LANGUAGE_OPTIONS: { id: Locale; label: string }[] = [
  { id: 'cs', label: 'Čeština' },
  { id: 'sk', label: 'Slovenčina' },
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];

export function SettingsPanel() {
  const t = useT();
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSettings();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSettings]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) toggleSettings(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Panel */}
      <div className="relative w-[min(92vw,600px)] max-h-[85vh]
        rounded-xl bg-bg-card border border-border shadow-lg
        overflow-hidden flex flex-col"
        {...(import.meta.env.DEV && { 'data-testid': 'settings-panel' })}>

        {/* Header */}
        <div className="flex items-center justify-between h-12 pl-6 pr-3
          border-b border-border-subtle flex-shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">
            {t('settings.title')}
          </h2>
          <button onClick={toggleSettings}
            {...(import.meta.env.DEV && { 'data-testid': 'settings-close-button' })}
            className="p-1.5 rounded-md hover:bg-bg-tertiary text-text-tertiary">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          <AccountsSection />
          <AppearanceSection />
          <FilesSection />
          <AdvancedSection />
        </div>

        {/* Footer: version + update */}
        <SettingsFooter />
      </div>
    </div>
  );
}

/* ================================================================
   Layout primitives — one label column, one control column
   ================================================================ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-4 border-b border-border-subtle last:border-b-0">
      <h3 className="text-xs font-medium text-text-tertiary mb-1">{title}</h3>
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        {description && (
          <div className="text-xs text-text-tertiary mt-0.5 leading-snug">{description}</div>
        )}
      </div>
      {children && <div className="flex-shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded text-xs whitespace-nowrap
            ${value === o.id
              ? 'bg-bg-tertiary text-text-primary font-medium'
              : 'text-text-muted hover:text-text-primary'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-[18px] rounded-full flex-shrink-0
        ${checked ? 'bg-[#0F766E]' : 'bg-bg-tertiary border border-border'}`}
    >
      <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow-sm
        ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
    </button>
  );
}

const linkButton = `px-2.5 py-1 rounded-md text-xs border border-border
  text-text-secondary hover:text-text-primary hover:bg-bg-secondary`;

/* ================================================================
   Sections
   ================================================================ */

function AccountsSection() {
  const t = useT();
  const [account, setAccount] = useState<{ authenticated: boolean; email: string | null } | null>(null);

  useEffect(() => {
    bridge.checkClaudeAuth()
      .then((a) => {
        const plan = a.subscription ? a.subscription.charAt(0).toUpperCase() + a.subscription.slice(1) : null;
        const label = [a.account, plan].filter(Boolean).join(' · ') || null;
        setAccount({ authenticated: a.authenticated, email: label });
      })
      .catch(() => setAccount({ authenticated: false, email: null }));
  }, []);

  const openUrl = (url: string) => {
    import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => {});
  };

  return (
    <Section title={t('settings.accounts')}>
      <Row
        label={t('settings.claudeAccount')}
        description={account?.authenticated
          ? (account.email ?? t('settings.claudeAccountDesc'))
          : account ? t('settings.notSignedIn') : t('settings.claudeAccountDesc')}
      >
        {account?.authenticated ? (
          <button className={linkButton} onClick={() => openUrl('https://claude.ai/settings/billing')}>
            {t('settings.manage')}
          </button>
        ) : account ? (
          <button className={linkButton} onClick={() => { bridge.startClaudeLogin().catch(() => {}); }}>
            {t('settings.signIn')}
          </button>
        ) : null}
      </Row>
      <StavebakAccountRow linkButton={linkButton} />
    </Section>
  );
}

/** Účet Stavebák: přihlášení a tarif z account_status, platba přes upgrade (stejné tooly jako model). */
function StavebakAccountRow({ linkButton }: { linkButton: string }) {
  const t = useT();
  const { signedIn, status, busy, error, refresh, login, logout, openBilling } = useAccountStore();
  useEffect(() => { refresh(); }, [refresh]);

  const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('cs-CZ') : '');
  const description = !signedIn
    ? (signedIn === false ? t('settings.stavebakSignedOut') : '…')
    : !status ? (error ? t('settings.stavebakError') : '…')
    : status.plan === 'trial' ? t('settings.stavebakTrial').replace('{date}', date(status.trialEndsAt))
    : status.plan === 'pro' ? t('settings.stavebakPro').replace('{date}', date(status.currentPeriodEnd))
    : t('settings.stavebakFree');

  return (
    <Row label={t('settings.stavebakAccount')} description={description}>
      {signedIn === false && (
        <button className={linkButton} disabled={busy} onClick={() => { login(); }}>{t('settings.signIn')}</button>
      )}
      {signedIn && status && (
        <button className={linkButton} disabled={busy} onClick={() => { openBilling(); }}>
          {status.plan === 'pro' ? t('settings.manage') : t('settings.stavebakBuy')}
        </button>
      )}
      {signedIn && (
        <button className={linkButton} onClick={() => { logout(); }}>{t('settings.signOut')}</button>
      )}
    </Row>
  );
}

function AppearanceSection() {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

  return (
    <Section title={t('settings.appearance')}>
      <Row label={t('settings.colorMode')}>
        <Segmented
          value={theme}
          onChange={setTheme}
          options={(['light', 'dark', 'system'] as const).map((m) => ({ id: m, label: t(`settings.${m}`) }))}
        />
      </Row>
      <Row label={t('settings.language')}>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="text-xs bg-transparent border border-border rounded-md px-2 py-1
            text-text-primary cursor-pointer"
        >
          {LANGUAGE_OPTIONS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </Row>
    </Section>
  );
}

function FilesSection() {
  const t = useT();
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const setSessionMode = useSettingsStore((s) => s.setSessionMode);

  return (
    <Section title={t('settings.files')}>
      <Row label={t('settings.askBeforeEdit')} description={t('settings.askBeforeEditDesc')}>
        <Toggle
          checked={sessionMode === 'ask'}
          onChange={(on) => setSessionMode(on ? 'ask' : 'bypass')}
        />
      </Row>
    </Section>
  );
}

function AdvancedSection() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const mcpHealth = useMcpStore((s) => s.healthStatus);
  const [cli, setCli] = useState<{ version: string | null; path: string | null } | null>(null);
  const [copied, setCopied] = useState(false);


  useEffect(() => {
    if (!open) return;
    bridge.checkClaudeCli()
      .then((s) => setCli({ version: s.version, path: s.path }))
      .catch(() => setCli({ version: null, path: null }));
    useMcpStore.getState().checkHealth();
  }, [open]);

  const mcpLabel = mcpHealth === 'ok' ? t('settings.diagOk')
    : mcpHealth === 'error' ? t('settings.diagError')
    : t('settings.diagUnknown');

  const copyDiagnostics = useCallback(() => {
    const lines = [
      `${APP_NAME} ${navigator.userAgent.includes('Mac') ? 'macOS' : navigator.platform}`,
      `Claude Code: ${cli?.version ?? 'n/a'} (${cli?.path ?? 'n/a'})`,
      `Stavebák server: ${mcpHealth}`,
      `Model: ${selectedModel}`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [cli, mcpHealth, selectedModel]);

  return (
    <section className="py-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs font-medium text-text-tertiary hover:text-text-primary"
      >
        <CaretRight size={10} className={open ? 'rotate-90' : ''} />
        {t('settings.advanced')}
      </button>
      {open && (
        <div className="mt-1 divide-y divide-border-subtle">
          <Row label={t('settings.defaultModel')}>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as typeof selectedModel)}
              className="text-xs bg-transparent border border-border rounded-md px-2 py-1
                text-text-primary cursor-pointer"
            >
              {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Row>
          <Row
            label={t('settings.diagClaude')}
            description={cli ? (cli.version ? `${cli.version} · ${cli.path ?? ''}` : t('settings.diagMissing')) : '…'}
          />
          <Row label={t('settings.diagStavebak')} description={mcpLabel}>
            <span className={`w-1.5 h-1.5 rounded-full ${mcpHealth === 'ok' ? 'bg-success' : mcpHealth === 'error' ? 'bg-error' : 'bg-text-tertiary'}`} />
          </Row>
          <Row label={t('settings.diagnostics')}>
            <button className={linkButton} onClick={copyDiagnostics}>
              {copied ? t('settings.copied') : t('settings.copyDiagnostics')}
            </button>
          </Row>
        </div>
      )}
    </section>
  );
}

/* ================================================================
   Footer with version + update controls
   ================================================================ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpdateHandle = any;
type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

function SettingsFooter() {
  const t = useT();
  const [appVersion, setAppVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateHandle>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [showChangelog, setShowChangelog] = useState(false);
  const storeUpdateVersion = useSettingsStore((s) => s.updateVersion);

  useEffect(() => {
    import('@tauri-apps/api/app').then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => {})
    );
  }, []);

  // Bridge auto-check result: if store has an update version, pre-fill
  useEffect(() => {
    if (storeUpdateVersion && status === 'idle') {
      import('@tauri-apps/plugin-updater').then(({ check }) =>
        check().then((update) => {
          if (update) {
            setUpdateInfo(update);
            setStatus('available');
          }
        }).catch(() => {})
      );
    }
  }, [storeUpdateVersion]);

  const handleCheck = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        setUpdateInfo(update);
        setStatus('available');
      } else {
        setStatus('latest');
        setTimeout(() => setStatus('idle'), 3000);
      }
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!updateInfo) return;
    setStatus('downloading');
    setProgress(0);
    try {
      let totalLen = 0;
      let downloaded = 0;
      await updateInfo.downloadAndInstall((event: { event: string; data: { contentLength?: number; chunkLength: number } }) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) setProgress(Math.round((downloaded / totalLen) * 100));
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });
      setStatus('ready');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, [updateInfo]);

  const handleRestart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }, []);

  return (
    <>
      <div className="flex items-center justify-between px-6 h-10
        border-t border-border-subtle bg-bg-secondary/30 flex-shrink-0">
        {/* Left: version */}
        <span className="text-xs text-text-tertiary flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 171 171" fill="none" className="flex-shrink-0 opacity-60">
            <path d="M66.79 58.73L40.33 85.19L66.79 111.66L57.53 120.92L21.8 85.19L57.53 49.47Z" fill="currentColor" />
            <path d="M111.5 49.47L147.22 85.19L111.5 120.92L102.24 111.66L128.7 85.19L102.24 58.73Z" fill="currentColor" />
            <path d="M90.01 39.92L102.01 39.92L79.24 129.92L67.24 129.92L79.24 81.92Z" className="fill-accent" />
          </svg>
          {APP_NAME} {appVersion ? `v${appVersion}` : '...'}
        </span>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2">
          {/* Changelog */}
          <button
            onClick={() => setShowChangelog(true)}
            className="px-2.5 py-1 text-xs font-medium rounded-md
              text-text-muted hover:bg-bg-secondary hover:text-text-primary transition-smooth"
          >
            {t('settings.footer.changelog')}
          </button>

          {/* Update controls — inline in footer */}
          {status === 'idle' && (
            <button
              onClick={handleCheck}
              className="px-2.5 py-1 text-xs font-medium rounded-md
                border border-border-subtle text-text-muted
                hover:bg-bg-secondary hover:text-text-primary transition-smooth"
            >
              {t('settings.footer.checkUpdate')}
            </button>
          )}

          {status === 'checking' && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-3 h-3 border-[1.5px] border-accent/30
                border-t-accent rounded-full animate-spin" />
              {t('update.checking')}
            </span>
          )}

          {status === 'latest' && (
            <span className="text-xs text-green-500 font-medium">
              {t('settings.footer.upToDate')}
            </span>
          )}

          {status === 'available' && updateInfo && (
            <button
              onClick={handleDownload}
              className="px-2.5 py-1 text-xs font-medium rounded-md
                bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
            >
              {t('update.install')} v{updateInfo.version}
            </button>
          )}

          {status === 'downloading' && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-3 h-3 border-[1.5px] border-accent/30
                border-t-accent rounded-full animate-spin" />
              {t('update.downloading')} {progress}%
            </span>
          )}

          {status === 'ready' && (
            <button
              onClick={handleRestart}
              className="px-2.5 py-1 text-xs font-medium rounded-md
                bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
            >
              {t('update.restart')}
            </button>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-500" title={errorMsg}>
                {t('update.error')}
              </span>
              {isPermissionError(errorMsg) && (
                <span className="text-xs text-amber-500">
                  {t('error.permissionHint')}
                </span>
              )}
              {isNetworkError(errorMsg) && (
                <span className="text-xs text-amber-500">
                  {t('network.firewallHint')}
                </span>
              )}
              <button
                onClick={handleCheck}
                className="px-2 py-0.5 text-xs text-text-muted hover:text-text-primary transition-smooth"
              >
                {t('cli.retry')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Changelog modal */}
      {showChangelog && appVersion && (
        <ChangelogModal
          version={appVersion}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </>
  );
}

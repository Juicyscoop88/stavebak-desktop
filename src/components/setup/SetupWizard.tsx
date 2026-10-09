import { useEffect, useCallback, useState } from 'react';
import { CheckCircle, Warning, DownloadSimple, ArrowSquareOut } from '@phosphor-icons/react';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';
import { stripAnsi } from '../../lib/strip-ansi';
import { AiAvatar } from '../shared/AiAvatar';
import {
  bridge,
  onDownloadProgress,
} from '../../lib/tauri-bridge';
import { useMcpStore } from '../../stores/mcpStore';

function isPermissionError(msg: string): boolean {
  const hints = ['EPERM', 'EACCES', 'permission denied', 'access denied',
    'Access is denied', 'operation not permitted'];
  const lower = msg.toLowerCase();
  return hints.some(h => lower.includes(h.toLowerCase()));
}

function isNetworkError(msg: string): boolean {
  if (isPermissionError(msg)) return false;
  const lower = msg.toLowerCase();
  if (lower.includes('local extraction') || lower.includes('not a network issue')) return false;
  const hints = ['timeout', 'timed out', 'network', 'connect', 'ENOTFOUND',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'fetch', 'Failed to download',
    'All install methods failed', 'dns', 'certificate'];
  return hints.some(h => lower.includes(h.toLowerCase()));
}

export function SetupWizard() {
  const t = useT();
  const step = useSetupStore((s) => s.step);
  const error = useSetupStore((s) => s.error);
  const cliVersion = useSetupStore((s) => s.cliVersion);
  const accountName = useSetupStore((s) => s.accountName);
  const setStep = useSetupStore((s) => s.setStep);
  const setError = useSetupStore((s) => s.setError);
  const setCliInfo = useSetupStore((s) => s.setCliInfo);
  const setAuthStatus = useSetupStore((s) => s.setAuthStatus);
  const setAccountName = useSetupStore((s) => s.setAccountName);
  const setSetupCompleted = useSettingsStore((s) => s.setSetupCompleted);

  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadPhase, setDownloadPhase] = useState<string>('');
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);

  const runAuthAndFinish = useCallback(async () => {
    setStep('auth_check');
    try {
      const auth = await bridge.checkClaudeAuth();
      if (!auth.authenticated) {
        setAuthStatus('missing');
        setStep('needs_auth');
        return;
      }
      setAuthStatus('ok');
      setAccountName(auth.account ?? null);
    } catch {
      setAuthStatus('missing');
      setStep('needs_auth');
      return;
    }

    try {
      await useMcpStore.getState().ensureDefaultServer();
      useMcpStore.getState().checkHealth();
      setMcpOk(true);
    } catch {
      setMcpOk(false);
    }

    setStep('ready');
    setTimeout(() => setSetupCompleted(true), 2000);
  }, [setStep, setAuthStatus, setAccountName, setSetupCompleted]);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      try {
        const status = await bridge.checkClaudeCli();
        if (cancelled) return;
        if (status.installed && !status.git_bash_missing) {
          setCliInfo(status.version ?? null, status.path ?? null);
          await runAuthAndFinish();
          return;
        }
        if (status.installed && status.git_bash_missing) {
          setCliInfo(status.version ?? null, status.path ?? null);
        }
        setStep('not_installed');
      } catch {
        if (!cancelled) setStep('not_installed');
      }
    }
    detect();
    return () => { cancelled = true; };
  }, []);

  const handleInstall = useCallback(async () => {
    setStep('installing');
    setError(null);
    setDownloadPercent(0);
    setDownloadPhase('');

    const unlistenProgress = await onDownloadProgress((event) => {
      setDownloadPercent(event.percent);
      setDownloadPhase(event.phase);
    });

    try {
      await bridge.installClaudeCli();
      unlistenProgress();

      const status = await bridge.checkClaudeCli();
      if (status.installed) {
        setCliInfo(status.version ?? null, status.path ?? null);
        await runAuthAndFinish();
      } else {
        setError('CLI not found after download');
        setStep('install_failed');
      }
    } catch (err) {
      unlistenProgress();
      setError(stripAnsi(String(err)));
      setStep('install_failed');
    }
  }, [runAuthAndFinish]);

  const handleLogin = useCallback(async () => {
    try {
      await bridge.startClaudeLogin();
    } catch {
      // Login process started — user completes in browser
    }
  }, []);

  const handleRetryAuth = useCallback(async () => {
    await runAuthAndFinish();
  }, [runAuthAndFinish]);

  const handleSkip = useCallback(() => {
    setSetupCompleted(true);
  }, [setSetupCompleted]);

  const phaseLabel =
    downloadPhase === 'native_version' ? t('setup.nativeVersion')
    : downloadPhase === 'native_manifest' ? t('setup.nativeManifest')
    : downloadPhase === 'native_download' ? t('setup.nativeDownload')
    : downloadPhase === 'native_verify' ? t('setup.nativeVerify')
    : downloadPhase === 'native_install' ? t('setup.nativeInstall')
    : downloadPhase === 'npm_fallback' ? t('setup.npmFallback')
    : downloadPhase === 'node_downloading' ? t('setup.downloadingNode')
    : downloadPhase === 'node_extracting' ? t('setup.extractingNode')
    : downloadPhase === 'node_complete' ? t('setup.preparingEnv')
    : downloadPhase === 'installing' ? t('setup.nativeInstall')
    : downloadPhase === 'git_downloading' ? t('setup.downloadingGit')
    : downloadPhase === 'git_extracting' ? t('setup.extractingGit')
    : downloadPhase === 'git_complete' ? t('setup.preparingEnv')
    : downloadPhase === 'version' ? t('setup.nativeVersion')
    : downloadPhase === 'downloading' ? t('setup.nativeDownload')
    : '';

  return (
    <div className="flex flex-col items-center justify-center select-none">
      <div className="w-full max-w-sm px-6">
        {/* Avatar */}
        <div className="flex justify-center mb-8">
          <AiAvatar size="w-16 h-16" rounded="rounded-2xl" className="shadow-glow" />
        </div>

        {/* Checking */}
        {step === 'checking' && (
          <div className="text-center space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-center gap-2.5">
              <span className="text-base font-semibold animate-pulse-soft text-accent leading-none">/</span>
              <span className="text-sm tracking-wide text-text-muted">{t('setup.checking')}</span>
            </div>
          </div>
        )}

        {/* Not Installed */}
        {step === 'not_installed' && (
          <div className="text-center space-y-5 animate-in fade-in duration-300">
            <div>
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {t('setup.notInstalled')}
              </h2>
              <p className="text-sm text-text-tertiary mt-2 leading-relaxed max-w-xs mx-auto">
                {t('setup.notInstalledDesc')}
              </p>
            </div>
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                bg-accent text-text-inverse hover:bg-accent-hover
                shadow-sm hover:shadow-glow transition-all duration-200
                cursor-pointer"
            >
              <DownloadSimple size={15} weight="bold" />
              {t('setup.install')}
            </button>
            <div>
              <button onClick={handleSkip}
                className="text-xs text-text-tertiary/60 hover:text-text-muted
                  transition-colors duration-200 cursor-pointer">
                {t('setup.skip')}
              </button>
            </div>
          </div>
        )}

        {/* Installing */}
        {step === 'installing' && (
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-center gap-2.5">
              <span className="text-base font-semibold animate-pulse-soft text-accent leading-none">/</span>
              <span className="text-sm tracking-wide text-text-muted">
                {phaseLabel || t('setup.installing')}
              </span>
            </div>
            <div className="mx-auto max-w-50">
              <div className="h-1 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(downloadPercent, 3)}%` }}
                />
              </div>
              {downloadPercent > 0 && (
                <span className="text-xs text-text-tertiary/50 mt-2 block">{downloadPercent}%</span>
              )}
            </div>
          </div>
        )}

        {/* Install Failed */}
        {step === 'install_failed' && (
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <div>
              <h2 className="text-lg font-semibold text-red-400 tracking-tight">
                {t('setup.installFailed')}
              </h2>
              <p className="text-sm text-text-tertiary mt-2 leading-relaxed">
                {t('setup.installFailedDesc')}
              </p>
            </div>
            {error && (
              <p className="text-xs text-red-400/80 font-mono bg-red-500/8 px-3 py-2 rounded-lg text-left leading-relaxed">
                {error}
              </p>
            )}
            {error && isPermissionError(error) && (
              <p className="text-xs text-amber-400/80">{t('error.permissionHint')}</p>
            )}
            {error && !isPermissionError(error) && isNetworkError(error) && (
              <p className="text-xs text-amber-400/80">{t('network.firewallHint')}</p>
            )}
            <div className="flex gap-2.5 justify-center">
              <button onClick={handleInstall}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  bg-accent text-text-inverse hover:bg-accent-hover
                  transition-all duration-200 cursor-pointer">
                {t('setup.retry')}
              </button>
              <button onClick={handleSkip}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  border border-border-subtle text-text-muted
                  hover:bg-bg-tertiary transition-all duration-200 cursor-pointer">
                {t('setup.skip')}
              </button>
            </div>
          </div>
        )}

        {/* Auth Check */}
        {step === 'auth_check' && (
          <div className="text-center space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-center gap-2.5">
              <span className="text-base font-semibold animate-pulse-soft text-accent leading-none">/</span>
              <span className="text-sm tracking-wide text-text-muted">{t('setup.authChecking')}</span>
            </div>
          </div>
        )}

        {/* Needs Auth */}
        {step === 'needs_auth' && (
          <div className="text-center space-y-5 animate-in fade-in duration-300">
            <div>
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {t('setup.loginNeeded')}
              </h2>
              <p className="text-sm text-text-tertiary mt-2 leading-relaxed max-w-xs mx-auto">
                {t('setup.loginNeededDesc')}
              </p>
            </div>
            <div className="space-y-2.5 max-w-60 mx-auto">
              <button
                onClick={handleLogin}
                className="w-full px-5 py-2.5 rounded-xl text-sm font-medium
                  bg-accent text-text-inverse hover:bg-accent-hover
                  shadow-sm hover:shadow-glow transition-all duration-200
                  flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowSquareOut size={15} weight="bold" />
                {t('setup.openClaudeLogin')}
              </button>
              <button
                onClick={handleRetryAuth}
                className="w-full px-5 py-2.5 rounded-xl text-sm font-medium
                  border border-border-subtle text-text-muted
                  hover:bg-bg-tertiary transition-all duration-200
                  flex items-center justify-center gap-2 cursor-pointer"
              >
                {t('setup.retry')}
              </button>
            </div>
            <button onClick={handleSkip}
              className="text-xs text-text-tertiary/60 hover:text-text-muted
                transition-colors duration-200 cursor-pointer">
              {t('setup.skip')}
            </button>
          </div>
        )}

        {/* Ready */}
        {step === 'ready' && (
          <div className="text-center space-y-5 animate-in fade-in zoom-in-95 duration-400">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle size={18} weight="fill" className="text-success" />
              <span className="text-sm font-medium text-text-primary tracking-tight">{t('setup.ready')}</span>
            </div>

            <div className="space-y-2 mx-auto max-w-55">
              <div className="flex items-center gap-2.5 text-xs">
                <CheckCircle size={14} weight="light" className="text-success/70 shrink-0" />
                <span className="text-text-tertiary">
                  Claude CLI {cliVersion ? `v${cliVersion}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-xs">
                <CheckCircle size={14} weight="light" className="text-success/70 shrink-0" />
                <span className="text-text-tertiary">
                  {accountName
                    ? t('setup.authenticatedAs').replace('{account}', accountName)
                    : t('setup.authenticated')}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-xs">
                {mcpOk ? (
                  <CheckCircle size={14} weight="light" className="text-success/70 shrink-0" />
                ) : (
                  <Warning size={14} weight="light" className="text-amber-400/70 shrink-0" />
                )}
                <span className="text-text-tertiary">
                  {mcpOk ? t('setup.mcpConnected') : t('setup.mcpUnavailable')}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

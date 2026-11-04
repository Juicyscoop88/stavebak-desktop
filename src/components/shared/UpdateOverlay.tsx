import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SpinnerGap } from '@phosphor-icons/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../../lib/i18n';
import { useChatStore, isSessionBusy } from '../../stores/chatStore';
import { canRestartNow } from '../../lib/update-policy';
import {
  MANUAL_DOWNLOAD_URL,
  RESTART_COUNTDOWN_S,
  dismissMandatoryUpdate,
  installAndRestart,
  retryUpdate,
  useUpdateStore,
} from '../../hooks/useAutoUpdateCheck';

/** Je aplikace v klidu (nic neběží, nic rozepsaného)? Reaktivně nad chatStore. */
function useAppIdle(): boolean {
  return useChatStore((s) =>
    canRestartNow(
      [...s.tabs.values()].map((tab) => ({
        busy: isSessionBusy(tab.sessionStatus),
        inputDraft: tab.inputDraft ?? '',
        pendingAttachments: tab.pendingAttachments?.length ?? 0,
        pendingUserMessages: tab.pendingUserMessages?.length ?? 0,
      })),
    ),
  );
}

/**
 * Vynucená aktualizace (useAutoUpdateCheck). Tři stavy:
 * - po startu: „Aktualizuji Stavebák“ s průběhem, než projektant začne pracovat,
 * - během práce: stažená povinná verze počká na klid a pak odpočet a restart,
 * - selhání: zkusit znovu, stáhnout ručně, nebo pokračovat ve staré verzi.
 */
export function UpdateOverlay() {
  const t = useT();
  const { phase, version, mandatory, blocking, progress, error, dismissed } = useUpdateStore();
  const idle = useAppIdle();
  const [seconds, setSeconds] = useState(RESTART_COUNTDOWN_S);

  const forced = mandatory && !dismissed;
  const showProgress = (blocking && (phase === 'downloading' || phase === 'ready')) || phase === 'installing';
  const showCountdown = forced && !blocking && phase === 'ready' && idle;
  const showError = forced && phase === 'error' && (blocking || idle);

  useEffect(() => {
    if (!showCountdown) {
      setSeconds(RESTART_COUNTDOWN_S);
      return;
    }
    if (seconds <= 0) {
      void installAndRestart();
      return;
    }
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [showCountdown, seconds]);

  if (!showProgress && !showCountdown && !showError) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40">
      <div
        role="alertdialog"
        aria-live="polite"
        className="bg-bg-card border border-border-subtle rounded-xl p-5 shadow-lg max-w-sm w-full mx-4 animate-fade-in"
      >
        {showProgress && (
          <>
            <h3 className="text-sm font-semibold text-text-primary mb-2">
              {phase === 'installing' ? t('update.forced.installing') : t('update.forced.downloading')}
            </h3>
            <p className="text-sm text-text-primary mb-4">
              {t('update.forced.downloadingDetail').replace('{version}', version)}
            </p>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <SpinnerGap size={14} weight="light" className="animate-spin" />
              {phase === 'installing' ? t('update.forced.restarting') : `${progress} %`}
            </div>
          </>
        )}

        {showCountdown && (
          <>
            <h3 className="text-sm font-semibold text-text-primary mb-2">{t('update.forced.readyTitle')}</h3>
            <p className="text-sm text-text-primary mb-4">
              {t('update.forced.readyDetail').replace('{version}', version).replace('{seconds}', String(seconds))}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => void installAndRestart()}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-smooth cursor-pointer"
              >
                {t('update.forced.restartNow')}
              </button>
            </div>
          </>
        )}

        {showError && (
          <>
            <h3 className="text-sm font-semibold text-text-primary mb-2">{t('update.forced.errorTitle')}</h3>
            <p className="text-sm text-text-primary mb-1">{t('update.forced.errorDetail')}</p>
            <p className="text-xs text-text-muted mb-4 break-words max-h-24 overflow-y-auto select-text">{error}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={dismissMandatoryUpdate}
                className="mr-auto px-3 py-1.5 text-xs rounded-lg text-text-muted hover:bg-bg-secondary transition-smooth cursor-pointer"
              >
                {t('update.forced.continueOld')}
              </button>
              <button
                onClick={() => void openUrl(MANUAL_DOWNLOAD_URL)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border-subtle text-text-primary hover:bg-bg-secondary transition-smooth cursor-pointer"
              >
                {t('update.forced.manual')}
              </button>
              <button
                onClick={() => void retryUpdate()}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-smooth cursor-pointer"
              >
                {t('update.forced.retry')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

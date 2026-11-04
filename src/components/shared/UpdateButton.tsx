import { ArrowClockwise, CheckCircle, DownloadSimple, SpinnerGap } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import { retryUpdate, useUpdateStore } from '../../hooks/useAutoUpdateCheck';

/**
 * Tlačítko aktualizace v horní liště. Stahování a povinnou instalaci řídí useAutoUpdateCheck
 * a UpdateOverlay, tady je viditelný stav a ruční cesta: stažená verze → „Restartovat a aktualizovat“,
 * selhání → „Zkusit aktualizaci znovu“.
 */
export function UpdateButton() {
  const t = useT();
  const { phase, version, progress } = useUpdateStore();

  if (phase === 'none') return null;

  const label =
    phase === 'downloading' ? `${t('update.downloading')} ${progress} %`
      : phase === 'installing' ? t('update.forced.restarting')
        : phase === 'ready' ? t('update.forced.restartToUpdate')
          : t('update.forced.retry');

  return (
    <button
      onClick={() => void retryUpdate()}
      disabled={phase === 'downloading' || phase === 'installing'}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-smooth mr-1 whitespace-nowrap
        ${phase === 'ready'
          ? 'bg-success/15 text-success border border-success/30 hover:bg-success/25 cursor-pointer'
          : phase === 'error'
            ? 'bg-error/10 text-error border border-error/30 hover:bg-error/20 cursor-pointer'
            : 'bg-accent/10 text-accent cursor-wait'}`}
      title={`${t('update.version')} v${version}`}
    >
      {phase === 'downloading' || phase === 'installing' ? <SpinnerGap size={12} weight="light" className="animate-spin" />
        : phase === 'ready' ? <CheckCircle size={12} weight="light" />
          : phase === 'error' ? <ArrowClockwise size={12} weight="light" />
            : <DownloadSimple size={12} weight="light" />}
      <span>{label}</span>
    </button>
  );
}

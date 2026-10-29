import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug } from '@phosphor-icons/react';
import { useSettingsStore } from '../../stores/settingsStore';
import { captureRecentErrors, recentErrors, reportProblem } from '../../lib/report-problem';

captureRecentErrors();

/**
 * Tlačítko Nahlásit problém v horní liště, vedle aktualizace. Je vždy po ruce, ne jen po chybě.
 * Otevře předvyplněné hlášení (verze, systém, případně poslední chyby), uživatel ho před odesláním vidí.
 */
export function ReportProblemButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [withErrors, setWithErrors] = useState(true);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const errors = open ? recentErrors() : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async () => {
    const summary = text.trim().split('\n')[0].slice(0, 80) || 'Hlášení z aplikace';
    await reportProblem({
      summary,
      details: text.trim(),
      error: withErrors && errors.length ? errors.join('\n') : undefined,
      redact: workingDirectory ? [workingDirectory] : [],
    }).catch(() => {});
    setOpen(false);
    setText('');
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-tertiary
          hover:bg-bg-secondary hover:text-text-primary transition-smooth mr-1 cursor-pointer"
        title="Nahlásit problém nebo nápad"
        aria-label="Nahlásit problém nebo nápad"
      >
        <Bug size={14} weight="light" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="bg-bg-card border border-border-subtle rounded-xl p-5 shadow-lg max-w-md w-full mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-text-primary mb-1">Nahlásit problém nebo nápad</h3>
            <p className="text-xs text-text-muted mb-3">
              Napište, co se stalo nebo co by mělo fungovat jinak. Otevře se předvyplněné hlášení, které před odesláním uvidíte a můžete upravit.
              Do hlášení nepište údaje z projektů ani osobní údaje.
            </p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Co jste dělali a co se stalo?"
              className="w-full text-sm rounded-lg border border-border-subtle bg-bg-secondary p-2
                text-text-primary resize-none outline-none focus:border-accent/40"
            />
            {errors.length > 0 && (
              <label className="flex items-center gap-2 mt-2 text-xs text-text-muted cursor-pointer">
                <input type="checkbox" checked={withErrors} onChange={(e) => setWithErrors(e.target.checked)} />
                Přiložit poslední chyby aplikace ({errors.length})
              </label>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-bg-secondary text-text-muted hover:bg-bg-tertiary transition-smooth cursor-pointer"
              >
                Zrušit
              </button>
              <button
                onClick={send}
                disabled={!text.trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent/10 text-accent hover:bg-accent/20
                  transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                Pokračovat k hlášení
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

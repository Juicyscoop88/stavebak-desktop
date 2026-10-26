import { lazy, Suspense, useEffect, useState } from 'react';
import { SpinnerGap } from '@phosphor-icons/react';
import { panelRegistry, type ConvertStep } from '../../lib/panel-registry';

const DxfPreview = lazy(() => import('./DxfPreview'));

/** Převod trvá obvykle pár sekund; po této době náhled přestane čekat a nabídne nový pokus. */
const TIMEOUT_S = 90;

const STEP_TEXT: Record<ConvertStep, string> = {
  upload: 'Nahrávám výkres na server Stavebáku…',
  convert: 'Převádím DWG na DXF…',
  download: 'Načítám náhled…',
};

/** DWG has no open viewer we can ship: a plugin converts it to DXF, then the DXF viewer shows it. */
export default function DwgPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<ConvertStep>('upload');
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUrl(null);
    setError(null);
    setStep('upload');
    setElapsed(0);
    const converter = panelRegistry.getFileConverter('dwg');
    if (!converter) {
      setError('Náhled DWG zatím není k dispozici. Uložte výkres v CADu jako DXF.');
      return;
    }
    let done = false;
    const started = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setElapsed(s);
      if (s >= TIMEOUT_S && !done) {
        done = true;
        clearInterval(timer);
        setError('Převod trvá příliš dlouho. Zkontrolujte připojení k internetu a zkuste to znovu.');
      }
    }, 1000);
    converter.convert(path, (s) => { if (!done) setStep(s); }).then(
      (dxf) => { if (!done) { done = true; clearInterval(timer); setUrl(dxf); } },
      (e) => { if (!done) { done = true; clearInterval(timer); setError(String(e)); } },
    );
    return () => { done = true; clearInterval(timer); };
  }, [path, attempt]);

  if (url) return <Suspense fallback={null}><DxfPreview url={url} /></Suspense>;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-text-muted max-w-sm leading-relaxed">{error}</p>
        <button onClick={() => setAttempt((a) => a + 1)}
          className="px-3 py-1.5 rounded-lg text-xs text-text-primary border border-border hover:bg-bg-secondary cursor-pointer">
          Zkusit znovu
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" role="status" aria-live="polite">
      <SpinnerGap size={22} className="animate-spin text-text-tertiary" />
      <p className="text-sm text-text-secondary">{STEP_TEXT[step]}</p>
      <p className="text-xs text-text-tertiary tabular-nums">
        {elapsed < 3 ? 'Výkres se převádí na serveru, obvykle to trvá pár sekund.' : `${elapsed} s`}
      </p>
    </div>
  );
}

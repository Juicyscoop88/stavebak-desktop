import { useEffect, useRef, useState } from 'react';
import { Color } from 'three';
import { DxfViewer } from 'dxf-viewer';
import fontLatin from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url';
import fontLatinExt from '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff?url';

/** DXF drawing preview (WebGL): pan with drag, zoom with wheel. Texts use Noto Sans (Czech glyphs). */
export default function DxfPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const viewer = new DxfViewer(el, {
      clearColor: new Color('#ffffff'),
      autoResize: true,
      colorCorrection: true,
      blackWhiteInversion: true,
    });
    if (import.meta.env.DEV) (window as any).__dxfViewer = viewer;
    let cancelled = false;
    setState('loading');
    viewer
      .Load({ url, fonts: [fontLatin, fontLatinExt], workerFactory: null, progressCbk: null })
      .then(() => { if (!cancelled) setState('ready'); })
      .catch((e: unknown) => { if (!cancelled) { setState('error'); setError(String(e)); } });
    return () => { cancelled = true; viewer.Destroy(); };
  }, [url]);

  return (
    <div className="relative h-full w-full bg-white">
      {/* The viewer forces position:relative on its container, so size it explicitly */}
      <div ref={containerRef} className="h-full w-full" />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
          {state === 'loading' ? 'Načítám výkres…' : `Výkres nejde zobrazit. ${error}`}
        </div>
      )}
    </div>
  );
}

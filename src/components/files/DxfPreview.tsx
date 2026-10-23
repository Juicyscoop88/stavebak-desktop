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
      .then(() => {
        if (cancelled) return;
        fitMainCluster(viewer);
        setState('ready');
      })
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

/**
 * "Fit all" uses the full extent, and drawings often mix local coordinates with stray objects in
 * S-JTSK (hundreds of km away) — the drawing then shrinks to a dot. Fit to where most geometry is:
 * points within 10x the median distance from the median point.
 */
function fitMainCluster(viewer: DxfViewer) {
  const xs: number[] = [];
  const ys: number[] = [];
  viewer.GetScene().traverse((o: any) => {
    const attrs = o.geometry?.attributes;
    if (!attrs) return;
    const t0 = attrs.instanceTransform0;
    const t1 = attrs.instanceTransform1;
    if (t0 && t1) {
      // Instanced blocks: the translation sits in the third component of both rows
      for (let i = 0; i < t0.count; i++) { xs.push(t0.getZ(i)); ys.push(t1.getZ(i)); }
      return;
    }
    const pos = attrs.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) { xs.push(pos.getX(i)); ys.push(pos.getY(i)); }
  });
  if (xs.length < 10) return;

  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const mx = median(xs);
  const my = median(ys);
  const dist = xs.map((x, i) => Math.hypot(x - mx, ys[i] - my));
  const limit = Math.max(median(dist) * 10, 1);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  dist.forEach((d, i) => {
    if (d > limit) return;
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  });
  if (minX < maxX && minY < maxY) viewer.FitView(minX, maxX, minY, maxY, 0.05);
}

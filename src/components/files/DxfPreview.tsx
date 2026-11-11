import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Color, Vector3 } from 'three';
import { DxfViewer } from 'dxf-viewer';
import { CornersIn, CornersOut, FrameCorners, Minus, Plus, X } from '@phosphor-icons/react';
import fontLatin from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url';
import fontLatinExt from '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff?url';
import { formatCoord, viewScale, viewWidth, zoomedWidth, zoomPercent, ZOOM_STEP } from './dxf-view';

/**
 * DXF drawing preview (WebGL): pan with drag, zoom with wheel or the toolbar, double click fits.
 * Full screen covers the whole app window with the same viewer, so the drawing is not reloaded.
 * Texts use Noto Sans (Czech glyphs).
 */
export default function DxfPreview({ url, name }: { url: string; name?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DxfViewer | null>(null);
  const fitScaleRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [percent, setPercent] = useState(100);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [full, setFull] = useState(false);
  const percentRef = useRef(100);
  percentRef.current = percent;
  // A fitted drawing is refitted after switching full screen, a zoomed one keeps its scale
  const refitAfterToggleRef = useRef(false);
  const toggleFull = useCallback((next: boolean) => {
    refitAfterToggleRef.current = percentRef.current === 100;
    setFull(next);
  }, []);

  const fitView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    fitScaleRef.current = refit(viewer);
    setPercent(100);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const cam = viewer.GetCamera();
    const width = zoomedWidth(viewer.GetCanvas().clientWidth, fitScaleRef.current, viewWidth(cam), factor);
    viewer.SetView(new Vector3(cam.position.x, cam.position.y, 0), width);
    viewer.Render();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const viewer = new DxfViewer(el, {
      clearColor: new Color('#ffffff'),
      autoResize: true,
      colorCorrection: true,
      blackWhiteInversion: true,
      pointerMoveEvent: true,
    });
    viewerRef.current = viewer;
    if (import.meta.env.DEV) (window as any).__dxfViewer = viewer;
    let cancelled = false;
    let frame = 0;
    const onView = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (cancelled) return;
        const scale = viewScale(viewer.GetCanvas().clientWidth, viewWidth(viewer.GetCamera()));
        setPercent(zoomPercent(fitScaleRef.current, scale));
      });
    };
    // Scene coordinates are relative to the scene origin, the status bar shows drawing coordinates
    const onMove = (e: any) => {
      const p = e.detail?.position;
      const o = viewer.GetOrigin();
      if (p) setCursor({ x: p.x + (o?.x ?? 0), y: p.y + (o?.y ?? 0) });
    };
    const onLeave = () => setCursor(null);
    const onDouble = () => {
      fitScaleRef.current = refit(viewer);
      setPercent(100);
    };
    viewer.Subscribe('viewChanged', onView);
    viewer.Subscribe('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDouble);
    setState('loading');
    // CSP aplikace nepovoluje fetch data: URL (connect-src), viewer by v produkci skončil „Load failed“.
    // Data proto předáme jako blob: URL vytvořenou tady, bez fetch.
    const objectUrl = url.startsWith('data:') ? dataUrlToObjectUrl(url) : null;
    viewer
      .Load({ url: objectUrl ?? url, fonts: [fontLatin, fontLatinExt], workerFactory: null, progressCbk: null })
      .then(() => {
        if (cancelled) return;
        fitScaleRef.current = refit(viewer);
        setPercent(100);
        setState('ready');
      })
      .catch((e: unknown) => { if (!cancelled) { setState('error'); setError(String(e)); } });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDouble);
      viewerRef.current = null;
      // Destroy() leaves the canvas in the container: a dead one would sit there and catch the pointer
      const canvas = viewer.GetCanvas();
      viewer.Destroy();
      canvas?.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  // The canvas gets its new size from the viewer's resize observer, refit only after that
  useEffect(() => {
    if (!refitAfterToggleRef.current) return;
    refitAfterToggleRef.current = false;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(fitView); });
    return () => cancelAnimationFrame(frame);
  }, [full, fitView]);

  // Keys only in full screen: in the panel they would fight with typing in the chat
  useEffect(() => {
    if (!full) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const action =
        e.key === 'Escape' ? () => toggleFull(false)
        : e.key === 'f' || e.key === 'F' ? fitView
        : e.key === '+' || e.key === '=' ? () => zoomBy(ZOOM_STEP)
        : e.key === '-' ? () => zoomBy(1 / ZOOM_STEP)
        : null;
      if (!action) return;
      // Capture phase: Escape must close full screen, not the preview behind it
      e.preventDefault();
      e.stopPropagation();
      action();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [full, fitView, zoomBy, toggleFull]);

  return (
    <div
      className={full ? 'fixed inset-0 z-[1000] flex flex-col bg-bg-primary text-text-primary' : 'relative flex h-full w-full flex-col'}
      role={full ? 'dialog' : undefined}
      aria-modal={full || undefined}
      aria-label={full ? `Výkres ${name ?? ''}`.trim() : undefined}
    >
      {full && (
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-secondary px-4 py-2">
          <button
            ref={closeRef}
            type="button"
            onClick={() => toggleFull(false)}
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-bg-tertiary cursor-pointer"
          >
            <X size={15} /> Zavřít <span className="text-xs text-text-muted">Esc</span>
          </button>
          {name && <span className="min-w-0 truncate text-sm font-medium">{name}</span>}
        </header>
      )}
      <div className="relative min-h-0 flex-1 bg-white">
        {/* The viewer forces position:relative on its container, so size it explicitly */}
        <div ref={containerRef} className="h-full w-full" />
        {state !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
            {state === 'loading' ? 'Načítám výkres…' : `Výkres nejde zobrazit. ${error}`}
          </div>
        )}
        {state === 'ready' && (
          <div
            role="toolbar"
            aria-label="Ovládání výkresu"
            className="absolute bottom-3 right-3 flex flex-wrap items-center justify-end gap-0.5 rounded-lg border border-border bg-bg-card p-1 text-text-primary shadow-lg"
          >
            <ToolButton label="Oddálit (−)" onClick={() => zoomBy(1 / ZOOM_STEP)}><Minus size={16} /></ToolButton>
            <button
              type="button"
              onClick={fitView}
              title="Přizpůsobit"
              className="h-8 min-w-[52px] rounded-md px-1 text-xs tabular-nums hover:bg-bg-tertiary cursor-pointer"
            >
              {percent} %
            </button>
            <ToolButton label="Přiblížit (+)" onClick={() => zoomBy(ZOOM_STEP)}><Plus size={16} /></ToolButton>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <ToolButton label="Přizpůsobit (F, dvojklik)" onClick={fitView} text="Přizpůsobit"><FrameCorners size={16} /></ToolButton>
            <ToolButton
              label={full ? 'Zmenšit (Esc)' : 'Celá obrazovka'}
              onClick={() => toggleFull(!full)}
              text={full ? 'Zmenšit' : 'Celá obrazovka'}
            >
              {full ? <CornersIn size={16} /> : <CornersOut size={16} />}
            </ToolButton>
          </div>
        )}
      </div>
      {full && (
        <footer className="flex flex-wrap items-center gap-5 border-t border-border bg-bg-secondary px-4 py-1.5 text-xs text-text-secondary">
          {cursor ? (
            <span className="flex gap-4 tabular-nums text-text-primary">
              <span>X {formatCoord(cursor.x)}</span>
              <span>Y {formatCoord(cursor.y)}</span>
            </span>
          ) : (
            <span>Najeďte myší na výkres</span>
          )}
          <span>Kolečko: zoom · Táhnout: posun · Dvojklik nebo F: přizpůsobit · Esc: zavřít</span>
        </footer>
      )}
    </div>
  );
}

function ToolButton({ label, onClick, text, children }: { label: string; onClick: () => void; text?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={text ? undefined : label}
      className={`flex h-8 items-center gap-1.5 rounded-md hover:bg-bg-tertiary cursor-pointer ${text ? 'px-2 text-xs' : 'w-8 justify-center'}`}
    >
      {children}
      {text}
    </button>
  );
}

/** Fit and render, returns the new scale (pixels per drawing unit) that counts as 100 %. */
function refit(viewer: DxfViewer): number {
  fitDrawing(viewer);
  viewer.Render();
  return viewScale(viewer.GetCanvas().clientWidth, viewWidth(viewer.GetCamera()));
}

/** Fit to the main part of the drawing, or to all of it when there is too little geometry to tell. */
function fitDrawing(viewer: DxfViewer) {
  if (fitMainCluster(viewer)) return;
  const b = viewer.GetBounds();
  const o = viewer.GetOrigin();
  if (b && b.minX < b.maxX && b.minY < b.maxY) viewer.FitView(b.minX - o.x, b.maxX - o.x, b.minY - o.y, b.maxY - o.y, 0.05);
}

/** data:[mime][;base64],… → blob: URL, bez fetch (CSP). */
export function dataUrlToObjectUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = meta.split(';')[0] || 'application/octet-stream';
  let bytes: Uint8Array;
  if (meta.endsWith(';base64')) {
    const bin = atob(payload);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * "Fit all" uses the full extent, and drawings often mix local coordinates with stray objects in
 * S-JTSK (hundreds of km away) — the drawing then shrinks to a dot. Fit to where most geometry is:
 * points within 10x the median distance from the median point.
 */
function fitMainCluster(viewer: DxfViewer): boolean {
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
  if (xs.length < 10) return false;

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
  if (!(minX < maxX && minY < maxY)) return false;
  viewer.FitView(minX, maxX, minY, maxY, 0.05);
  return true;
}

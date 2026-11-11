import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ListChecks, MagnifyingGlass, SelectionPlus, X } from '@phosphor-icons/react';
import { DRAWING_ACTIONS, REGION_QUESTIONS, regionFrom, regionPrompt, type DrawingRegion } from './dxf-view';

/** Point on the canvas (CSS px from its top-left corner) → drawing coordinates, or null without a viewer. */
export type ToDrawing = (x: number, y: number) => { x: number; y: number } | null;

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Assistant on the drawing preview: buttons and a region selection that put a request into the chat
 * input (stavebak:prefill, the same event as the project panel). The user sends it and the model does
 * the work with the same MCP tools as in any other client: nothing here talks to the server.
 */
export default function DrawingAssistant({ name, toDrawing, onAsked, onBusyChange }: {
  name: string;
  toDrawing: ToDrawing;
  /** Called after a request went to the chat, e.g. to leave full screen so the chat is visible. */
  onAsked: () => void;
  /** True while selecting or choosing a question: Escape belongs to the assistant then. */
  onBusyChange: (busy: boolean) => void;
}) {
  const [marking, setMarking] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  // The drag lives in a ref: pointer events can arrive before React re-renders with new state
  const dragRef = useRef<Box | null>(null);
  const [region, setRegion] = useState<DrawingRegion | null>(null);
  const [custom, setCustom] = useState('');
  // Size of the drawing area at the end of the drag: the popover stays inside it
  const [area, setArea] = useState({ w: 0, h: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setMarking(false); setBox(null); dragRef.current = null; setRegion(null); setCustom(''); };

  useEffect(() => { onBusyChange(marking || !!region); }, [marking, region, onBusyChange]);
  useEffect(() => { if (region) inputRef.current?.focus(); }, [region]);

  // Escape cancels the selection; capture phase so it does not also close full screen or the preview
  useEffect(() => {
    if (!marking && !region) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      reset();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [marking, region]);

  const ask = (text: string) => {
    window.dispatchEvent(new CustomEvent('stavebak:prefill', { detail: text }));
    reset();
    onAsked();
  };

  const local = (e: ReactPointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = local(e);
    // Keeps the drag when the pointer leaves the drawing; a pointer that is already gone throws
    try { overlayRef.current?.setPointerCapture(e.pointerId); } catch { /* drag still works inside */ }
    setRegion(null);
    dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setBox(dragRef.current);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const p = local(e);
    dragRef.current = { ...dragRef.current, x1: p.x, y1: p.y };
    setBox(dragRef.current);
  };
  const onUp = () => {
    const box = dragRef.current;
    if (!box) return;
    dragRef.current = null;
    // A click without a drag is not a region
    if (Math.abs(box.x1 - box.x0) < 6 || Math.abs(box.y1 - box.y0) < 6) { setBox(null); return; }
    const a = toDrawing(box.x0, box.y0);
    const b = toDrawing(box.x1, box.y1);
    if (!a || !b) { setBox(null); return; }
    setArea({ w: overlayRef.current?.clientWidth ?? 0, h: overlayRef.current?.clientHeight ?? 0 });
    setRegion(regionFrom(a, b));
    setMarking(false);
  };

  const rect = box && { left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) };

  return (
    <>
      {marking && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10 cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {!box && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-bg-card px-3 py-1.5 text-xs text-text-primary shadow-lg border border-border">
              Táhnutím označte oblast výkresu · Esc zruší
            </div>
          )}
        </div>
      )}
      {rect && (
        <div
          className="pointer-events-none absolute z-10 border-2 border-dashed border-sky-600 bg-sky-500/10"
          style={rect}
          aria-hidden="true"
        />
      )}
      {region && rect && (
        <div
          role="dialog"
          aria-label="Dotaz na oblast výkresu"
          className="absolute z-20 w-72 rounded-xl border border-border bg-bg-card p-3 text-text-primary shadow-xl"
          style={{
            left: Math.max(8, Math.min(rect.left, area.w - 296)),
            // Below the region, or above it when there is no room, never off the drawing area
            top: rect.top + rect.height + 268 <= area.h ? rect.top + rect.height + 8 : Math.max(8, rect.top - 268),
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium">Zeptat se na oblast</span>
            <button type="button" onClick={reset} aria-label="Zrušit" title="Zrušit (Esc)" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-bg-tertiary cursor-pointer">
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {REGION_QUESTIONS.map((q) => (
              <button key={q} type="button" onClick={() => ask(regionPrompt(q, name, region))}
                className="rounded-lg px-2 py-1.5 text-left text-xs hover:bg-bg-tertiary cursor-pointer">
                {q}
              </button>
            ))}
          </div>
          <form className="mt-2" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) ask(regionPrompt(custom, name, region)); }}>
            <label className="sr-only" htmlFor="region-question">Vlastní dotaz na oblast</label>
            <input
              id="region-question"
              ref={inputRef}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Vlastní dotaz, Enter vloží do chatu"
              className="w-full rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
            />
          </form>
        </div>
      )}
      <div role="toolbar" aria-label="Asistent nad výkresem"
        className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-bg-card p-1 text-text-primary shadow-lg">
        <button type="button" aria-pressed={marking} onClick={() => (marking ? reset() : (setRegion(null), setBox(null), setMarking(true)))}
          title="Označit oblast a zeptat se na ni"
          className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-xs cursor-pointer ${marking ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'}`}>
          <SelectionPlus size={16} /> Označit oblast
        </button>
        <button type="button" onClick={() => ask(DRAWING_ACTIONS.extract(name))} title="Vložit do chatu: vyčíst údaje z výkresu do projektu"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-bg-tertiary cursor-pointer">
          <ListChecks size={16} /> Vyčíst údaje
        </button>
        <button type="button" onClick={() => ask(DRAWING_ACTIONS.check(name))} title="Vložit do chatu: zkontrolovat výkres"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-bg-tertiary cursor-pointer">
          <MagnifyingGlass size={16} /> Zkontrolovat
        </button>
      </div>
    </>
  );
}

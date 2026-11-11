/** View math for the DXF preview, kept free of WebGL so it can be tested. */

/** Camera of dxf-viewer: orthographic, wheel zoom changes `zoom`, `SetView` resets it to 1. */
export interface OrthoView {
  left: number;
  right: number;
  zoom: number;
  position: { x: number; y: number };
}

/** Visible width of the view in scene units. */
export function viewWidth(cam: OrthoView): number {
  return (cam.right - cam.left) / (cam.zoom || 1);
}

/**
 * Screen pixels per drawing unit. The viewer keeps this when the canvas is resized (panel dragged,
 * full screen), so a percentage built on it does not jump when only the window changes.
 */
export function viewScale(canvasPx: number, width: number): number {
  return canvasPx > 0 && width > 0 ? canvasPx / width : 0;
}

/** Zoom as a percentage of the scale at the last fit: 100 % = the drawing fitted the view. */
export function zoomPercent(fitScale: number, scale: number): number {
  if (!(fitScale > 0) || !(scale > 0)) return 100;
  return Math.round((scale / fitScale) * 100);
}

/** Zoom steps are multiplicative, limits keep the drawing from vanishing or exploding. */
export const ZOOM_STEP = 1.5;
const MIN_PERCENT = 2;
const MAX_PERCENT = 20000;

/** New view width after zooming in (factor > 1) or out (factor < 1), clamped to the limits. */
export function zoomedWidth(canvasPx: number, fitScale: number, width: number, factor: number): number {
  const next = width / factor;
  if (!(fitScale > 0) || !(canvasPx > 0)) return next;
  const min = canvasPx / (fitScale * (MAX_PERCENT / 100));
  const max = canvasPx / (fitScale * (MIN_PERCENT / 100));
  return Math.min(max, Math.max(min, next));
}

/** Drawing coordinate for the status bar: whole units in Czech number format. */
export function formatCoord(v: number): string {
  const rounded = Math.round(v);
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('cs-CZ', { maximumFractionDigits: 0 });
}

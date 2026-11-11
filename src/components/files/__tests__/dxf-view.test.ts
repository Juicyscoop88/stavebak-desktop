import { describe, it, expect } from 'vitest';
import { formatCoord, viewScale, viewWidth, zoomedWidth, zoomPercent } from '../dxf-view';

describe('DXF view math', () => {
  it('view width follows the wheel zoom of the camera', () => {
    expect(viewWidth({ left: -500, right: 500, zoom: 1, position: { x: 0, y: 0 } })).toBe(1000);
    expect(viewWidth({ left: -500, right: 500, zoom: 4, position: { x: 0, y: 0 } })).toBe(250);
  });

  it('percent is relative to the scale at the last fit', () => {
    const fit = viewScale(500, 1000);
    expect(zoomPercent(fit, viewScale(500, 1000))).toBe(100);
    expect(zoomPercent(fit, viewScale(500, 250))).toBe(400);
    expect(zoomPercent(0, viewScale(500, 250))).toBe(100);
  });

  it('percent does not jump when only the canvas grows (full screen)', () => {
    const fit = viewScale(500, 1000);
    // The viewer widens the view together with the canvas, pixels per unit stay the same
    expect(zoomPercent(fit, viewScale(1500, 3000))).toBe(100);
    expect(zoomPercent(fit, viewScale(1500, 750))).toBe(400);
  });

  it('zoom steps are clamped so the drawing never vanishes', () => {
    const fit = viewScale(500, 1000);
    expect(zoomedWidth(500, fit, 1000, 2)).toBe(500);
    expect(zoomedWidth(500, fit, 1000, 0.5)).toBe(2000);
    expect(zoomedWidth(500, fit, 1000, 1e9)).toBe(5);
    expect(zoomedWidth(500, fit, 1000, 1e-9)).toBe(50000);
  });

  it('coordinates are whole units in Czech format', () => {
    expect(formatCoord(2810.4).replace(/\s/g, ' ')).toBe('2 810');
    expect(formatCoord(-0.2)).toBe('0');
  });
});

describe('drawing assistant prompts', () => {
  it('region from corners in any order, prompt carries file and whole drawing units', async () => {
    const { regionFrom, regionPrompt } = await import('../dxf-view');
    const r = regionFrom({ x: 3500.4, y: 100 }, { x: 1200, y: 2500.6 });
    expect(r).toEqual({ minX: 1200, maxX: 3500.4, minY: 100, maxY: 2500.6 });
    expect(regionPrompt(' Co je v téhle oblasti? ', 'pudorys.dxf', r)).toBe(
      'Co je v téhle oblasti?\nVýkres pudorys.dxf, oblast X 1200 až 3500, Y 100 až 2501 (souřadnice výkresu).',
    );
  });
});

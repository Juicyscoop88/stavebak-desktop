import { describe, it, expect } from 'vitest';
import { previewKind } from '../previewKind';

describe('previewKind (otevření i obnova po změně čtou soubor stejně)', () => {
  it('DXF je binární náhled, jinak by se po změně souboru četl jako text a prohlížeč dostal HTML', () => {
    expect(previewKind('/p/ukazka-pudorys.dxf')).toBe('binary');
    expect(previewKind('/p/VYKRES.DXF')).toBe('binary');
  });

  it('DWG se nečte, převádí ho náhled', () => {
    expect(previewKind('/p/ukazka-pudorys.dwg')).toBe('dwg');
  });

  it('obrázky a PDF binárně, skript a JSON jako text', () => {
    expect(previewKind('/p/a.png')).toBe('binary');
    expect(previewKind('/p/a.pdf')).toBe('binary');
    expect(previewKind('/p/ukazka-pudorys.scr')).toBe('text');
    expect(previewKind('/p/stavebak.json')).toBe('text');
  });
});

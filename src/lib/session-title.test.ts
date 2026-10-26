import { describe, it, expect } from 'vitest';
import { titleFromText } from './session-title';

describe('název konverzace z první zprávy (Codex)', () => {
  it('krátká zpráva beze změny, první neprázdný řádek', () => {
    expect(titleFromText('\n  Rodinný dům v Říčanech \nparcela 123/4')).toBe('Rodinný dům v Říčanech');
  });

  it('dlouhá zpráva se zkrátí na hranici slova', () => {
    const t = titleFromText('Potřebuji zařadit stavbu rodinného domu se dvěma nadzemními podlažími a podkrovím v obci Říčany');
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t).not.toMatch(/\s…$/);
  });
});

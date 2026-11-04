import { describe, expect, it } from 'vitest';
import { MIN_MAIN_WIDTH, MIN_RIGHT_WIDTH_HARD, fitPanels } from '../panel-fit';

const main = (w: number, f: { sidebar: number; right: number }) => w - f.sidebar - f.right;

describe('fitPanels', () => {
  it('v širokém okně nechá uložené šířky', () => {
    expect(fitPanels({ windowWidth: 1900, sidebar: 340, sidebarMin: 180, right: 665, rightMin: 300 }))
      .toEqual({ sidebar: 340, right: 665, sidebarHidden: false });
  });

  it('#53: náhled otevřený na celé obrazovce, okno na půl monitoru, chat zůstane čitelný', () => {
    const f = fitPanels({ windowWidth: 1100, sidebar: 340, sidebarMin: 180, right: 665, rightMin: 300 });
    expect(main(1100, f)).toBeGreaterThanOrEqual(MIN_MAIN_WIDTH);
    expect(f.sidebarHidden).toBe(false);
    expect(f.right).toBeGreaterThanOrEqual(300);
  });

  it('nejdřív zužuje pravý panel, levý až potom', () => {
    const f = fitPanels({ windowWidth: 1100, sidebar: 300, sidebarMin: 180, right: 600, rightMin: 300 });
    expect(f.sidebar).toBe(300);
    expect(f.right).toBe(1100 - 300 - MIN_MAIN_WIDTH);
  });

  it('ve velmi úzkém okně schová levý panel, pravý nezavře', () => {
    const f = fitPanels({ windowWidth: 700, sidebar: 300, sidebarMin: 180, right: 600, rightMin: 300 });
    expect(f.sidebarHidden).toBe(true);
    expect(f.sidebar).toBe(0);
    expect(f.right).toBeGreaterThanOrEqual(MIN_RIGHT_WIDTH_HARD);
    expect(main(700, f)).toBeGreaterThanOrEqual(MIN_MAIN_WIDTH - 60);
  });

  it('bez panelů nic nemění', () => {
    expect(fitPanels({ windowWidth: 500, sidebar: 0, sidebarMin: 180, right: 0, rightMin: 300 }))
      .toEqual({ sidebar: 0, right: 0, sidebarHidden: false });
  });
});

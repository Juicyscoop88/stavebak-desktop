// Rozdělení šířky okna mezi levý panel, chat a pravý panel (náhled souboru nebo vedlejší panel).
// Šířky panelů jsou uložené v pixelech. Když se okno zúží (např. na půl monitoru, desktop #53),
// chat by bez úpravy dostal jen zbytek a zmizel. Tady se panely zúží, aby chat zůstal čitelný.
// Uložené šířky se nemění: po roztažení okna se panely vrátí na šířku, kterou si uživatel nastavil.

/** Nejmenší šířka chatu, při které jde číst odpověď a psát zprávu. */
export const MIN_MAIN_WIDTH = 380;
/** Pod touto šířkou už pravý panel nemá smysl zužovat. */
export const MIN_RIGHT_WIDTH_HARD = 240;

export interface PanelFitInput {
  windowWidth: number;
  /** Šířka levého panelu, 0 když je zavřený. */
  sidebar: number;
  sidebarMin: number;
  /** Šířka pravého panelu, 0 když je zavřený. */
  right: number;
  rightMin: number;
}

export interface PanelFit {
  sidebar: number;
  right: number;
  /** Levý panel se kvůli místu dočasně schoval (uživatel ho má otevřený). */
  sidebarHidden: boolean;
}

/**
 * Pořadí ústupků, aby chat měl aspoň MIN_MAIN_WIDTH:
 * 1. pravý panel na svou minimální šířku,
 * 2. levý panel na svou minimální šířku,
 * 3. pravý panel až na MIN_RIGHT_WIDTH_HARD (otevřel ho uživatel, nezavírá se sám),
 * 4. levý panel se dočasně schová.
 */
export function fitPanels({ windowWidth, sidebar, sidebarMin, right, rightMin }: PanelFitInput): PanelFit {
  let s = sidebar;
  let r = right;
  const overflow = () => s + r + MIN_MAIN_WIDTH - windowWidth;

  if (overflow() > 0 && r > 0) r = Math.max(Math.min(r, rightMin), r - overflow());
  if (overflow() > 0 && s > 0) s = Math.max(Math.min(s, sidebarMin), s - overflow());
  if (overflow() > 0 && r > 0) r = Math.max(Math.min(r, MIN_RIGHT_WIDTH_HARD), r - overflow());
  let sidebarHidden = false;
  if (overflow() > 0 && s > 0) {
    s = 0;
    sidebarHidden = true;
  }
  return { sidebar: Math.round(s), right: Math.round(r), sidebarHidden };
}

// Politika aktualizace aplikace: kdy je nová verze povinná a kdy smí aplikace sama restartovat.
// Čisté funkce bez Tauri, testované v __tests__/update-policy.test.ts.
//
// Povinnost řídí pole `min_version` v latest.json (scripts/updater-manifest.mjs). Verze pod ním
// se musí aktualizovat. Chybí-li pole, je aktualizace povinná vždy: stará verze desktopu umí
// rozbít spojení se serverem (např. 0.16.0 a vypršelý token) a projektant to nepozná.

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(v: string): SemVer | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1 když a < b, 0 když jsou stejné, 1 když a > b. Neplatná verze je nejnižší. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  return 0;
}

/** Je nalezená aktualizace povinná pro běžící verzi? */
export function isUpdateMandatory(currentVersion: string, manifest: Record<string, unknown> | undefined): boolean {
  const min = manifest?.min_version;
  if (typeof min !== 'string' || !parseVersion(min)) return true;
  return compareVersions(currentVersion, min) < 0;
}

/** Stav jedné konverzace, podle kterého se rozhoduje, jestli restart nepřijde o práci. */
export interface TabWork {
  busy: boolean;
  inputDraft: string;
  pendingAttachments: number;
  pendingUserMessages: number;
}

/**
 * Smí aplikace teď restartovat? Jen když žádná konverzace nepracuje a nikde nezůstal
 * rozepsaný text, příloha ani zpráva ve frontě (ty restart nepřežijí).
 */
export function canRestartNow(tabs: Iterable<TabWork>): boolean {
  for (const tab of tabs) {
    if (tab.busy) return false;
    if (tab.inputDraft.trim().length > 0) return false;
    if (tab.pendingAttachments > 0 || tab.pendingUserMessages > 0) return false;
  }
  return true;
}

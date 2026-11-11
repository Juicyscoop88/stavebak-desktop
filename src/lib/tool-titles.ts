import { create } from 'zustand';
import { bridge } from './tauri-bridge';

/**
 * Názvy nástrojů pro projektanta. Nástroje Stavebáku mají český `title` přímo ze serveru (tools/list),
 * desktop si je nevymýšlí. Vnitřní kroky Clauda (načítání nástrojů) se v chatu neukazují.
 */

const STAVEBAK_PREFIX = 'mcp__stavebak__';
const COMPUTER_PREFIX = 'mcp__stavebak-computer__';
/** Lokální server desktopu, názvy jsou tady, ne v tools/list vzdáleného serveru. */
const COMPUTER_TITLES: Record<string, string> = {
  computer_list_apps: 'Otevřené aplikace',
  computer_request_access: 'Žádost o přístup k aplikaci',
  computer_screenshot: 'Snímek okna aplikace',
  computer_click: 'Kliknutí v aplikaci',
  computer_type: 'Psaní do aplikace',
  computer_key: 'Klávesa v aplikaci',
  computer_scroll: 'Posun v aplikaci',
};
const HIDDEN_TOOLS = new Set(['ToolSearch']);

export function isHiddenTool(name?: string): boolean {
  return !!name && HIDDEN_TOOLS.has(name);
}

export const useToolTitles = create<{ titles: Record<string, string> }>(() => ({ titles: {} }));

/** Český název nástroje Stavebáku, nebo null u jiných nástrojů. Bez načtených názvů obecný popisek. */
export function stavebakToolTitle(name: string): string | null {
  if (name.startsWith(COMPUTER_PREFIX)) return COMPUTER_TITLES[name.slice(COMPUTER_PREFIX.length)] ?? 'Ovládání aplikace';
  if (!name.startsWith(STAVEBAK_PREFIX)) return null;
  return useToolTitles.getState().titles[name.slice(STAVEBAK_PREFIX.length)] ?? 'Stavebák';
}

/** Načte názvy ze serveru (jednou po startu, protokol tools/list funguje i bez přihlášení). */
export async function loadToolTitles(): Promise<void> {
  try {
    const { url } = await bridge.getStavebakMcp();
    const tools = await bridge.listMcpTools(url);
    useToolTitles.setState({ titles: Object.fromEntries(tools.filter((t) => t.title).map((t) => [t.name, t.title!])) });
  } catch { /* bez názvů zůstane obecný popisek */ }
}

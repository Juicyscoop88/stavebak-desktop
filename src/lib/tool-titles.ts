import { create } from 'zustand';
import { bridge } from './tauri-bridge';

/**
 * Názvy nástrojů pro projektanta. Nástroje Stavebáku mají český `title` přímo ze serveru (tools/list),
 * desktop si je nevymýšlí. Vnitřní kroky Clauda (načítání nástrojů) se v chatu neukazují.
 */

const STAVEBAK_PREFIX = 'mcp__stavebak__';
const HIDDEN_TOOLS = new Set(['ToolSearch']);

export function isHiddenTool(name?: string): boolean {
  return !!name && HIDDEN_TOOLS.has(name);
}

export const useToolTitles = create<{ titles: Record<string, string> }>(() => ({ titles: {} }));

/** Český název nástroje Stavebáku, nebo null u jiných nástrojů. Bez načtených názvů obecný popisek. */
export function stavebakToolTitle(name: string): string | null {
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

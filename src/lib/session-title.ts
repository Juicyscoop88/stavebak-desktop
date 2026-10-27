import { bridge } from './tauri-bridge';
import { useChatStore } from '../stores/chatStore';

const MAX_TITLE = 60;

/** Název z první zprávy: zkrácený na hranici slova. */
export function titleFromText(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (line.length <= MAX_TITLE) return line;
  const cut = line.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Název konverzace. U Claude ho na pozadí navrhne `claude -p` (haiku). U Codexu nic na pozadí
 * nespouštíme (SIWC Terms §2: běh na pozadí jen se souhlasem) a obsah neposíláme jinému
 * poskytovateli: název je začátek první zprávy.
 */
export function generateTitle(tabId: string, userMsg: string, assistantMsg: string): Promise<string | null> {
  if (useChatStore.getState().getTab(tabId)?.sessionMeta.provider === 'codex') {
    return Promise.resolve(titleFromText(userMsg) || null);
  }
  return bridge.generateSessionTitle(userMsg, assistantMsg);
}

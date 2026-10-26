import { create } from 'zustand';
import { bridge, type CodexStatus, type OpenAiAuthStatus } from '../lib/tauri-bridge';
import { useSettingsStore } from './settingsStore';

/**
 * Přihlášení k OpenAI pro Codex: plán ChatGPT (Sign in with ChatGPT) nebo API klíč.
 * Tokeny drží Rust v klíčence, sem chodí jen stav.
 */
interface OpenAiState {
  status: OpenAiAuthStatus | null;
  codex: CodexStatus | null;
  busy: boolean;
  error: string | null;
  /** Ukázat uvítání „You're using your ChatGPT plan“ (jen po prvním přihlášení) */
  showWelcome: boolean;
  refresh: () => Promise<void>;
  loginChatgpt: () => Promise<boolean>;
  logoutChatgpt: () => Promise<void>;
  setApiKey: (key: string) => Promise<boolean>;
  clearApiKey: () => Promise<void>;
  dismissWelcome: () => void;
}

export const useOpenAiStore = create<OpenAiState>((set, get) => ({
  status: null,
  codex: null,
  busy: false,
  error: null,
  showWelcome: false,

  refresh: async () => {
    const [status, codex] = await Promise.all([
      bridge.openaiAuthStatus().catch(() => null),
      bridge.codexStatus().catch(() => null),
    ]);
    set({ status, codex });
  },

  loginChatgpt: async () => {
    set({ busy: true, error: null });
    try {
      const status = await bridge.openaiLoginChatgpt();
      const firstTime = !useSettingsStore.getState().chatgptWelcomeSeen;
      set({ status, showWelcome: firstTime });
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  logoutChatgpt: async () => {
    set({ busy: true, error: null });
    await bridge.openaiLogoutChatgpt().catch((e) => set({ error: String(e) }));
    set({ busy: false });
    await get().refresh();
  },

  setApiKey: async (key) => {
    set({ busy: true, error: null });
    try {
      await bridge.openaiSetApiKey(key);
      await get().refresh();
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  clearApiKey: async () => {
    await bridge.openaiClearApiKey().catch(() => {});
    await get().refresh();
  },

  dismissWelcome: () => {
    useSettingsStore.getState().setChatgptWelcomeSeen(true);
    set({ showWelcome: false });
  },
}));

/** Codex jde spustit: je nainstalovaný a je čím platit. */
export function codexReady(s: Pick<OpenAiState, 'status' | 'codex'>): boolean {
  return !!s.codex?.installed && !!s.status && (s.status.chatgpt_signed_in || s.status.api_key_set);
}

import { create } from 'zustand';
import { bridge } from '../lib/tauri-bridge';

/**
 * Účet Stavebák: přihlášení (OAuth v Rustu, token v klíčence) a tarif. Tarif a platbu vrací stejné
 * MCP tooly, které používá model (account_status, upgrade), UI nic nepočítá samo.
 */

export type Plan = 'trial' | 'free' | 'pro';

export interface AccountStatus {
  plan: Plan;
  planLabel: string;
  fullAccess: boolean;
  trialEndsAt: string;
  currentPeriodEnd?: string;
  manageUrl?: string;
}

interface AccountState {
  signedIn: boolean | null;
  status: AccountStatus | null;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: () => Promise<boolean>;
  logout: () => Promise<void>;
  /** Otevře platbu (Checkout) nebo správu předplatného v prohlížeči. */
  openBilling: (interval?: 'monthly' | 'yearly') => Promise<void>;
}

function openUrl(url: string) {
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => {});
}

async function serverUrl(): Promise<string> {
  return (await bridge.getStavebakMcp()).url;
}

export const useAccountStore = create<AccountState>()((set, get) => ({
  signedIn: null,
  status: null,
  busy: false,
  error: null,

  refresh: async () => {
    try {
      const signedIn = await bridge.stavebakAuthStatus();
      set({ signedIn });
      if (!signedIn) {
        set({ status: null });
        return;
      }
      const status = await bridge.callMcpTool<AccountStatus>(await serverUrl(), 'account_status', {});
      set({ status, error: null });
    } catch (e) {
      // Obnova tokenu mohla selhat (odhlášeno v Rustu), stav přihlášení načíst znovu
      set({ signedIn: await bridge.stavebakAuthStatus().catch(() => false), error: String(e) });
    }
  },

  login: async () => {
    set({ busy: true, error: null });
    try {
      await bridge.stavebakLogin();
      await get().refresh();
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  logout: async () => {
    await bridge.stavebakLogout().catch(() => {});
    set({ signedIn: false, status: null });
  },

  openBilling: async (interval = 'monthly') => {
    set({ busy: true, error: null });
    try {
      const res = await bridge.callMcpTool<{ checkoutUrl?: string; manageUrl?: string; note?: string }>(
        await serverUrl(), 'upgrade', { interval },
      );
      const url = res.checkoutUrl ?? res.manageUrl;
      if (url) openUrl(url);
      else set({ error: res.note ?? 'Platbu teď nejde otevřít.' });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },
}));

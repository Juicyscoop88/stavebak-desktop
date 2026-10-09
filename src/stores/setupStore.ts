import { create } from 'zustand';

export type SetupStep =
  | 'checking'
  | 'not_installed'
  | 'installing'
  | 'install_failed'
  | 'auth_check'
  | 'needs_auth'
  | 'ready';

interface SetupState {
  step: SetupStep;
  error: string | null;
  cliVersion: string | null;
  cliPath: string | null;
  authStatus: 'unknown' | 'ok' | 'missing';
  accountName: string | null;

  setStep: (step: SetupStep) => void;
  setError: (error: string | null) => void;
  setCliInfo: (version: string | null, path: string | null) => void;
  setAuthStatus: (status: 'unknown' | 'ok' | 'missing') => void;
  setAccountName: (name: string | null) => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()((set) => ({
  step: 'checking',
  error: null,
  cliVersion: null,
  cliPath: null,
  authStatus: 'unknown',
  accountName: null,

  setStep: (step) => set({ step }),

  setError: (error) => set({ error }),

  setCliInfo: (version, path) =>
    set({ cliVersion: version, cliPath: path }),

  setAuthStatus: (authStatus) => set({ authStatus }),

  setAccountName: (accountName) => set({ accountName }),

  reset: () =>
    set({
      step: 'checking',
      error: null,
      cliVersion: null,
      cliPath: null,
      authStatus: 'unknown',
      accountName: null,
    }),
}));

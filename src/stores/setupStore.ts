import { create } from 'zustand';

/** Screens the user moves through. Everything technical runs in the background. */
export type SetupStep =
  | 'checking'   // silent fast path: CLI + auth already fine → straight into the app
  | 'welcome'    // "you need two things"
  | 'claude'     // Claude subscription sign-in
  | 'stavebak'   // Stavebák account (UX mock until OAuth exists)
  | 'done';

/** Background state of the Claude Code runtime the user never has to see. */
export type CliState = 'checking' | 'installing' | 'ready' | 'failed';

interface SetupState {
  step: SetupStep;
  cli: CliState;
  cliPercent: number;
  error: string | null;
  cliVersion: string | null;
  cliPath: string | null;
  authStatus: 'unknown' | 'ok' | 'missing';
  accountName: string | null;
  stavebakDone: boolean;

  setStep: (step: SetupStep) => void;
  setCli: (cli: CliState, error?: string | null) => void;
  setCliPercent: (percent: number) => void;
  setCliInfo: (version: string | null, path: string | null) => void;
  setAuthStatus: (status: 'unknown' | 'ok' | 'missing') => void;
  setAccountName: (name: string | null) => void;
  setStavebakDone: (done: boolean) => void;
  reset: () => void;
}

const initial = {
  step: 'checking' as SetupStep,
  cli: 'checking' as CliState,
  cliPercent: 0,
  error: null,
  cliVersion: null,
  cliPath: null,
  authStatus: 'unknown' as const,
  accountName: null,
  stavebakDone: false,
};

export const useSetupStore = create<SetupState>()((set) => ({
  ...initial,

  setStep: (step) => set({ step }),
  setCli: (cli, error = null) => set({ cli, error }),
  setCliPercent: (cliPercent) => set({ cliPercent }),
  setCliInfo: (version, path) => set({ cliVersion: version, cliPath: path }),
  setAuthStatus: (authStatus) => set({ authStatus }),
  setAccountName: (accountName) => set({ accountName }),
  setStavebakDone: (stavebakDone) => set({ stavebakDone }),
  reset: () => set(initial),
}));

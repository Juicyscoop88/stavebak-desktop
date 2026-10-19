import { create } from 'zustand';

interface UiState {
  /** A plugin view (e.g. a setup form) owns the chat area — hide the composer, keep it mounted. */
  composerHidden: boolean;
  setComposerHidden: (hidden: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  composerHidden: false,
  setComposerHidden: (composerHidden) => set({ composerHidden }),
}));

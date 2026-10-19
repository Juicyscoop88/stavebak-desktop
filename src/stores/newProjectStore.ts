import { create } from 'zustand';
import { bridge } from '../lib/tauri-bridge';
import { useSettingsStore } from './settingsStore';

interface NewProjectState {
  open: boolean;
  show: () => void;
  close: () => void;
}

/** "Nový projekt…" dialog. Its content comes from a plugin (slot `new-project`) when one is registered. */
export const useNewProjectStore = create<NewProjectState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Where new projects go by default: next to the last opened project, else ~/Projects. */
export async function defaultProjectsDir(): Promise<string> {
  const last = useSettingsStore.getState().lastProject;
  if (last) return last.replace(/[\\/][^\\/]+[\\/]?$/, '');
  return `${await bridge.getHomeDir()}/Projects`;
}

/** Folder name from a project name: keep it readable, drop characters a path can't hold. */
export function folderNameFor(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
}

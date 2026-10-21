import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
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

/**
 * Where new projects go: the folder the user last chose with "Změnit", else ~/Documents/Stavebák.
 * Opening some other folder doesn't move it, and a temporary folder never becomes the default.
 */
export async function defaultProjectsDir(): Promise<string> {
  const chosen = useSettingsStore.getState().projectsDir;
  if (chosen && !isTemporaryDir(chosen)) return chosen;
  return `${await bridge.getHomeDir()}/Documents/Stavebák`;
}

/** macOS and Unix temp locations: cleaned by the system, never a home for a project. */
export function isTemporaryDir(dir: string): boolean {
  return /^\/(private\/)?(tmp|var\/folders)(\/|$)/.test(dir);
}

/** "~/Documents/Stavebák/RD" → "Dokumenty › Stavebák › RD", the way Finder names it. */
export function displayPath(dir: string): string {
  return dir
    .replace(/^\/Users\/[^/]+\/Documents(?=\/|$)/, 'Dokumenty')
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    .split('/').filter(Boolean).join(' › ');
}

/** Creates the project folder under `parent`; a taken name gets a number, an existing folder is never reused. */
export function createProjectDirectory(parent: string, name: string): Promise<string> {
  return invoke<string>('create_project_directory', { parent, name: folderNameFor(name) });
}

/** Folder name from a project name: keep it readable, drop characters a path can't hold. */
export function folderNameFor(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
}

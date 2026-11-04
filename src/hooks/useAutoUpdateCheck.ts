import { useEffect } from 'react';
import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';
import { useSettingsStore } from '../stores/settingsStore';
import { isSessionBusy, useChatStore } from '../stores/chatStore';
import { canRestartNow, isUpdateMandatory, type TabWork } from '../lib/update-policy';

// Vynucená aktualizace (desktop #54, #55): projektanti přehlíželi tlačítko s novou verzí a zůstávali
// na verzi s chybou spojení. Postup:
// - kontrola hned po startu a pak každých 10 minut,
// - nalezená verze se stáhne sama na pozadí,
// - povinná verze (update-policy) se nainstaluje sama, ale jen když aplikace nic nedělá
//   a nikde není rozepsaný text (restart ho nepřežije); jinak počká,
// - při startu, kdy ještě nic neběží, ukáže overlay a aktualizuje hned,
// - selhání nikdy nezablokuje práci: zkusit znovu, stáhnout ručně, nebo pokračovat ve staré verzi.

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 1500;
/** Odpočet před restartem během práce, aby to projektanta nepřekvapilo. */
export const RESTART_COUNTDOWN_S = 10;
export const MANUAL_DOWNLOAD_URL = 'https://github.com/Juicyscoop88/stavebak-desktop/releases/latest';

export type UpdatePhase = 'none' | 'downloading' | 'ready' | 'installing' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  version: string;
  mandatory: boolean;
  /** Overlay hned po startu: aktualizuje se dřív, než projektant začne pracovat. */
  blocking: boolean;
  progress: number;
  error: string;
  /** Projektant zvolil „Pokračovat ve staré verzi“: do restartu aplikace už nenutit. */
  dismissed: boolean;
}

export const useUpdateStore = create<UpdateState>(() => ({
  phase: 'none',
  version: '',
  mandatory: false,
  blocking: false,
  progress: 0,
  error: '',
  dismissed: false,
}));

let handle: Update | null = null;
let busy = false; // probíhá kontrola nebo stahování

function tabsWork(): TabWork[] {
  return [...useChatStore.getState().tabs.values()].map((tab) => ({
    busy: isSessionBusy(tab.sessionStatus),
    inputDraft: tab.inputDraft ?? '',
    pendingAttachments: tab.pendingAttachments?.length ?? 0,
    pendingUserMessages: tab.pendingUserMessages?.length ?? 0,
  }));
}

/** Smí aplikace teď restartovat bez ztráty práce? */
export function appIsIdle(): boolean {
  return canRestartNow(tabsWork());
}

async function download(): Promise<void> {
  if (!handle) return;
  useUpdateStore.setState({ phase: 'downloading', progress: 0, error: '' });
  let total = 0;
  let done = 0;
  await handle.download((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0;
    else if (event.event === 'Progress') {
      done += event.data.chunkLength;
      if (total > 0) useUpdateStore.setState({ progress: Math.round((done / total) * 100) });
    }
  });
  useUpdateStore.setState({ phase: 'ready', progress: 100 });
  useSettingsStore.getState().setUpdateDownloaded(true);
}

async function checkAndDownload(startup: boolean): Promise<void> {
  if (busy) return;
  const { phase } = useUpdateStore.getState();
  if (phase === 'ready' || phase === 'installing') return;
  busy = true;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 30_000 });
    if (!update) {
      handle = null;
      useUpdateStore.setState({ phase: 'none', version: '', mandatory: false, blocking: false });
      useSettingsStore.getState().setUpdateAvailable(false);
      return;
    }
    handle = update;
    // Ve vývojovém buildu nikdy nenutit, verze v repu bývá pod posledním releasem.
    const mandatory = !import.meta.env.DEV && isUpdateMandatory(update.currentVersion, update.rawJson);
    useUpdateStore.setState({
      version: update.version,
      mandatory,
      blocking: startup && mandatory && !useUpdateStore.getState().dismissed && appIsIdle(),
    });
    useSettingsStore.getState().setUpdateAvailable(true, update.version);
    await download();
    if (useUpdateStore.getState().blocking) await installAndRestart();
  } catch (e) {
    // Bez sítě se při kontrole nic neukazuje. Chyba stahování nebo instalace se ukáže
    // jen u povinné verze, ostatní zůstane jako tlačítko pro ruční pokus.
    if (handle) useUpdateStore.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}

/** Nainstaluje staženou verzi a restartuje. Na Windows instalátor aplikaci ukončí sám. */
export async function installAndRestart(): Promise<void> {
  if (!handle) return;
  useUpdateStore.setState({ phase: 'installing', error: '' });
  try {
    await handle.install();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    useUpdateStore.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Ruční pokus z tlačítka nebo overlaye: stáhnout znovu, případně rovnou nainstalovat. */
export async function retryUpdate(): Promise<void> {
  const { phase } = useUpdateStore.getState();
  if (phase === 'ready') return installAndRestart();
  if (handle && !busy) {
    busy = true;
    try {
      await download();
    } catch (e) {
      useUpdateStore.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
      return;
    } finally {
      busy = false;
    }
    // Overlay po startu čeká na instalaci, ne na odpočet.
    if (useUpdateStore.getState().blocking) await installAndRestart();
    return;
  }
  return checkAndDownload(false);
}

export function dismissMandatoryUpdate(): void {
  useUpdateStore.setState({ dismissed: true, blocking: false });
}

/** Kontrola po startu a pak každých 10 minut. Stav čte UpdateOverlay a UpdateButton. */
export function useAutoUpdateCheck(): void {
  useEffect(() => {
    const startupTimer = setTimeout(() => void checkAndDownload(true), STARTUP_DELAY_MS);
    const intervalTimer = setInterval(() => void checkAndDownload(false), CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    };
  }, []);
}

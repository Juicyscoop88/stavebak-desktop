import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useNewProjectStore, defaultProjectsDir, folderNameFor, displayPath, createProjectDirectory } from '../../stores/newProjectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openProject } from '../../lib/conversations';
import { PluginSlotStack } from './PluginComponents';

/** Modal host for "Nový projekt…". A plugin fills it (domain form); otherwise a plain name + location form. */
export function NewProjectDialog() {
  const { open, close } = useNewProjectStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={close}>
      <div
        className="w-[440px] max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-bg-card shadow-xl p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PluginSlotStack slot="new-project" fallback={<BasicNewProject />} />
      </div>
    </div>
  );
}

/** Fallback without a plugin: just a folder. */
function BasicNewProject() {
  const close = useNewProjectStore((s) => s.close);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { defaultProjectsDir().then(setParent); }, []);

  const submit = async () => {
    if (!name.trim() || !parent) return;
    setBusy(true);
    const dir = await createProjectDirectory(parent, name);
    close();
    openProject(dir, { fresh: true });
  };

  return (
    <div>
      <h2 className="text-base font-medium text-text-primary mb-4">Nový projekt</h2>
      <input
        autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Název projektu"
        className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border focus:border-border-focus focus:outline-none"
      />
      <LocationRow parent={parent} name={name} onChange={setParent} />
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={close} className="px-3 py-1.5 rounded-lg text-sm text-text-muted hover:bg-bg-secondary cursor-pointer">Zrušit</button>
        <button onClick={submit} disabled={!name.trim() || busy}
          className="px-3 py-1.5 rounded-lg text-sm bg-text-primary text-text-inverse disabled:opacity-40 cursor-pointer">Vytvořit</button>
      </div>
    </div>
  );
}

/** "Uloží se do Dokumenty › Stavebák › <název> [Změnit]" — shared with plugin forms. A folder picked here is remembered. */
export function LocationRow({ parent, name, onChange }: { parent: string; name?: string; onChange: (dir: string) => void }) {
  const setProjectsDir = useSettingsStore((s) => s.setProjectsDir);
  const pick = async () => {
    const dir = await openDialog({ directory: true, multiple: false, defaultPath: parent, title: 'Kam ukládat projekty' });
    if (!dir) return;
    setProjectsDir(dir as string);
    onChange(dir as string);
  };
  const target = name?.trim() ? `${parent}/${folderNameFor(name)}` : parent;
  return (
    <div className="flex items-center gap-2 mt-4 text-xs text-text-muted">
      <span className="shrink-0">Uloží se do</span>
      <span className="text-text-secondary truncate" title={target}>{displayPath(target)}</span>
      <button onClick={pick} className="ml-auto text-text-secondary hover:text-text-primary underline underline-offset-2 cursor-pointer">Změnit</button>
    </div>
  );
}

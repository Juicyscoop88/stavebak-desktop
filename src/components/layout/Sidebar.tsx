import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';
import { CaretLeft, CaretUpDown, Check, FolderPlus, Plus, Trash } from '@phosphor-icons/react';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { open } from '@tauri-apps/plugin-dialog';
import { openProject, deleteProject } from '../../lib/conversations';
import { reportProblem } from '../../lib/report-problem';
import { PluginSlotStack } from './PluginComponents';
import { useNewProjectStore } from '../../stores/newProjectStore';
import { BrandMark } from '../shared/BrandMark';

const FileExplorer = lazy(() => import('../files/FileExplorer').then(m => ({ default: m.FileExplorer })));

export function Sidebar() {
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const t = useT();
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const storedProjects = useSettingsStore((s) => s.projects);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Current project always first, even before it lands in the stored list
  const projects = workingDirectory
    ? [workingDirectory, ...storedProjects.filter((p) => p !== workingDirectory)]
    : storedProjects;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopoverOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [popoverOpen]);

  const handlePickFolder = async () => {
    setPopoverOpen(false);
    const selected = await open({ directory: true, multiple: false, title: t('project.selectFolder') });
    if (selected) openProject(selected as string);
  };

  const handleNewProject = () => {
    setPopoverOpen(false);
    useNewProjectStore.getState().show();
  };

  const handleSwitchProject = (path: string) => {
    setPopoverOpen(false);
    if (path !== workingDirectory) openProject(path);
  };

  const currentName = workingDirectory ? workingDirectory.split(/[\\/]/).pop() : 'Stavebak';

  return (
    <div className="flex flex-col h-full">
      {/* Title bar spacer — 28px for macOS traffic lights */}
      <div className="h-[28px] flex-shrink-0" />

      {/* Header row — logo + project switcher + collapse */}
      <div ref={popoverRef} className="relative flex items-center justify-between h-[36px] pl-3.5 pr-2
        border-b border-border-subtle flex-shrink-0 cursor-default">
        <div className="flex items-center gap-2 min-w-0">
          <BrandMark className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
          <button
            onClick={() => setPopoverOpen(!popoverOpen)}
            className="flex items-center gap-1 min-w-0 hover:bg-bg-tertiary
              rounded-md px-1.5 py-0.5 -ml-1.5 transition-smooth cursor-pointer"
          >
            <span className="text-xs text-text-primary font-medium truncate">
              {currentName}
            </span>
            <CaretUpDown size={10} weight="bold" className="text-text-tertiary flex-shrink-0" />
          </button>
          {/* Project switcher — dropdown under the name, sidebar stays visible */}
          {popoverOpen && (
            <div className="absolute left-2 right-2 top-full mt-1 z-50 max-h-[70vh] overflow-y-auto
              rounded-lg border border-border bg-bg-card shadow-lg p-1.5">
              {projects.length > 0 && (
                <>
                  <div className="text-xs text-text-tertiary font-medium px-2.5 py-1">Projekty</div>
                  {projects.map((path) => {
                    const current = path === workingDirectory;
                    return (
                      <div key={path} title={path}
                        className={`group flex items-center gap-2 pl-2.5 pr-1 py-1.5 rounded-md text-xs cursor-pointer
                          ${current ? 'bg-bg-secondary text-text-primary font-medium' : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'}`}
                        onClick={() => handleSwitchProject(path)}
                      >
                        <span className="flex-1 truncate">{path.split(/[\\/]/).pop()}</span>
                        {current && <Check size={11} className="text-text-muted flex-shrink-0 group-hover:hidden" />}
                        <button
                          onClick={(e) => { e.stopPropagation(); setPopoverOpen(false); setDeleteError(null); setDeleteTarget(path); }}
                          title="Smazat projekt"
                          className="hidden group-hover:block p-0.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary cursor-pointer flex-shrink-0"
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    );
                  })}
                  <div className="h-px bg-border-subtle my-1.5" />
                </>
              )}
              <button onClick={handlePickFolder}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary
                  hover:bg-bg-secondary hover:text-text-primary w-full text-left cursor-pointer">
                <FolderPlus size={13} weight="light" className="text-text-tertiary" />
                {t('sidebar.openFolder')}…
              </button>
              <button onClick={handleNewProject}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary
                  hover:bg-bg-secondary hover:text-text-primary w-full text-left cursor-pointer">
                <Plus size={13} weight="light" className="text-text-tertiary" />
                {t('welcome.newProject')}…
              </button>
            </div>
          )}

        </div>
        <button onClick={toggleSidebar}
          className="p-1 rounded-full hover:bg-bg-tertiary text-text-tertiary
            transition-smooth flex-shrink-0" title={t('sidebar.hide')}>
          <CaretLeft size={12} weight="light" />
        </button>
      </div>

      {/* Plugin panels (e.g. project overview) + file explorer */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {workingDirectory ? (
          <>
            <PluginSlotStack slot="sidebar-top" />
            <div className="flex-1 min-h-0">
              <Suspense fallback={null}>
                <FileExplorer />
              </Suspense>
            </div>
          </>
        ) : null}

      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Smazat projekt"
        message={`Složka „${deleteTarget?.split(/[\\/]/).pop() ?? ''}“ se všemi podklady, výstupy i konverzacemi se přesune do Koše. Dokud Koš nevysypeš, můžeš je odtamtud obnovit.`}
        detail={deleteError ?? deleteTarget ?? undefined}
        extraAction={deleteError ? {
          label: 'Nahlásit chybu',
          onClick: () => { reportProblem({ summary: 'Nejde smazat projekt', error: deleteError, redact: deleteTarget ? [deleteTarget] : [] }).catch(() => {}); },
        } : undefined}
        variant="danger"
        confirmLabel="Přesunout do Koše"
        onConfirm={async () => {
          const dir = deleteTarget!;
          try {
            await deleteProject(dir);
            setDeleteTarget(null);
          } catch (e) {
            setDeleteError(`Nepodařilo se smazat: ${e}`);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { useT } from '../../lib/i18n';
import { IS_ALPHA } from '../../lib/edition';
import { CaretLeft, CaretUpDown, Folder, FolderPlus, Plus } from '@phosphor-icons/react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const FileExplorer = lazy(() => import('../files/FileExplorer').then(m => ({ default: m.FileExplorer })));

export function Sidebar() {
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const t = useT();
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const setWorkingDirectory = useSettingsStore((s) => s.setWorkingDirectory);
  const recentProjects = useFileStore((s) => s.recentProjects);
  const fetchProjects = useFileStore((s) => s.fetchRecentProjects);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (popoverOpen) fetchProjects();
  }, [popoverOpen]);

  useEffect(() => {
    if (!popoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popoverOpen]);

  const handlePickFolder = async () => {
    setPopoverOpen(false);
    const selected = await open({ directory: true, multiple: false, title: t('project.selectFolder') });
    if (selected) setWorkingDirectory(selected as string);
  };

  const handleNewProject = async () => {
    setPopoverOpen(false);
    const dir = await open({ directory: true, multiple: false, title: t('welcome.pickParentDir') });
    if (!dir) return;
    const name = window.prompt(t('welcome.projectNamePlaceholder'));
    if (!name?.trim()) return;
    const sep = (dir as string).endsWith('/') ? '' : '/';
    const fullPath = `${dir}${sep}${name.trim()}`;
    await invoke('create_project_directory', { path: fullPath });
    setWorkingDirectory(fullPath);
  };

  const handleSwitchProject = (path: string) => {
    setPopoverOpen(false);
    setWorkingDirectory(path);
  };

  const currentName = workingDirectory ? workingDirectory.split(/[\\/]/).pop() : 'Stavebak';

  return (
    <div className="flex flex-col h-full">
      {/* Title bar spacer — 28px for macOS traffic lights */}
      <div className="h-[28px] flex-shrink-0" />

      {/* Header row — logo + project switcher + collapse */}
      <div className="flex items-center justify-between h-[36px] pl-3.5 pr-2
        border-b border-border-subtle flex-shrink-0 cursor-default">
        <div className="relative flex items-center gap-2 min-w-0">
          {IS_ALPHA ? (
            <span className="text-xs font-semibold tracking-tight text-text-primary flex-shrink-0">
              TC<span style={{color: 'var(--color-accent)'}}>/ </span>Alpha
            </span>
          ) : (
            <svg className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" viewBox="0 0 80 80" fill="none">
              <path d="m60.49 28.48v-11.87h-7.3v7.73l-10.54-6-30.64 14.07v6.61l30.6-14.06 25.68 14.44v-6.52l-7.8-4.4z" fill="currentColor" />
              <path d="m17.57 38.99v22.76h6.89v-25.89c-2.39 0.98-4.73 2.23-6.89 3.13z" fill="currentColor" />
              <path d="m56.05 35.59v26.16h6.82v-22.56l-6.82-3.6z" fill="currentColor" />
              <path d="m45.56 44.09-9.16-2.07c-1.3-0.29-1.85-0.98-1.85-1.85 0-0.88 0.87-1.48 1.86-1.48h14.46v-6.66h-14.04c-6.3 0-9.51 3.74-9.51 8.33 0 4.8 3.11 7.43 7.92 8.48l8.21 1.77c1.52 0.33 2.15 0.97 2.15 1.94 0 1.13-0.93 1.86-2.13 1.86l-16.25 0.05v7.29l14.14-0.05c7.51 0 11.65-4.08 11.65-9.43 0-4.44-2.84-7.18-7.45-8.18z" fill="currentColor" />
            </svg>
          )}
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

        </div>
        <button onClick={toggleSidebar}
          className="p-1 rounded-full hover:bg-bg-tertiary text-text-tertiary
            transition-smooth flex-shrink-0" title={t('sidebar.hide')}>
          <CaretLeft size={12} weight="light" />
        </button>
      </div>

      {/* File explorer — direct, no panel switcher */}
      <div className="flex-1 overflow-hidden relative">
        {workingDirectory ? (
          <Suspense fallback={null}>
            <FileExplorer />
          </Suspense>
        ) : null}

        {/* Project switcher — overlays file explorer area */}
        {popoverOpen && (
          <div ref={popoverRef} className="absolute inset-0 z-50
            bg-bg-card border-b border-border-subtle
            animate-scale-in overflow-y-auto">
            {/* Actions */}
            <div className="p-1.5">
              <button
                onClick={handlePickFolder}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg
                  text-xs text-text-primary hover:bg-bg-secondary
                  transition-smooth w-full text-left cursor-pointer"
              >
                <FolderPlus size={14} weight="light" className="text-text-tertiary" />
                {t('sidebar.openFolder')}
              </button>
              <button
                onClick={handleNewProject}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg
                  text-xs text-text-muted hover:bg-bg-secondary hover:text-text-primary
                  transition-smooth w-full text-left cursor-pointer"
              >
                <Plus size={14} weight="light" className="text-text-tertiary" />
                {t('welcome.newProject')}
              </button>
            </div>

            {/* Recent projects */}
            {recentProjects.length > 0 && (
              <>
                <div className="h-px bg-border-subtle mx-1.5" />
                <div className="p-1.5">
                  <div className="text-xs text-text-tertiary font-medium px-2.5 py-1">
                    {t('sidebar.recent')}
                  </div>
                  {recentProjects.slice(0, 6).map((project) => (
                    <button
                      key={project.path}
                      onClick={() => handleSwitchProject(project.path)}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg
                        text-xs transition-smooth w-full text-left cursor-pointer
                        ${project.path === workingDirectory
                          ? 'text-text-primary bg-bg-secondary font-medium'
                          : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
                        }`}
                      title={project.shortPath}
                    >
                      <Folder size={12} weight="light" className="flex-shrink-0 text-text-tertiary" />
                      <span className="truncate">{project.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

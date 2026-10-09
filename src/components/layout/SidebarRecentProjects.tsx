import { useEffect } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '../../lib/i18n';
import { FolderPlus, Plus, Folder } from '@phosphor-icons/react';

export function SidebarRecentProjects() {
  const t = useT();
  const setWorkingDirectory = useSettingsStore((s) => s.setWorkingDirectory);
  const recentProjects = useFileStore((s) => s.recentProjects);
  const fetchProjects = useFileStore((s) => s.fetchRecentProjects);

  useEffect(() => { fetchProjects(); }, []);

  const handlePickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('project.selectFolder'),
    });
    if (selected) setWorkingDirectory(selected as string);
  };

  const handleNewProject = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: t('welcome.pickParentDir'),
    });
    if (!dir) return;
    const name = window.prompt(t('welcome.projectNamePlaceholder'));
    if (!name?.trim()) return;
    const sep = (dir as string).endsWith('/') ? '' : '/';
    const fullPath = `${dir}${sep}${name.trim()}`;
    await invoke('create_project_directory', { path: fullPath });
    setWorkingDirectory(fullPath);
  };

  return (
    <div className="flex flex-col w-full px-3 gap-1">
      {/* Browse button */}
      <button
        onClick={handlePickFolder}
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg
          text-xs font-medium text-accent
          hover:bg-accent/8 transition-smooth w-full"
      >
        <FolderPlus size={14} weight="light" className="shrink-0" />
        {t('sidebar.openFolder')}
      </button>

      {/* New project button */}
      <button
        onClick={handleNewProject}
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg
          text-xs font-medium text-text-muted
          hover:bg-accent/8 hover:text-accent transition-smooth w-full"
      >
        <Plus size={14} weight="light" className="shrink-0" />
        {t('welcome.newProject')}
      </button>

      {/* Recent projects */}
      {recentProjects.length > 0 && (
        <>
          <div className="text-xs font-medium text-text-quaternary uppercase
            tracking-wider px-3 pt-3 pb-1">
            {t('sidebar.recent')}
          </div>
          {recentProjects.slice(0, 6).map((project) => (
            <button
              key={project.path}
              onClick={() => setWorkingDirectory(project.path)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg
                text-xs text-text-muted
                hover:bg-bg-tertiary hover:text-text-primary
                transition-smooth w-full text-left"
              title={project.shortPath}
            >
              <Folder size={12} weight="light" className="flex-shrink-0 text-text-quaternary" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

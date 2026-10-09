import { useEffect, useCallback } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { open } from '@tauri-apps/plugin-dialog';
import { useT } from '../../lib/i18n';
import { FolderPlus, Folder } from '@phosphor-icons/react';

/**
 * One-time project selector shown before a project is chosen.
 * Once a project is selected this component is unmounted by the parent.
 */
export function ProjectSelector() {
  const t = useT();
  const setWorkingDirectory = useSettingsStore((s) => s.setWorkingDirectory);
  const recentProjects = useFileStore((s) => s.recentProjects);
  const fetchProjects = useFileStore((s) => s.fetchRecentProjects);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('project.selectFolder'),
    });
    if (selected) {
      setWorkingDirectory(selected as string);
    }
  }, [setWorkingDirectory, t]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Browse folder chip */}
      <button
        onClick={handlePickFolder}
        className="inline-flex items-center gap-1.5 px-3 py-1.5
          rounded-lg border border-dashed border-border-subtle
          text-xs text-text-tertiary
          hover:border-accent hover:text-accent
          hover:bg-accent/5 transition-smooth"
      >
        <FolderPlus size={12} weight="light" className="flex-shrink-0" />
        {t('project.selectBtn')}
      </button>

      {/* Recent project chips */}
      {recentProjects.slice(0, 4).map((project) => (
        <button
          key={project.path}
          onClick={() => setWorkingDirectory(project.path)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5
            rounded-lg border border-border-subtle text-xs
            text-text-muted hover:border-border-focus
            hover:text-text-primary transition-smooth"
          title={project.shortPath}
        >
          <Folder size={11} weight="light" className="flex-shrink-0 text-text-tertiary" />
          {project.name}
        </button>
      ))}
    </div>
  );
}

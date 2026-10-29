/**
 * Technical files in the project root (memory for Claude, project state for Stavebák).
 * They stay on disk under their own names; the UI only shows a readable name and what they are for.
 */
const PROJECT_FILES: Record<string, string> = {
  'stavebak.json': 'projectFiles.stavebakJson',
  'CLAUDE.md': 'projectFiles.claudeMd',
};

/** Display order of the pinned files. */
export const PROJECT_FILE_KEYS = Object.values(PROJECT_FILES);

/** Project notes (CLAUDE.md) open ready for writing and save on their own. */
export const PROJECT_NOTES_KEY = 'projectFiles.claudeMd';

export function isProjectNotes(path: string, rootPath: string): boolean {
  return projectFileKey(path, rootPath) === PROJECT_NOTES_KEY;
}

function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = normalized.lastIndexOf('/');
  return { dir: normalized.slice(0, i), name: normalized.slice(i + 1) };
}

/** i18n key prefix (`.label`, `.hint`) for a technical file directly in the project root, otherwise null. */
export function projectFileKey(path: string, rootPath: string): string | null {
  if (!rootPath) return null;
  const { dir, name } = splitPath(path);
  if (dir !== rootPath.replace(/\\/g, '/').replace(/\/+$/, '')) return null;
  return PROJECT_FILES[name] ?? null;
}

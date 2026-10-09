import { FileNode } from '../lib/tauri-bridge';

/** Known code/config/doc/image file extensions shared by chat path detection. */
export const KNOWN_FILE_EXTENSIONS = new Set([
  'md', 'mdx', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl',
  'toml', 'yaml', 'yml', 'py', 'pyi', 'rs', 'go', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'vue', 'svelte', 'sh', 'bash', 'zsh', 'fish',
  'env', 'conf', 'cfg', 'ini', 'xml', 'sql', 'graphql', 'gql', 'proto',
  'lock', 'log', 'txt', 'csv', 'rb', 'php', 'java', 'kt', 'swift', 'c',
  'cpp', 'h', 'hpp', 'cs', 'r', 'lua', 'zig', 'ex', 'exs', 'erl', 'ml',
  'mli', 'tf', 'hcl', 'dockerfile', 'makefile', 'png', 'jpg', 'jpeg',
  'gif', 'svg', 'webp', 'ico', 'wasm', 'map', 'pdf', 'doc', 'docx',
]);

/** Path prefixes: absolute, relative, drive letter, dotfiles, common project dirs.
 *  A prefix match is treated as a path; extension is optional (#110). */
const PATH_PREFIX_RE = /^(?:\/|\.\/|\.\.\/|[a-zA-Z]:[/\\]|\.[a-zA-Z][\w.-]*\/|src\/|lib\/|components\/|stores\/|hooks\/|utils\/|tests\/|__tests__\/)/;

/**
 * Classify backtick-wrapped text as 'file', 'folder', or null.
 *
 * No-whitespace is the key guard to avoid false positives on prose or inline code.
 * - No space + known prefix -> 'file'/'folder' (extension optional)
 * - No space + known extension -> 'file'
 * - No space + trailing / -> 'folder'
 * - Otherwise -> null
 */
export function classifyPathToken(text: string): 'file' | 'folder' | null {
  const trimmed = text.trim();
  if (trimmed.length <= 1 || /\s/.test(trimmed)) return null;
  if (PATH_PREFIX_RE.test(trimmed)) {
    return trimmed.endsWith('/') ? 'folder' : 'file';
  }
  const ext = trimmed.split('.').pop()?.toLowerCase() ?? '';
  if (KNOWN_FILE_EXTENSIONS.has(ext)) return 'file';
  if (trimmed.endsWith('/')) return 'folder';
  return null;
}

/** Resolve path text to absolute (relative paths joined to base), strip trailing slash. */
export function resolvePathToken(text: string, base: string): string {
  const cleaned = text.trim().replace(/\/+$/, '');
  if (cleaned.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(cleaned)) return cleaned;
  return base ? `${base.replace(/\/$/, '')}/${cleaned}` : cleaned;
}

/** Strip trailing slashes; preserves bare '/'. */
export function normalizePath(p: string): string {
  if (p === '/') return p;
  return p.replace(/\/+$/, '');
}

/**
 * Compute which folders must be expanded to reveal targetPath in the tree.
 *
 * Pure function: returns all ancestor dirs of targetPath under rootPath;
 * if targetIsDir, includes targetPath itself. Always returns a new array.
 *
 * Returns [] when target is outside root, equals root, or is a top-level file.
 */
export function computeRevealExpansions(
  targetPath: string,
  rootPath: string,
  targetIsDir: boolean,
): string[] {
  const target = normalizePath(targetPath);
  const root = normalizePath(rootPath);
  if (!root || !target) return [];
  if (target === root) return [];
  if (!target.startsWith(root + '/')) return [];

  const rel = target.slice(root.length + 1);
  const parts = rel.split('/').filter(Boolean);
  const result: string[] = [];
  let cur = root;
  // Ancestor dirs = every segment except the last
  for (let i = 0; i < parts.length - 1; i++) {
    cur = `${cur}/${parts[i]}`;
    result.push(cur);
  }
  // Target is a directory -> expand it too
  if (targetIsDir) result.push(target);
  return result;
}

/** Find a node by absolute path in the file tree. Returns null if not loaded. */
export function findNodeByPath(tree: FileNode[], path: string): FileNode | null {
  const target = normalizePath(path);
  for (const node of tree) {
    const nodePath = normalizePath(node.path);
    if (nodePath === target) return node;
    if (node.is_dir && node.children && target.startsWith(nodePath + '/')) {
      const found = findNodeByPath(node.children, target);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Reconcile an absolute path whose prefix may differ from the real rootPath
 * (e.g. iCloud `com~apple~CloudDocs` vs `com-apple-CloudDocs`).
 *
 * Uses the last segment of root as an anchor to re-align the path.
 * Returns the original path if already under root or no anchor match.
 */
export function reconcilePathToRoot(target: string, root: string): string {
  const t = normalizePath(target);
  const r = normalizePath(root);
  if (!r || t === r || t.startsWith(r + '/')) return t;
  const rootName = r.split('/').pop() || '';
  if (!rootName) return t;
  const anchor = t.indexOf(`/${rootName}/`);
  if (anchor === -1) return t;
  return `${r}/${t.slice(anchor + rootName.length + 2)}`;
}

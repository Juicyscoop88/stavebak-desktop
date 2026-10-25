import { describe, it, expect } from 'vitest';
import { classifyPathToken, computeRevealExpansions, findNodeByPath, normalizePath, reconcilePathToRoot, resolvePathToken } from '../fileReveal';
import type { FileNode } from '../../lib/tauri-bridge';

describe('normalizePath', () => {
  it('strips trailing slashes (including multiple)', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b');
    expect(normalizePath('/a/b///')).toBe('/a/b');
  });
  it('returns as-is when no trailing slash', () => {
    expect(normalizePath('/a/b')).toBe('/a/b');
  });
  it('preserves root slash', () => {
    expect(normalizePath('/')).toBe('/');
  });
});

// Clicking a path reference in chat should expand to it in the file tree.
// computeRevealExpansions computes which folders need expanding, then feeds them to fileStore.
describe('computeRevealExpansions (which ancestor folders to expand when revealing)', () => {
  const root = '/root';

  it('deep file: expands each parent directory, excludes the file itself', () => {
    expect(computeRevealExpansions('/root/a/b/c.md', root, false))
      .toEqual(['/root/a', '/root/a/b']);
  });

  it('deep folder: expands each parent directory + the folder itself', () => {
    expect(computeRevealExpansions('/root/a/b/c', root, true))
      .toEqual(['/root/a', '/root/a/b', '/root/a/b/c']);
  });

  it('folder path with trailing slash is handled correctly', () => {
    expect(computeRevealExpansions('/root/a/b/c/', root, true))
      .toEqual(['/root/a', '/root/a/b', '/root/a/b/c']);
  });

  it('Chinese + numeric-prefix path (real workspace shape)', () => {
    expect(computeRevealExpansions('/root/01_Her/02_创业系统/_增长线/', root, true))
      .toEqual(['/root/01_Her', '/root/01_Her/02_创业系统', '/root/01_Her/02_创业系统/_增长线']);
  });

  it('top-level file: no ancestors to expand', () => {
    expect(computeRevealExpansions('/root/x.md', root, false)).toEqual([]);
  });

  it('top-level folder: only expands itself', () => {
    expect(computeRevealExpansions('/root/x', root, true)).toEqual(['/root/x']);
  });

  it('target is the root: returns empty', () => {
    expect(computeRevealExpansions('/root', root, false)).toEqual([]);
  });

  it('target not under root: returns empty (cannot locate)', () => {
    expect(computeRevealExpansions('/other/a', root, true)).toEqual([]);
  });

  it('root with trailing slash is also supported', () => {
    expect(computeRevealExpansions('/root/a/b', '/root/', true))
      .toEqual(['/root/a', '/root/a/b']);
  });

  it('similar prefix but not a real sub-path (/root2 is not under /root)', () => {
    expect(computeRevealExpansions('/root2/a', root, true)).toEqual([]);
  });
});

describe('findNodeByPath (find a node in the tree by absolute path)', () => {
  const tree: FileNode[] = [
    { name: '01_Her', path: '/root/01_Her', is_dir: true, children: [
      { name: '02_创业系统', path: '/root/01_Her/02_创业系统', is_dir: true, children: [
        { name: '_增长线', path: '/root/01_Her/02_创业系统/_增长线', is_dir: true, children: [] },
        { name: 'a.md', path: '/root/01_Her/02_创业系统/a.md', is_dir: false, children: null },
      ] },
    ] },
    { name: 'readme.md', path: '/root/readme.md', is_dir: false, children: null },
  ];

  it('finds a deep folder', () => {
    expect(findNodeByPath(tree, '/root/01_Her/02_创业系统/_增长线')?.is_dir).toBe(true);
  });
  it('finds a deep file', () => {
    expect(findNodeByPath(tree, '/root/01_Her/02_创业系统/a.md')?.is_dir).toBe(false);
  });
  it('target with trailing slash still matches', () => {
    expect(findNodeByPath(tree, '/root/01_Her/02_创业系统/_增长线/')?.name).toBe('_增长线');
  });
  it('top-level file', () => {
    expect(findNodeByPath(tree, '/root/readme.md')?.is_dir).toBe(false);
  });
  it('returns null when not found', () => {
    expect(findNodeByPath(tree, '/root/不存在/x')).toBe(null);
  });
});

// Backtick-wrapped text in chat needs to be classified as file / folder / neither.
// Key requirement: support Chinese paths (old rules only recognized English-prefix paths).
describe('classifyPathToken (determine whether backtick content is a path)', () => {
  it('Chinese relative path file -> file', () => {
    expect(classifyPathToken('01_Her/02_创业系统/_增长线/6.7看板.html')).toBe('file');
  });
  it('Chinese bare filename -> file', () => {
    expect(classifyPathToken('数据05-31.html')).toBe('file');
  });
  it('English bare filename -> file', () => {
    expect(classifyPathToken('package.json')).toBe('file');
  });
  it('Chinese folder (trailing slash) -> folder', () => {
    expect(classifyPathToken('01_Her/02_创业系统/_增长线/')).toBe('folder');
  });
  it('plain inline code useState -> null', () => {
    expect(classifyPathToken('useState')).toBe(null);
  });
  it('Math.PI is not a known extension -> null', () => {
    expect(classifyPathToken('Math.PI')).toBe(null);
  });
  it('full path with spaces -> null (avoid misclassifying sentences)', () => {
    expect(classifyPathToken('/Users/x/Mobile Documents/a/6.7看板.html')).toBe(null);
  });
  it('single character -> null', () => {
    expect(classifyPathToken('a')).toBe(null);
  });
  // Prefix detection (#110): when there is a clear path prefix, extension is optional
  it('project directory prefix + no extension -> file', () => {
    expect(classifyPathToken('src/build')).toBe('file');
  });
  it('relative prefix ./ + no extension -> file', () => {
    expect(classifyPathToken('./scripts/deploy')).toBe('file');
  });
  it('hidden directory prefix .claude/ -> file', () => {
    expect(classifyPathToken('.claude/settings.local')).toBe('file');
  });
  it('hidden directory itself (trailing slash) -> folder', () => {
    expect(classifyPathToken('.github/')).toBe('folder');
  });
  it('drive letter prefix + no extension -> file', () => {
    expect(classifyPathToken('C:\\Users\\x\\bin')).toBe('file');
  });
  it('absolute path + no extension -> file', () => {
    expect(classifyPathToken('/usr/local/bin/claude')).toBe('file');
  });
});

describe('resolvePathToken (join relative path into absolute path)', () => {
  const base = '/root';
  it('joins relative path under base', () => {
    expect(resolvePathToken('01_Her/a.md', base)).toBe('/root/01_Her/a.md');
  });
  it('folder trailing slash is stripped', () => {
    expect(resolvePathToken('01_Her/_增长线/', base)).toBe('/root/01_Her/_增长线');
  });
  it('absolute path returned as-is (only strips trailing slash)', () => {
    expect(resolvePathToken('/abs/path/a.md', base)).toBe('/abs/path/a.md');
  });
  it('base with trailing slash is also supported', () => {
    expect(resolvePathToken('a.md', '/root/')).toBe('/root/a.md');
  });
});

// Full paths given by AI in chat often have an iCloud prefix segment that doesn't match
// the real filesystem (com~apple~CloudDocs vs com-apple-CloudDocs / segment missing entirely)
// -> reconcile back to the real root before locating.
describe('reconcilePathToRoot (align inaccurate absolute path prefix back to real root)', () => {
  const root = '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/2026工作间';

  it('full path with missing iCloud segment -> aligned back to real root', () => {
    expect(reconcilePathToRoot('/Users/x/Library/Mobile Documents/2026工作间/01_Her/6.7看板.html', root))
      .toBe('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/2026工作间/01_Her/6.7看板.html');
  });
  it('iCloud segment written with hyphens -> aligned back to real root', () => {
    expect(reconcilePathToRoot('/Users/x/Library/Mobile Documents/com-apple-CloudDocs/2026工作间/01_Her/6.7看板.html', root))
      .toBe('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/2026工作间/01_Her/6.7看板.html');
  });
  it('already under real root -> returned as-is', () => {
    const p = `${root}/01_Her/6.7看板.html`;
    expect(reconcilePathToRoot(p, root)).toBe(p);
  });
  it('workspace name anchor not found -> returned as-is', () => {
    expect(reconcilePathToRoot('/totally/different/a.html', root)).toBe('/totally/different/a.html');
  });
  it('trailing slash is normalized first', () => {
    expect(reconcilePathToRoot('/Users/x/Library/Mobile Documents/2026工作间/01_Her/', root))
      .toBe(`${root}/01_Her`);
  });
});

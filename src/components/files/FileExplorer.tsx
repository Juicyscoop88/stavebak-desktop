import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileNode } from '../../lib/tauri-bridge';
import { useFileStore, FileChangeKind } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { isMac } from '../../lib/platform';
import { useT } from '../../lib/i18n';
import { startTreeDrag, moveTreeDrag, endTreeDrag } from '../../lib/drag-state';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { FileIcon } from '../shared/FileIcon';
import { projectFileKey } from '../../lib/project-files';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { FilePlus, FolderPlus, ClipboardText, CopySimple, Copy, PencilSimple, Trash, Folder, ArrowSquareOut, CaretRight, ShareNetwork, Play } from '@phosphor-icons/react';

function getChangeBadge(kind: FileChangeKind | undefined) {
  if (!kind) return null;
  const colors = {
    created: 'bg-success',
    modified: 'bg-success',
    removed: 'bg-error',
  };
  const labels = { created: 'A', modified: 'M', removed: 'D' };
  return (
    <span className={`ml-auto flex-shrink-0 w-4 h-4 rounded text-2xs
      font-semibold text-text-inverse flex items-center justify-center ${colors[kind]}`}>
      {labels[kind]}
    </span>
  );
}

// --- Context Menu ---
interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

interface ContextMenuCallbacks {
  onCopyPath: (path: string) => void;
  onCopyFile: (path: string) => void;
  onPaste: (targetDir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onInsertToChat: (path: string) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  clipboardPath: string | null;
}

type MenuItem = { label: string; icon: React.ReactNode; action: () => void; danger?: boolean } | 'separator';

function ContextMenu({ menu, onClose, callbacks }: {
  menu: ContextMenuState;
  onClose: () => void;
  callbacks: ContextMenuCallbacks;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > vw - 8) x = vw - rect.width - 8;
    if (y + rect.height > vh - 8) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    setPos({ x, y });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const items: MenuItem[] = [
    ...(menu.isDir ? [
      {
        label: t('files.newFile'),
        icon: <FilePlus size={12} weight="light" />,
        action: () => { callbacks.onNewFile(menu.path); onClose(); },
      },
      {
        label: t('files.newFolder'),
        icon: <FolderPlus size={12} weight="light" />,
        action: () => { callbacks.onNewFolder(menu.path); onClose(); },
      },
      'separator' as const,
    ] as MenuItem[] : []),
    ...(!menu.isDir ? [{
      label: t('files.insertToChat'),
      icon: <ClipboardText size={12} weight="light" />,
      action: () => { callbacks.onInsertToChat(menu.path); onClose(); },
    }] as MenuItem[] : []),
    {
      label: t('files.copyPath'),
      icon: <CopySimple size={12} weight="light" />,
      action: () => { callbacks.onCopyPath(menu.path); onClose(); },
    },
    ...(!menu.isDir ? [{
      label: t('files.copyFile'),
      icon: <Copy size={12} weight="light" />,
      action: () => { callbacks.onCopyFile(menu.path); onClose(); },
    }] as MenuItem[] : []),
    ...(menu.isDir && callbacks.clipboardPath ? [{
      label: t('files.paste'),
      icon: <ClipboardText size={12} weight="light" />,
      action: () => { callbacks.onPaste(menu.path); onClose(); },
    }] as MenuItem[] : []),
    'separator',
    {
      label: t('files.rename'),
      icon: <PencilSimple size={12} weight="light" />,
      action: () => { callbacks.onRename(menu.path); onClose(); },
    },
    {
      label: t('files.delete'),
      icon: <Trash size={12} weight="light" />,
      action: () => { callbacks.onDelete(menu.path, menu.isDir); onClose(); },
      danger: true,
    },
    'separator',
    {
      label: t('files.revealInFinder'),
      icon: <Folder size={12} weight="light" />,
      action: () => { bridge.revealInFinder(menu.path); onClose(); },
    },
    {
      label: t('files.openDefault'),
      icon: <ArrowSquareOut size={12} weight="light" />,
      action: () => { bridge.openWithDefaultApp(menu.path); onClose(); },
    },
    ...(isMac() ? [
      {
        label: t('files.share'),
        icon: <ShareNetwork size={12} weight="light" />,
        action: () => { bridge.shareFile(menu.path); onClose(); },
      },
    ] : []),
    {
      label: t('files.openVscodeShort'),
      icon: <Play size={12} weight="light" />,
      action: () => { bridge.openInVscode(menu.path); onClose(); },
    },
  ];

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[200px] py-1 rounded-xl border border-border-subtle
        bg-bg-card shadow-lg animate-fade-in whitespace-nowrap"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 border-t border-border-subtle" />
        ) : (
          <button
            key={i}
            onClick={item.action}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs
              hover:bg-bg-secondary transition-smooth text-left cursor-pointer
              ${item.danger ? 'text-error hover:bg-error/10' : 'text-text-primary'}`}
          >
            <span className={`flex-shrink-0 ${item.danger ? 'text-error/60' : 'text-text-tertiary'}`}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// --- Tree Node ---

function TreeNode({
  node,
  depth,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  creatingIn,
  createName,
  onCreateNameChange,
  onCreateSubmit,
  onCreateCancel,
}: {
  node: FileNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  creatingIn: { dir: string; type: 'file' | 'folder' } | null;
  createName: string;
  onCreateNameChange: (v: string) => void;
  onCreateSubmit: () => void;
  onCreateCancel: () => void;
}) {
  const expanded = useFileStore((s) => s.expandedFolders.has(node.path));
  const toggleFolder = useFileStore((s) => s.toggleFolder);
  const selectFile = useFileStore((s) => s.selectFile);
  // Highlight based on revealTarget (folders can be highlighted too); selectFile sets it
  const isActive = useFileStore((s) => s.revealTarget === node.path);
  const changeKind = useFileStore((s) => s.changedFiles.get(node.path));
  const rootPath = useFileStore((s) => s.rootPath);
  const t = useT();
  const projectFile = node.is_dir ? null : projectFileKey(node.path, rootPath);
  const dirPrefix = node.path + '/';
  const hasChildChanges = useFileStore((s) =>
    node.is_dir
      ? Array.from(s.changedFiles.keys()).some((p) => p.startsWith(dirPrefix))
      : false
  );

  const isExpanded = expanded;
  const rowRef = useRef<HTMLButtonElement>(null);

  // Scroll into view when this node is the reveal target
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);

  const handleClick = () => {
    if (node.is_dir) {
      toggleFolder(node.path);
    } else {
      selectFile(node.path);
    }
  };

  return (
    <div>
      <button
        ref={rowRef}
        onClick={handleClick}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const startX = e.clientX;
          const startY = e.clientY;
          let started = false;

          const onMove = (me: MouseEvent) => {
            if (!started) {
              const dx = me.clientX - startX;
              const dy = me.clientY - startY;
              if (dx * dx + dy * dy < 25) return; // 5px threshold
              started = true;
              startTreeDrag(node.path, node.is_dir);
            }
            moveTreeDrag(me.clientX, me.clientY);
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (started) {
              // Prevent the click event from firing after drag
              const suppressClick = (ce: MouseEvent) => {
                ce.stopPropagation();
                ce.preventDefault();
              };
              document.addEventListener('click', suppressClick, { capture: true, once: true });
              // End drag (cleans up ghost + detects drop target)
              const result = endTreeDrag();
              if (result) {
                if (result.targetFolder) {
                  // Drop on folder → move file
                  const fileName = result.sourcePath.split(/[\\/]/).pop() || '';
                  const dest = `${result.targetFolder}/${fileName}`;
                  bridge.renameFile(result.sourcePath, dest)
                    .then(() => {
                      const dir = useSettingsStore.getState().workingDirectory
                        || useFileStore.getState().rootPath;
                      if (dir) useFileStore.getState().refreshTree(dir);
                    })
                    .catch((err: unknown) => console.error('Failed to move file:', err));
                } else if (!result.droppedInTree) {
                  // Drop outside file tree → insert file chip in chat
                  window.dispatchEvent(
                    new CustomEvent('stavebak:tree-file-inline', { detail: result.sourcePath }),
                  );
                }
              }
            }
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node.path, node.is_dir);
        }}
        {...(node.is_dir ? { 'data-dir-path': node.path } : {})}
        title={projectFile
          ? `${t(`${projectFile}.hint`)}\n${t('projectFiles.fileOnDisk').replace('{name}', node.name)}`
          : undefined}
        className={`w-full flex items-center gap-2 py-1 px-2.5 rounded-md
          text-left text-sm leading-5 group
          ${isActive
            ? 'bg-accent/10 text-accent'
            : changeKind
              ? 'text-success'
              : projectFile
                ? 'text-text-tertiary hover:bg-bg-secondary hover:text-text-primary'
                : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
          }`}
        style={{ paddingLeft: `${depth * 16 + 10}px` }}
      >
        <span className="flex-shrink-0 w-3.5 flex items-center">
          {node.is_dir ? (
            <CaretRight size={10} weight="light"
              className={`text-text-tertiary transition-transform duration-150
                ${isExpanded ? 'rotate-90' : ''}`} />
          ) : (
            <FileIcon name={node.name} size={14}
              className={projectFile ? 'text-text-tertiary' : 'text-accent'} />
          )}
        </span>
        {renamingPath === node.path ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-xs bg-bg-input border border-border-focus
              rounded-lg px-1.5 py-0.5 outline-none text-text-primary"
          />
        ) : (
          <span className="truncate">{projectFile ? t(`${projectFile}.label`) : node.name}</span>
        )}
        {getChangeBadge(changeKind)}
        {!changeKind && hasChildChanges && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success
            flex-shrink-0" />
        )}
      </button>
      {node.is_dir && isExpanded && node.children && (
        <div>
          {creatingIn?.dir === node.path && (
            <div className="flex items-center gap-2.5 py-2 px-2.5"
              style={{ paddingLeft: `${(depth + 1) * 16 + 10}px` }}>
              <FileIcon name={creatingIn.type === 'folder' ? '' : createName}
                isDir={creatingIn.type === 'folder'} size={14}
                className="flex-shrink-0 text-text-tertiary" />
              <input
                autoFocus
                value={createName}
                onChange={(e) => onCreateNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter' && createName.trim()) onCreateSubmit();
                  if (e.key === 'Escape') onCreateCancel();
                }}
                onBlur={onCreateCancel}
                placeholder={creatingIn.type === 'folder' ? 'folder name' : 'file name'}
                className="flex-1 min-w-0 text-xs bg-bg-input border border-border-focus
                  rounded-lg px-1.5 py-0.5 outline-none text-text-primary"
              />
            </div>
          )}
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              creatingIn={creatingIn}
              createName={createName}
              onCreateNameChange={onCreateNameChange}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Component ---
export function FileExplorer() {
  const t = useT();
  const tree = useFileStore((s) => s.tree);
  const isLoading = useFileStore((s) => s.isLoading);
  const rootPath = useFileStore((s) => s.rootPath);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);

  const refreshTree = useFileStore((s) => s.refreshTree);
  const createFile = useFileStore((s) => s.createFile);
  const createFolder = useFileStore((s) => s.createFolder);
  const isDragOverTree = useFileStore((s) => s.isDragOverTree);
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Right-click menu state
  const [clipboardPath, setClipboardPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; isDir: boolean } | null>(null);

  // New file/folder inline creation state
  const [creatingIn, setCreatingIn] = useState<{ dir: string; type: 'file' | 'folder' } | null>(null);
  const [createName, setCreateName] = useState('');

  const filteredTree = useMemo(() => {
    function filterNodes(nodes: FileNode[]): FileNode[] {
      return nodes
        .filter((n) => !n.name.startsWith('.'))
        .map((n) => n.children ? { ...n, children: filterNodes(n.children) } : n);
    }
    const visible = showHiddenFiles ? tree : filterNodes(tree);
    // Technical files of the project go after the user's own documents
    const isProjectFile = (n: FileNode) => !n.is_dir && projectFileKey(n.path, rootPath) !== null;
    return [...visible.filter((n) => !isProjectFile(n)), ...visible.filter(isProjectFile)];
  }, [tree, showHiddenFiles, rootPath]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // --- Right-click menu callbacks ---
  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);

  const handleCopyFile = useCallback((path: string) => {
    setClipboardPath(path);
  }, []);

  const handlePaste = useCallback(async (targetDir: string) => {
    if (!clipboardPath) return;
    const fileName = clipboardPath.split(/[\\/]/).pop() || 'file';
    const dest = `${targetDir}/${fileName}`;
    try {
      await bridge.copyFile(clipboardPath, dest);
      setClipboardPath(null);
      refreshTree();
    } catch {
      // Silently fail
    }
  }, [clipboardPath, refreshTree]);

  const handleStartRename = useCallback((path: string) => {
    const name = path.split(/[\\/]/).pop() || '';
    setRenamingPath(path);
    setRenameValue(name);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const dir = renamingPath.substring(0, Math.max(renamingPath.lastIndexOf('/'), renamingPath.lastIndexOf('\\')));
    const dest = `${dir}/${renameValue.trim()}`;
    if (dest === renamingPath) {
      setRenamingPath(null);
      return;
    }
    try {
      await bridge.renameFile(renamingPath, dest);
      setRenamingPath(null);
      refreshTree();
    } catch {
      setRenamingPath(null);
    }
  }, [renamingPath, renameValue, refreshTree]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleRequestDelete = useCallback((path: string, isDir: boolean) => {
    setDeleteTarget({ path, isDir });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await bridge.deleteFile(deleteTarget.path);
      setDeleteTarget(null);
      refreshTree();
    } catch {
      setDeleteTarget(null);
    }
  }, [deleteTarget, refreshTree]);

  const handleInsertToChat = useCallback((path: string) => {
    const tabId = useSessionStore.getState().selectedSessionId;
    if (!tabId) return;
    const tab = useChatStore.getState().getTab(tabId);
    const currentDraft = tab?.inputDraft ?? '';
    const prefix = currentDraft && !currentDraft.endsWith('\n') && !currentDraft.endsWith(' ') ? ' ' : '';
    useChatStore.getState().setInputDraft(tabId, currentDraft + prefix + path);
  }, []);

  const handleNewFile = useCallback((dir: string) => {
    setCreatingIn({ dir, type: 'file' });
    setCreateName('');
  }, []);

  const handleNewFolder = useCallback((dir: string) => {
    setCreatingIn({ dir, type: 'folder' });
    setCreateName('');
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    if (!creatingIn || !createName.trim()) {
      setCreatingIn(null);
      return;
    }
    if (creatingIn.type === 'file') {
      await createFile(creatingIn.dir, createName.trim());
    } else {
      await createFolder(creatingIn.dir, createName.trim());
    }
    setCreatingIn(null);
    setCreateName('');
  }, [creatingIn, createName, createFile, createFolder]);

  const handleCreateCancel = useCallback(() => {
    setCreatingIn(null);
    setCreateName('');
  }, []);

  const contextMenuCallbacks: ContextMenuCallbacks = useMemo(() => ({
    onCopyPath: handleCopyPath,
    onCopyFile: handleCopyFile,
    onPaste: handlePaste,
    onRename: handleStartRename,
    onDelete: handleRequestDelete,
    onInsertToChat: handleInsertToChat,
    onNewFile: handleNewFile,
    onNewFolder: handleNewFolder,
    clipboardPath,
  }), [handleCopyPath, handleCopyFile, handlePaste, handleStartRename, handleRequestDelete, handleInsertToChat, handleNewFile, handleNewFolder, clipboardPath]);

  // No project selected
  if (!workingDirectory) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-border-subtle">
          <span className="text-xs font-medium text-text-tertiary
            uppercase tracking-wider">{t('files.title')}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center
          px-4 text-center">
          <Folder size={32} weight="light" className="text-text-tertiary/40 mb-3" />
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t('files.selectProject')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* File tree */}
      <div className="flex-1 min-h-0 relative" data-file-tree>
        {isDragOverTree && (
          <div className="absolute inset-0 z-10 border-2 border-dashed border-accent
            bg-accent/5 rounded-lg flex items-center justify-center pointer-events-none">
            <span className="text-xs text-accent font-medium">
              {t('files.dropHere')}
            </span>
          </div>
        )}
        <div className="h-full overflow-y-auto p-1.5">
        {isLoading && filteredTree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : filteredTree.length > 0 ? (
          (
            <>
              {/* Inline creation input at root level */}
              {creatingIn && creatingIn.dir === (workingDirectory || rootPath) && (
                <div className="flex items-center gap-2.5 py-2 px-2.5"
                  style={{ paddingLeft: '10px' }}>
                  <FileIcon name={creatingIn.type === 'folder' ? '__dir__' : 'untitled'}
                    isDir={creatingIn.type === 'folder'} size={14}
                    className="flex-shrink-0 text-text-tertiary" />
                  <input
                    autoFocus
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') handleCreateSubmit();
                      if (e.key === 'Escape') handleCreateCancel();
                    }}
                    onBlur={handleCreateCancel}
                    placeholder={creatingIn.type === 'file' ? t('files.newFile') : t('files.newFolder')}
                    className="flex-1 min-w-0 text-xs bg-bg-input border border-border-focus
                      rounded-lg px-1.5 py-0.5 outline-none text-text-primary
                      placeholder:text-text-tertiary"
                  />
                </div>
              )}
              {filteredTree.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  onContextMenu={handleContextMenu}
                  renamingPath={renamingPath}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={handleRenameCancel}
                  creatingIn={creatingIn}
                  createName={createName}
                  onCreateNameChange={setCreateName}
                  onCreateSubmit={handleCreateSubmit}
                  onCreateCancel={handleCreateCancel}
                />
              ))}
            </>
          )
        ) : (
          <div className="px-3 pt-4 opacity-20 select-none pointer-events-none">
            <div className="flex flex-col gap-1.5 text-xs text-text-tertiary">
              <div className="flex items-center gap-2 pl-2">
                <span className="w-3 h-3 rounded border border-current opacity-50" />
                <span>dokumentace/</span>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <span className="w-2 h-2 rounded-sm border border-current opacity-40" />
                <span>průvodní-zpráva.md</span>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <span className="w-2 h-2 rounded-sm border border-current opacity-40" />
                <span>technická-zpráva.md</span>
              </div>
              <div className="flex items-center gap-2 pl-2">
                <span className="w-3 h-3 rounded border border-current opacity-50" />
                <span>podklady/</span>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <span className="w-2 h-2 rounded-sm border border-current opacity-40" />
                <span>geologický-posudek.pdf</span>
              </div>
              <div className="flex items-center gap-2 pl-2">
                <span className="w-2 h-2 rounded-sm border border-current opacity-40" />
                <span>stavebak.json</span>
              </div>
            </div>
          </div>
        )}
        </div>{/* end scroll container */}
      </div>{/* end data-file-tree wrapper */}


      {/* Context menu */}
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={closeContextMenu} callbacks={contextMenuCallbacks} />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('files.delete')}
        message={
          deleteTarget
            ? (deleteTarget.isDir ? t('files.deleteConfirmDir') : t('files.deleteConfirm'))
                .replace('{name}', deleteTarget.path.split(/[\\/]/).pop() ?? '')
            : ''
        }
        detail={deleteTarget?.path}
        variant="danger"
        confirmLabel={t('files.delete')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

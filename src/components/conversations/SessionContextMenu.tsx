import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SessionListItem } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { PencilSimple, PushPin, FolderPlus, Minus, Folder, DownloadSimple, Trash, Plus, SquaresFour } from '@phosphor-icons/react';

/** A group option offered in the "add to group" section. */
export interface GroupOption {
  id: string;
  label: string;
}

interface SessionContextMenuProps {
  x: number;
  y: number;
  session: SessionListItem;
  onRename: (session: SessionListItem) => void;
  onRevealInFinder: (session: SessionListItem) => void;
  onExport: (session: SessionListItem) => void;
  onDelete: (session: SessionListItem) => void;
  onPin?: (session: SessionListItem) => void;
  isPinned?: boolean;
  // --- Session grouping ---
  /** Create a new group in this session's workspace and drop it in. */
  onCreateGroupWithSession?: (session: SessionListItem) => void;
  /** Groups in this session's workspace it can be moved into (excludes current). */
  availableGroups?: GroupOption[];
  onAddToGroup?: (session: SessionListItem, groupId: string) => void;
  /** Non-null when the session is currently in a group → enables "remove". */
  currentGroupId?: string | null;
  onRemoveFromGroup?: (session: SessionListItem) => void;
  onClose: () => void;
}

const itemCls =
  'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-primary ' +
  'hover:bg-bg-secondary transition-smooth';

export function SessionContextMenu({
  x,
  y,
  session,
  onRename,
  onRevealInFinder,
  onExport,
  onDelete,
  onPin,
  isPinned,
  onCreateGroupWithSession,
  availableGroups,
  onAddToGroup,
  currentGroupId,
  onRemoveFromGroup,
  onClose,
}: SessionContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const showGrouping =
    !!onCreateGroupWithSession || !!onRemoveFromGroup || (availableGroups?.length ?? 0) > 0;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] py-1.5 rounded-xl
        bg-bg-card border border-border-subtle shadow-xl animate-fade-in
        max-h-[70vh] overflow-y-auto"
      style={{ left: x, top: y }}
    >
      <button onClick={() => { onClose(); onRename(session); }} className={itemCls}>
        <PencilSimple size={12} weight="light" />
        {t('conv.rename')}
      </button>

      {onPin && (
        <button onClick={() => { onClose(); onPin(session); }} className={itemCls}>
          <PushPin size={12} weight="light" />
          {isPinned ? t('conv.unpin') : t('conv.pin')}
        </button>
      )}

      {/* --- Session grouping --- */}
      {showGrouping && <div className="my-1 border-t border-border-subtle" />}

      {onCreateGroupWithSession && (
        <button onClick={() => { onClose(); onCreateGroupWithSession(session); }} className={itemCls}>
          <FolderPlus size={12} weight="light" />
          Create task group
        </button>
      )}

      {availableGroups && availableGroups.length > 0 && onAddToGroup && (
        <>
          <div className="px-3 pt-1.5 pb-0.5 text-xs text-text-tertiary select-none">
            Add to task group
          </div>
          {availableGroups.map((g) => (
            <button
              key={g.id}
              onClick={() => { onClose(); onAddToGroup(session, g.id); }}
              className={itemCls}
            >
              <Folder size={12} weight="light" className="text-accent/70" />
              <span className="truncate">{g.label}</span>
            </button>
          ))}
        </>
      )}

      {currentGroupId && onRemoveFromGroup && (
        <button onClick={() => { onClose(); onRemoveFromGroup(session); }} className={itemCls}>
          <Minus size={12} weight="light" />
          Remove from group
        </button>
      )}

      {(session.path || true) && <div className="my-1 border-t border-border-subtle" />}

      {session.path && (
        <button onClick={() => { onClose(); onRevealInFinder(session); }} className={itemCls}>
          <Folder size={12} weight="light" />
          {t('conv.revealInFinder')}
        </button>
      )}

      {session.path && (
        <button onClick={() => { onClose(); onExport(session); }} className={itemCls}>
          <DownloadSimple size={12} weight="light" />
          {t('conv.export')}
        </button>
      )}

      <div className="my-1 border-t border-border-subtle" />

      <button
        onClick={() => { onClose(); onDelete(session); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
      >
        <Trash size={12} weight="light" />
        {t('conv.delete')}
      </button>
    </div>,
    document.body,
  );
}

/** Project-level (workspace) context menu */
interface ProjectContextMenuProps {
  x: number;
  y: number;
  project: string;
  onNewSession: (project: string) => void;
  onCreateGroup?: (project: string) => void;
  onDeleteAll: (project: string) => void;
  onSelectMode?: (project: string) => void;
  onClose: () => void;
}

export function ProjectContextMenu({
  x,
  y,
  project,
  onNewSession,
  onCreateGroup,
  onDeleteAll,
  onSelectMode,
  onClose,
}: ProjectContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[170px] py-1.5 rounded-xl
        bg-bg-card border border-border-subtle shadow-xl animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button onClick={() => { onClose(); onNewSession(project); }} className={itemCls}>
        <Plus size={12} weight="light" />
        {t('conv.newChat')}
      </button>

      {onCreateGroup && (
        <button onClick={() => { onClose(); onCreateGroup(project); }} className={itemCls}>
          <FolderPlus size={12} weight="light" />
          Create task group
        </button>
      )}

      {onSelectMode && (
        <button onClick={() => { onClose(); onSelectMode(project); }} className={itemCls}>
          <SquaresFour size={12} weight="light" />
          {t('conv.selectMode')}
        </button>
      )}

      <div className="my-1 border-t border-border-subtle" />

      <button
        onClick={() => { onClose(); onDeleteAll(project); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
      >
        <Trash size={12} weight="light" />
        {t('conv.deleteAll')}
      </button>
    </div>,
    document.body,
  );
}

/** Group-level context menu (rename / delete a task group) */
interface GroupContextMenuProps {
  x: number;
  y: number;
  groupId: string;
  onRename: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  onClose: () => void;
}

export function GroupContextMenu({
  x,
  y,
  groupId,
  onRename,
  onDelete,
  onClose,
}: GroupContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[150px] py-1.5 rounded-xl
        bg-bg-card border border-border-subtle shadow-xl animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button onClick={() => { onClose(); onRename(groupId); }} className={itemCls}>
        <PencilSimple size={12} weight="light" />
        Rename task group
      </button>

      <div className="my-1 border-t border-border-subtle" />

      <button
        onClick={() => { onClose(); onDelete(groupId); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
      >
        <Trash size={12} weight="light" />
        Delete task group
      </button>
    </div>,
    document.body,
  );
}

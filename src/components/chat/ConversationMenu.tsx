import { useEffect, useRef, useState } from 'react';
import { CaretDown, Plus, Check } from '@phosphor-icons/react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { projectConversations, openConversation, startConversation } from '../../lib/conversations';

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `dnes ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `včera ${time}`;
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Chat header: current conversation title with the project's history, and "Nové téma". */
export function ConversationMenu() {
  const dir = useSettingsStore((s) => s.workingDirectory);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedSessionId);
  const getDisplayName = useSessionStore((s) => s.getDisplayName);
  const hasMessages = useChatStore((s) => (selectedId ? (s.tabs.get(selectedId)?.messages.length ?? 0) > 0 : false));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    useSessionStore.getState().fetchSessions();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!dir) return null;

  const history = projectConversations(sessions, dir);
  const current = sessions.find((s) => s.id === selectedId);
  const title = (current && getDisplayName(current)) || (hasMessages ? 'Konverzace' : 'Nové téma');

  return (
    <div className="flex items-center gap-1 min-w-0 flex-1">
      <div ref={ref} className="relative min-w-0">
        <button
          onClick={() => setOpen(!open)}
          disabled={history.length === 0}
          className="flex items-center gap-1 min-w-0 max-w-[420px] px-1.5 py-0.5 -ml-1.5 rounded-md
            hover:bg-bg-tertiary disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
          title="Historie konverzací v tomto projektu"
        >
          <span className="text-xs text-text-primary font-medium truncate">{title}</span>
          {history.length > 0 && <CaretDown size={10} weight="bold" className="text-text-tertiary flex-shrink-0" />}
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-[360px] max-h-[60vh] overflow-y-auto
            rounded-lg border border-border bg-bg-card shadow-lg p-1.5">
            <div className="text-xs text-text-tertiary font-medium px-2.5 py-1">Dřívější konverzace</div>
            {history.map((s) => (
              <button
                key={s.id}
                onClick={() => { setOpen(false); openConversation(s); }}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left cursor-pointer
                  ${s.id === selectedId ? 'bg-bg-secondary' : 'hover:bg-bg-secondary'}`}
              >
                <span className="flex-1 min-w-0 text-xs text-text-primary truncate">{getDisplayName(s) || 'Bez názvu'}</span>
                <span className="text-xs text-text-tertiary flex-shrink-0 tabular-nums">{when(s.modifiedAt)}</span>
                <span className="w-3 flex-shrink-0">
                  {s.id === selectedId && <Check size={11} className="text-text-muted" />}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {hasMessages && (
        <button
          onClick={() => startConversation(dir)}
          className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-md text-xs text-text-muted
            hover:bg-bg-tertiary hover:text-text-primary cursor-pointer flex-shrink-0"
          title="Začít novou konverzaci v tomto projektu"
        >
          <Plus size={11} /> Nové téma
        </button>
      )}
    </div>
  );
}

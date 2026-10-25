import { type ReactNode, useState, useRef, useEffect } from 'react';
import { CodeBlock, Question, ListDashes, Star, CaretDown, Check } from '@phosphor-icons/react';
import { useSettingsStore, type SessionMode } from '../../stores/settingsStore';
import { useChatStore, generateMessageId } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useT } from '../../lib/i18n';

const MODES: { id: SessionMode; labelKey: string; icon: ReactNode }[] = [
  {
    id: 'code',
    labelKey: 'mode.code',
    icon: <CodeBlock size={12} weight="light" />,
  },
  {
    id: 'ask',
    labelKey: 'mode.ask',
    icon: <Question size={12} weight="light" />,
  },
  {
    id: 'plan',
    labelKey: 'mode.plan',
    icon: <ListDashes size={12} weight="light" />,
  },
  {
    id: 'bypass',
    labelKey: 'mode.bypass',
    icon: <Star size={12} weight="light" />,
  },
];

export function ModeSelector({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const setSessionMode = useSettingsStore((s) => s.setSessionMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = MODES.find((m) => m.id === sessionMode) || MODES[0];
  const isBypass = sessionMode === 'bypass';

  const MODE_FEEDBACK: Record<SessionMode, { i18nKey: string; icon: string }> = {
    code: { i18nKey: 'cmd.switchedToCode', icon: '⚡' },
    ask: { i18nKey: 'cmd.switchedToAsk', icon: '💬' },
    plan: { i18nKey: 'cmd.switchedToPlan', icon: '📋' },
    bypass: { i18nKey: 'cmd.switchedToBypass', icon: '⭐' },
  };

  const switchMode = (mode: SessionMode) => {
    if (mode === sessionMode) return;
    setSessionMode(mode);
    const fb = MODE_FEEDBACK[mode];
    const modeTabId = useSessionStore.getState().selectedSessionId;
    if (modeTabId) {
      useChatStore.getState().addMessage(modeTabId, {
        id: generateMessageId(),
        role: 'system',
        type: 'text',
        content: t(fb.i18nKey),
        commandType: 'mode',
        commandData: { mode, icon: fb.icon },
        timestamp: Date.now(),
      });
    }
  };

  return (
    <div ref={ref} className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Trigger button — shows current mode */}
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
          border transition-smooth cursor-pointer
          ${isBypass
            ? 'border-warning/30 bg-warning/10 text-warning'
            : 'border-border-subtle bg-bg-secondary/50 text-text-muted hover:text-text-primary hover:bg-bg-secondary'
          }`}
      >
        {current.icon}
        <span className="font-medium">{t(current.labelKey)}</span>
        <CaretDown size={8} weight="light"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown menu — opens upward */}
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px]
          bg-bg-card border border-border-subtle rounded-lg shadow-lg
          py-1 z-50 animate-fade-in">
          {MODES.map((mode) => {
            const isActive = mode.id === sessionMode;
            return (
              <button
                key={mode.id}
                onClick={() => { switchMode(mode.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs
                  transition-smooth cursor-pointer
                  ${isActive
                    ? mode.id === 'bypass'
                      ? 'bg-warning/10 text-warning font-medium'
                      : 'bg-accent/10 text-accent font-medium'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
                  }`}
              >
                {mode.icon}
                {t(mode.labelKey)}
                {isActive && (
                  <Check size={10} weight="light" className="ml-auto" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

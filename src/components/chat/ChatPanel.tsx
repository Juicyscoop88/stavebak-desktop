import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ListDashes, X, List, CaretRight, Info, Warning, Clock, ArrowDown, Folder, Plus } from '@phosphor-icons/react';
import { create } from 'zustand';
import { useChatStore, useActiveTab, type ChatMessage } from '../../stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { UpdateButton } from '../shared/UpdateButton';
import { useSettingsStore, mapSessionModeToPermissionMode } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useFileStore } from '../../stores/fileStore';
// bridge import removed — spawn goes through sessionLifecycle module
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '../../lib/i18n';
import { envFingerprint, is1MModel as isOneMillionModel, resolveModelForProvider, spawnConfigHash } from '../../lib/api-provider';
import { useProviderStore } from '../../stores/providerStore';
import { spawnSession } from '../../lib/sessionLifecycle';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { useSetupStore } from '../../stores/setupStore';
import { AiAvatar } from '../shared/AiAvatar';
import { useFindInPage } from '../../hooks/useFindInPage';
import { FindBar } from './FindBar';
import { formatElapsedCompact } from '../../lib/elapsed-time';
import { formatRetryDelaySeconds, isRateLimitRetry, type ApiRetryStatus } from '../../lib/api-retry';
import { useProjectStore } from '../../stores/projectStore';

/** Shared plan panel toggle — used by ChatPanel (panel) and InputBar (button) */
export const usePlanPanelStore = create<{
  open: boolean;
  toggle: () => void;
  close: () => void;
}>()((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

/** Resizable right-side plan panel */
function PlanPanel({ planMessages, onClose }: {
  planMessages: ChatMessage[];
  onClose: () => void;
}) {
  const t = useT();
  const [width, setWidth] = useState(420);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging left edge → moving left = wider
      const delta = startX.current - ev.clientX;
      const newWidth = Math.max(280, Math.min(800, startW.current + delta));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div
      className="absolute right-3 top-3 bottom-3 z-20
        bg-bg-card/80 backdrop-blur-xl border border-white/10 rounded-2xl
        shadow-2xl shadow-black/20
        flex flex-col overflow-hidden"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize
          hover:bg-accent/20 active:bg-accent/30 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5
        border-b border-border-subtle bg-accent/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ListDashes size={14} weight="light" className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('msg.planTitle')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-bg-tertiary text-text-tertiary
            transition-smooth cursor-pointer"
        >
          <X size={12} weight="light" />
        </button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {planMessages.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">
            {t('msg.noPlan')}
          </p>
        ) : (
          planMessages.map((planMsg) => (
            <div key={planMsg.id} className="text-sm leading-relaxed">
              <MarkdownRenderer content={planMsg.planContent || planMsg.content || ''} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}


/** Format token count: "3.2k" for >=1000, raw number for <1000 */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Cycling typewriter text for thinking phase — like Claude Code website "Built for > coders" */
const THINKING_WORD_COUNT = 17;
const TYPING_SPEED = 80;      // ms per character (typing)
const DELETING_SPEED = 40;    // ms per character (deleting)
const PAUSE_DURATION = 2500;  // ms to hold full word
const TRANSITION_DELAY = 300; // ms between delete and next word

/** Fisher-Yates shuffle, always starts with index 0 ("Thinking") */
function shuffledOrder(count: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.random() * i); // skip index 0
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function CyclingThinkingText() {
  const t = useT();
  const [order, setOrder] = useState(() => shuffledOrder(THINKING_WORD_COUNT));
  const [cursor, setCursor] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [phase, setPhase] = useState<'typing' | 'pausing' | 'deleting' | 'waiting'>('typing');

  const wordIndex = order[cursor];
  const fullWord = t(`chat.thinkingCycle.${wordIndex}`);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (phase === 'typing') {
      if (displayText.length < fullWord.length) {
        timer = setTimeout(() => {
          setDisplayText(fullWord.slice(0, displayText.length + 1));
        }, TYPING_SPEED);
      } else {
        timer = setTimeout(() => setPhase('pausing'), 0);
      }
    } else if (phase === 'pausing') {
      timer = setTimeout(() => setPhase('deleting'), PAUSE_DURATION);
    } else if (phase === 'deleting') {
      if (displayText.length > 0) {
        timer = setTimeout(() => {
          setDisplayText(displayText.slice(0, -1));
        }, DELETING_SPEED);
      } else {
        const nextCursor = cursor + 1;
        if (nextCursor >= THINKING_WORD_COUNT) {
          // Reshuffle when all words shown
          setOrder(shuffledOrder(THINKING_WORD_COUNT));
          setCursor(0);
        } else {
          setCursor(nextCursor);
        }
        setPhase('waiting');
      }
    } else if (phase === 'waiting') {
      timer = setTimeout(() => {
        setDisplayText('');
        setPhase('typing');
      }, TRANSITION_DELAY);
    }

    return () => clearTimeout(timer);
  }, [displayText, phase, fullWord, cursor]);

  return (
    <span className="inline-flex items-baseline">
      <span>{displayText}</span>
      <span className="text-text-tertiary">...</span>
    </span>
  );
}

function formatApiRetryText(retry: ApiRetryStatus, t: (key: string) => string): string {
  const attempt = retry.attempt
    ? retry.maxRetries
      ? t('chat.apiRetryAttempt')
        .replace('{attempt}', String(retry.attempt))
        .replace('{max}', String(retry.maxRetries))
      : t('chat.apiRetryAttemptOnly').replace('{attempt}', String(retry.attempt))
    : '';
  const base = isRateLimitRetry(retry)
    ? t('chat.apiRetryRateLimit')
    : t('chat.apiRetryGeneric');
  const delay = formatRetryDelaySeconds(retry.retryDelayMs);
  const delayText = delay ? ` ${t('chat.apiRetryDelay').replace('{delay}', delay)}` : '';
  return `${base.replace('{attempt}', attempt ? ` ${attempt}` : '')}${delayText}`;
}

/** Activity indicator with elapsed time and token count */
function ActivityIndicator({ activityStatus, sessionMeta, sessionStatus }: {
  activityStatus: { phase: string; toolName?: string };
  sessionMeta: { turnStartTime?: number; outputTokens?: number; inputTokens?: number; lastProgressAt?: number; apiRetry?: ApiRetryStatus };
  sessionStatus?: string;
}) {
  const t = useT();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isStopping = sessionStatus === 'stopping';
  const retryStatus = !isStopping ? sessionMeta.apiRetry : undefined;
  const isStarting = sessionStatus === 'running'
    && activityStatus.phase === 'idle';
  const retryText = retryStatus ? formatApiRetryText(retryStatus, t) : null;
  const phaseText = isStopping ? t('chat.stopping')
    : retryText ? retryText
    : isStarting ? t('chat.startingAgent')
    : activityStatus.phase === 'thinking' ? t('chat.thinking')
    : activityStatus.phase === 'writing' ? t('chat.writing')
    : activityStatus.phase === 'tool' ? `${t('chat.runningTool')}: ${activityStatus.toolName || ''}`
    : activityStatus.phase === 'awaiting' ? t('chat.awaiting')
    : activityStatus.phase === 'reconnecting' ? t('chat.reconnecting')
    : t('chat.running');

  const elapsed = sessionMeta.turnStartTime ? formatElapsedCompact(now - sessionMeta.turnStartTime) : null;
  const tokens = sessionMeta.outputTokens ? formatTokens(sessionMeta.outputTokens) : null;
  const statsText = elapsed
    ? tokens ? `(${elapsed} · ↓ ${tokens})` : `(${elapsed})`
    : null;

  // Context pressure warning: threshold depends on model context window size
  // 1M models → warn at 600K; others at 120K (60% of 200K).
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const resolvedModel = resolveModelForProvider(selectedModel);
  const is1MContextModel = isOneMillionModel(resolvedModel);
  const contextWindow = is1MContextModel ? 1_000_000 : 200_000;
  const inputTokens = sessionMeta.inputTokens || 0;
  const contextWarning = !isStopping && inputTokens > contextWindow * 0.6;

  // Stall detection: 120s of silence (no stream activity), not total elapsed time.
  const stallWarning = !isStopping
    && !!sessionMeta.lastProgressAt
    && !!elapsed
    && (now - sessionMeta.lastProgressAt) > 120_000;

  const isRetrying = Boolean(retryStatus);
  const isThinking = !isRetrying && !isStopping && !isStarting && activityStatus.phase === 'thinking';

  return (
    <div className={`flex items-center gap-1.5 py-1 ${isStopping ? 'px-2.5 rounded-full border border-warning/20 bg-warning/5 w-fit' : ''}`}>
      {isStopping ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-warning/25 border-t-warning animate-spin flex-shrink-0" />
      ) : (
        <span className={`text-sm font-medium leading-none text-accent
          ${isThinking ? '' : 'animate-pulse-soft'}`}>/</span>
      )}
      <span className="text-sm text-text-muted">
        {isThinking ? <CyclingThinkingText /> : phaseText}
        {statsText && (
          <span className={`ml-1.5 ${stallWarning ? 'text-red-400' : 'text-text-tertiary'}`}>{statsText}</span>
        )}
      </span>
      {stallWarning && (
        <span className="text-xs text-red-400 ml-2 flex items-center gap-1">
          <Info size={14} weight="light" className="flex-shrink-0" />
          {t('chat.stallWarning')}
        </span>
      )}
      {contextWarning && !stallWarning && (
        <span className="text-xs text-amber-500 ml-2 flex items-center gap-1"
              title={t('chat.tokenWarning')}>
          <Warning size={14} weight="light" className="flex-shrink-0" />
          {t('chat.tokenWarning')}
        </span>
      )}
    </div>
  );
}

export function ChatPanel() {
  const t = useT();
  const messages = useActiveTab((t) => t.messages);
  const isStreaming = useActiveTab((t) => t.isStreaming);
  const partialText = useActiveTab((t) => t.partialText);
  const partialThinking = useActiveTab((t) => t.partialThinking);
  const sessionStatus = useActiveTab((t) => t.sessionStatus);
  const sessionMeta = useActiveTab((t) => t.sessionMeta);
  const activityStatus = useActiveTab((t) => t.activityStatus);
  const pendingUserMessages = useActiveTab((t) => t.pendingUserMessages);
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const directoryMissing = useFileStore((s) => s.directoryMissing);
  const isFilePreviewMode = !!useFileStore((s) => s.selectedFile);
  const projectPhase = useProjectStore((s) => s.phase);
  const completedSections = useProjectStore((s) => s.completedSections);
  const totalSections = useProjectStore((s) => s.totalSections);
  const currentSection = useProjectStore((s) => s.currentSection);
  const buildingType = useProjectStore((s) => s.buildingType);


  const showPlanPanel = usePlanPanelStore((s) => s.open);
  const closePlanPanel = usePlanPanelStore((s) => s.close);


  // Listen for internal file tree drag-drop (mouse-based, not HTML5 drag-and-drop)
  // HTML5 drag events don't work in Tauri because dragDropEnabled: true intercepts them.
  // Listen for file-chip click → open file in secondary panel's file browser
  useEffect(() => {
    const onOpenFile = (e: Event) => {
      const filePath = (e as CustomEvent<string>).detail;
      if (!filePath) return;
      // Open secondary panel to files tab and select the file
      useSettingsStore.getState().setSecondaryTab('files');
      useFileStore.getState().selectFile(filePath);
    };
    window.addEventListener('stavebak:open-file', onOpenFile);
    return () => window.removeEventListener('stavebak:open-file', onOpenFile);
  }, []);

  // --- Tool grouping: group 3+ consecutive tool_use messages ---
  type DisplayItem =
    | { kind: 'message'; msg: ChatMessage; idx: number }
    | { kind: 'tool_group'; msgs: ChatMessage[]; startIdx: number };

  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    let i = 0;
    while (i < messages.length) {
      // Detect runs of consecutive tool_use messages
      if (messages[i].type === 'tool_use') {
        let j = i;
        while (j < messages.length && messages[j].type === 'tool_use') j++;
        const runLength = j - i;
        if (runLength >= 3) {
          items.push({ kind: 'tool_group', msgs: messages.slice(i, j), startIdx: i });
          i = j;
          continue;
        }
      }
      items.push({ kind: 'message', msg: messages[i], idx: i });
      i++;
    }
    return items;
  }, [messages]);

  // Collect plan review messages from the session (created by ExitPlanMode)
  const planMessages = useMemo(
    () => messages.filter((m) => m.type === 'plan_review' || m.type === 'plan' || m.planContent),
    [messages],
  );

  // Find the path of the currently selected session for export
  const scrollRef = useRef<HTMLDivElement>(null);
  const find = useFindInPage(scrollRef);
  const thinkingPreRef = useRef<HTMLPreElement>(null);
  const isNearBottomRef = useRef(true);
  // When user scrolls up via wheel, suppress auto-scroll until they return to bottom
  const userScrollingUpRef = useRef(false);
  // Show "scroll to bottom" button when user is far from bottom
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Track whether user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Consider "near bottom" if within 80px of the end
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    // Show scroll-to-bottom button when far from bottom (>300px)
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
    // Reset the scroll-up lock once user returns to bottom
    if (nearBottom) {
      userScrollingUpRef.current = false;
    }
  }, []);

  // Detect intentional upward scroll via wheel event
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // User is scrolling up — suppress auto-scroll
        userScrollingUpRef.current = true;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Auto-scroll to bottom only when already near bottom and user isn't scrolling up
  useEffect(() => {
    if (isNearBottomRef.current && !userScrollingUpRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, partialText, partialThinking, activityStatus]);

  // Auto-scroll the internal thinking <pre> to bottom as new content streams in
  useEffect(() => {
    const el = thinkingPreRef.current;
    if (el && partialThinking) {
      el.scrollTop = el.scrollHeight;
    }
  }, [partialThinking]);

  return (
    <div className="flex flex-col h-full">
      {/* Title bar spacer — 28px for macOS traffic lights */}
      <div className="h-[28px] flex-shrink-0" />

      {/* Header row — project name + status */}
      <div
        className="flex items-center h-[36px] pl-3.5 pr-5 border-b border-border-subtle
        flex-shrink-0 bg-bg-chat cursor-default">
        {(!sidebarOpen || isFilePreviewMode) && (
          <button onClick={toggleSidebar}
            className="p-1 rounded-lg hover:bg-bg-tertiary text-text-tertiary
              transition-smooth mr-2" title={t('chat.showSidebar')}>
            <List size={14} weight="light" />
          </button>
        )}
        {workingDirectory && sessionStatus !== 'idle' && (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-smooth
            ${sessionStatus === 'running'
              ? 'bg-success shadow-[0_0_6px_var(--color-accent-glow)] animate-pulse-soft'
              : sessionStatus === 'error'
                ? 'bg-error'
                : 'bg-transparent'}`} />
        )}
        <div className="ml-auto flex items-center">
          <UpdateButton />
        </div>
      </div>

      {/* Second row — DSP workflow breadcrumb (only when classification is done) */}
      {workingDirectory && buildingType && (
        <div className="flex items-center h-[36px] pl-3.5 pr-5 border-b border-border-subtle
          flex-shrink-0 bg-bg-chat cursor-default">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <span className="font-medium">{projectPhase}</span>
            <span className="text-border-subtle">·</span>
            {currentSection ? (
              <span>{currentSection}</span>
            ) : (
              <span className="text-text-quaternary">{completedSections}/{totalSections} sekcí</span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
      {find.isOpen && <FindBar {...find} />}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="chat-messages"
        className="flex-1 overflow-y-auto px-5 py-6 selectable"
      >
        {!workingDirectory && messages.length === 0 && !isStreaming ? (
          <WelcomeScreen />
        ) : messages.length === 0 && !isStreaming ? (
          <EmptyReadyState />
        ) : (
          <div className="max-w-2xl mx-auto">
            {displayItems.map((item, displayIdx) => {
              // Determine spacing based on item type
              const isCompact = item.kind === 'tool_group'
                || (item.kind === 'message' && ['tool_use', 'tool_result', 'thinking', 'todo', 'plan', 'plan_review'].includes(item.msg.type));
              const prevItem = displayIdx > 0 ? displayItems[displayIdx - 1] : null;
              const prevIsCompact = prevItem && (
                prevItem.kind === 'tool_group'
                || (prevItem.kind === 'message' && ['tool_use', 'tool_result', 'thinking', 'todo', 'plan', 'plan_review'].includes(prevItem.msg.type))
              );
              const spacing = displayIdx === 0
                ? ''
                : isCompact && prevIsCompact
                  ? 'mt-0.5'
                  : isCompact || prevIsCompact
                    ? 'mt-2'
                    : 'mt-5';

              if (item.kind === 'tool_group') {
                return (
                  <div key={`tg_${item.msgs[0].id}`} className={spacing}>
                    <ToolGroup messages={item.msgs} />
                  </div>
                );
              }

              const msg = item.msg;
              const idx = item.idx;
              // Show avatar only for the FIRST assistant text in a turn.
              let isFirstInGroup = true;
              if (msg.role === 'assistant' && msg.type === 'text') {
                for (let j = idx - 1; j >= 0; j--) {
                  const prev = messages[j];
                  if (prev.role === 'user') break;
                  if (prev.role === 'assistant' && prev.type === 'text') {
                    isFirstInGroup = false;
                    break;
                  }
                }
              }
              return (
                <div key={msg.id} className={spacing}>
                  <MessageBubble message={msg} isFirstInGroup={isFirstInGroup} />
                </div>
              );
            })}
            {/* Streaming thinking — auto-collapse as soon as assistant text becomes visible. */}
            {isStreaming && partialThinking && (() => {
              const hasVisiblePartialText = partialText.trim().length > 0;
              return (
              <div className="mt-1">
                <details
                  key={hasVisiblePartialText ? 'collapsed' : 'open'}
                  {...(!hasVisiblePartialText ? { open: true } : {})}
                  className="group"
                >
                  <summary className="flex items-center gap-1.5 py-1
                    cursor-pointer text-xs text-text-tertiary list-none select-none">
                    <CaretRight size={10} weight="light"
                      className="transition-transform duration-150 group-open:rotate-90" />
                    {t('msg.thinking')}
                    <span className="inline-block w-1.5 h-3 bg-text-tertiary ml-0.5
                      animate-pulse-soft rounded-sm" />
                  </summary>
                  <pre ref={thinkingPreRef} className="ml-5 mt-0.5 text-xs text-text-tertiary
                    whitespace-pre-wrap max-h-48 overflow-y-auto
                    font-mono leading-relaxed">
                    {partialThinking}
                  </pre>
                </details>
              </div>
              );
            })()}
            {isStreaming && partialText && (() => {
              // Hide streaming text while an unresolved question is pending —
              // the CLI may keep sending text_delta events for the next turn's
              // content, but the user needs to answer the question first.
              // Check both resolved flag AND interactionState to handle edge
              // cases where setInteractionState hasn't propagated yet.
              const hasPendingQuestion = messages.some(
                (m) => m.type === 'question' && !m.resolved
                  && m.interactionState !== 'resolved' && m.interactionState !== 'sending',
              );
              if (hasPendingQuestion) return null;

              // Check if there's already an assistant text in this turn
              let showStreamAvatar = true;
              for (let j = messages.length - 1; j >= 0; j--) {
                if (messages[j].role === 'user') break;
                if (messages[j].role === 'assistant' && messages[j].type === 'text') {
                  showStreamAvatar = false;
                  break;
                }
              }
              return (
              <div className="flex gap-3 mt-2">
                {showStreamAvatar ? (
                  <div className="w-8 h-8 rounded-[10px] bg-accent
                    flex items-center justify-center flex-shrink-0 text-text-inverse
                    text-xs font-bold shadow-md mt-0.5">C</div>
                ) : (
                  <div className="w-8 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0 text-base text-text-primary leading-relaxed">
                  <MarkdownRenderer content={partialText} />
                </div>
                {/* Right gutter mirrors the avatar so streaming text aligns with the user bubble's right edge */}
                <div className="w-8 flex-shrink-0" />
              </div>
              );
            })()}
            {/* Pending user messages — queued while AI is streaming.
                Rendered AFTER partialText bubble so they visually queue up
                behind the streaming reply. Each one becomes a real user
                message bubble when the current turn completes and the
                FIFO drain in useStreamProcessor sends it. */}
            {pendingUserMessages && pendingUserMessages.length > 0 && pendingUserMessages.map((pending, idx) => (
              <div key={`pending_${idx}`} className="flex justify-end mt-4">
                <div className="flex flex-col items-end max-w-[75%] opacity-60">
                  <div className="bg-bg-elevated border border-border-subtle text-text-primary
                    rounded-full px-5 py-3 leading-normal whitespace-pre-wrap break-words">
                    {pending.text}
                  </div>
                  <span className="text-xs text-text-tertiary mt-1 mr-1 flex items-center gap-1">
                    <Clock size={10} weight="light" />
                    {t('chat.queued')}
                  </span>
                </div>
              </div>
            ))}
            {/* Inline activity status indicator — like Claude Desktop App */}
            {(sessionStatus === 'running' || sessionStatus === 'reconnecting' || sessionStatus === 'stopping' || activityStatus.phase === 'awaiting') && (
              <ActivityIndicator activityStatus={activityStatus} sessionMeta={sessionMeta} sessionStatus={sessionStatus} />
            )}
          </div>
        )}
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollBtn && (
        <button
          onClick={() => {
            const el = scrollRef.current;
            if (el) {
              el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              userScrollingUpRef.current = false;
            }
          }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10
            w-8 h-8 rounded-full bg-bg-card border border-border-subtle
            shadow-md hover:shadow-lg flex items-center justify-center
            text-text-muted hover:text-text-primary transition-smooth
            cursor-pointer opacity-80 hover:opacity-100"
          title={t('chat.scrollToBottom')}
        >
          <ArrowDown size={14} weight="light" />
        </button>
      )}

      {/* Directory missing banner */}
      {workingDirectory && directoryMissing && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-xl bg-status-warning/10 border border-status-warning/30
          flex items-center gap-3 text-sm text-text-secondary">
          <Warning size={16} weight="light" className="flex-shrink-0 text-status-warning" />
          <span className="flex-1">{t('project.directoryMissing')}</span>
          <button
            onClick={async () => {
              const selected = await open({ directory: true, multiple: false, title: t('project.selectFolder') });
              if (selected) useSettingsStore.getState().setWorkingDirectory(selected as string);
            }}
            className="px-3 py-1 rounded-lg text-xs font-medium
              bg-status-warning/20 hover:bg-status-warning/30
              text-status-warning transition-smooth"
          >
            {t('project.reselect')}
          </button>
        </div>
      )}

      {/* InputBar moved to BottomBar in AppShell */}
      </div>{/* end main chat area */}

      {/* Right-side plan panel (resizable) */}
      {showPlanPanel && (
        <PlanPanel
          planMessages={planMessages}
          onClose={closePlanPanel}
        />
      )}
      </div>{/* end flex row */}
    </div>
  );
}

/** Start a new draft conversation for the given folder and pre-warm the CLI process */
async function startDraftSession(folderPath: string) {
  useSettingsStore.getState().setWorkingDirectory(folderPath);
  const currentTab = useSessionStore.getState().selectedSessionId;
  if (currentTab) useChatStore.getState().resetTab(currentTab);

  // Reuse existing draft tab if one is already selected, otherwise create a new one
  const currentTabId = useSessionStore.getState().selectedSessionId;
  const currentSession = useSessionStore.getState().sessions.find(
    (s) => s.id === currentTabId,
  );
  let draftId: string;
  if (currentSession && currentSession.path === '') {
    // Reuse the existing draft — just update its project info
    draftId = currentSession.id;
    useSessionStore.getState().updateDraftProject(draftId, folderPath);
  } else {
    // No draft selected — create a new one
    draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useSessionStore.getState().addDraftSession(draftId, folderPath);
  }

  // Pre-warm: spawn CLI process in background so first message is fast.
  // Send empty prompt — Rust will skip the NDJSON send.
  const preWarmId = `desk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const settings = useSettingsStore.getState();
    const model = resolveModelForProvider(settings.selectedModel);
    const providerId = useProviderStore.getState().activeProviderId || '';
    const permissionMode = mapSessionModeToPermissionMode(settings.sessionMode);

    // Ensure tab exists before writing sessionMeta
    useChatStore.getState().ensureTab(draftId);
    useChatStore.getState().setSessionMeta(draftId, {
      stdinReady: false,
      pendingReadyMessage: undefined,
    });

    // Phase 2 §2.1: capture spawn-time fingerprint and config hash BEFORE
    // the async spawn so they reflect the config actually used, not whatever
    // the user might change while the spawn is in flight.
    const preEnvFingerprint = envFingerprint();
    const preSpawnConfigHash = spawnConfigHash();

    // Use lifecycle module for unified spawn
    const spawnResult = await spawnSession({
      tabId: draftId,
      stdinId: preWarmId,
      cwdSnapshot: folderPath,
      configSnapshot: {
        model,
        providerId,
        thinkingLevel: settings.thinkingLevel,
        permissionMode,
      },
      sessionModeSnapshot: settings.sessionMode,
      sessionParams: {
        prompt: '',  // empty = pre-warm, no message sent
        cwd: folderPath,
        model,
        session_id: preWarmId,
        thinking_level: settings.thinkingLevel,
        provider_id: providerId || undefined,
        permission_mode: permissionMode,
      },
      onStream: (msg: any) => {
        // Forward to InputBar's handler via a global
        const handler = (window as any).__claudeStreamHandler;
        if (handler) {
          const queue: any[] = (window as any).__claudeStreamQueue;
          if (queue && queue.length > 0) {
            const pending = queue.splice(0);
            for (const queued of pending) handler(queued);
          }
          handler(msg);
        } else {
          if (!(window as any).__claudeStreamQueue) (window as any).__claudeStreamQueue = [];
          (window as any).__claudeStreamQueue.push(msg);
        }
      },
      onStderr: (line: string) => {
        console.warn('[Stavebak] pre-warm stderr:', line);
      },
      setRunning: false,
    });

    // Write additional meta (uses pre-captured values to avoid race)
    useChatStore.getState().setSessionMeta(draftId, {
      sessionId: spawnResult.sessionInfo.cli_session_id ?? undefined,
      envFingerprint: preEnvFingerprint,
      spawnedModel: model,
      stdinReady: false,
      pendingReadyMessage: undefined,
      // Phase 2 §2.1: lock in the pre-warm spawn config hash so the first
      // real user submit can detect drift correctly.
      // Uses pre-computed value captured before async spawn to avoid
      // race with user config changes during the spawn window.
      spawnConfigHash: preSpawnConfigHash,
    });
  } catch {
    // Pre-warm failed — InputBar will spawn on first message instead
  }
}

/** Welcome screen shown when no project folder is selected */
function WelcomeScreen() {
  const t = useT();
  const recentProjects = useFileStore((s) => s.recentProjects);
  const fetchProjects = useFileStore((s) => s.fetchRecentProjects);
  const [newProjectMode, setNewProjectMode] = useState(false);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    useSettingsStore.getState().setSetupCompleted(false);
    useSetupStore.getState().reset();
    fetchProjects();
  }, []);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('project.selectFolder'),
    });
    if (selected) {
      startDraftSession(selected as string);
    }
  }, [t]);

  const handleNewProjectStart = useCallback(async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: t('welcome.pickParentDir'),
    });
    if (dir) {
      setParentDir(dir as string);
      setNewProjectMode(true);
      setProjectName('');
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [t]);

  const handleCreateProject = useCallback(async () => {
    if (!parentDir || !projectName.trim()) return;
    const sep = parentDir.endsWith('/') ? '' : '/';
    const fullPath = `${parentDir}${sep}${projectName.trim()}`;
    setCreating(true);
    try {
      await invoke('create_project_directory', { path: fullPath });
      startDraftSession(fullPath);
    } catch (e) {
      console.error('Failed to create project directory:', e);
      setCreating(false);
    }
  }, [parentDir, projectName]);

  const handleCancelNew = useCallback(() => {
    setNewProjectMode(false);
    setParentDir(null);
    setProjectName('');
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <AiAvatar size="w-20 h-20" rounded="rounded-3xl" className="mb-6" />
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        {t('chat.welcome')}
      </h2>
      <p className="text-sm text-text-primary max-w-sm leading-relaxed mb-6">
        {t('welcome.subtitle')}
      </p>

      {newProjectMode ? (
        <div className="animate-scale-in flex flex-col items-center gap-3 w-full max-w-xs">
          <p className="text-xs text-text-muted truncate max-w-full">{parentDir}</p>
          <div className="flex w-full gap-2">
            <input
              ref={nameInputRef}
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') handleCancelNew(); }}
              placeholder={t('welcome.projectNamePlaceholder')}
              className="flex-1 px-3 py-2 rounded-xl text-sm
                bg-white/10 border border-white/[0.08]
                text-text-primary placeholder:text-text-quaternary
                focus:border-accent/50 focus:outline-none
                transition-all duration-200"
              disabled={creating}
            />
            <button
              onClick={handleCreateProject}
              disabled={!projectName.trim() || creating}
              className="px-4 py-2 rounded-xl text-sm font-medium
                bg-accent text-white
                hover:bg-accent-hover active:scale-[0.97]
                disabled:opacity-40 disabled:pointer-events-none
                transition-all duration-200 ease-out"
            >
              {creating ? '...' : t('welcome.create')}
            </button>
          </div>
          <button
            onClick={handleCancelNew}
            className="text-xs text-text-quaternary hover:text-text-muted transition-colors"
          >
            {t('welcome.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4 mb-8 animate-scale-in">
          <button
            onClick={handlePickFolder}
            className="group px-5 py-2.5 rounded-xl text-sm font-medium
              bg-white/10 backdrop-blur-md
              border border-white/[0.08]
              text-text-primary
              hover:bg-white/[0.15] hover:border-white/[0.15]
              active:scale-[0.97]
              transition-all duration-200 ease-out
              flex items-center gap-2"
          >
            <Folder size={15} weight="light" className="opacity-50 group-hover:opacity-80 transition-opacity" />
            {t('welcome.newChat')}
          </button>
          <button
            onClick={handleNewProjectStart}
            className="group px-5 py-2.5 rounded-xl text-sm font-medium
              text-text-muted
              hover:text-text-primary hover:bg-white/[0.06]
              active:scale-[0.97]
              transition-all duration-200 ease-out
              flex items-center gap-2"
          >
            <Plus size={15} weight="light" className="opacity-40 group-hover:opacity-70 transition-opacity" />
            {t('welcome.newProject')}
          </button>
        </div>
      )}

    </div>
  );
}

/** Empty state shown when project is selected but no messages yet */
function EmptyReadyState() {
  const t = useT();
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const setInputDraft = useChatStore((s) => s.setInputDraft);

  const actions = [
    { label: t('quickAction.classify'), message: t('quickAction.classifyMsg') },
    { label: t('quickAction.regulations'), message: t('quickAction.regulationsMsg') },
    { label: t('quickAction.whatNeeded'), message: t('quickAction.whatNeededMsg') },
  ];

  const handleAction = useCallback((message: string) => {
    if (selectedSessionId) {
      setInputDraft(selectedSessionId, message);
    }
  }, [selectedSessionId, setInputDraft]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <p className="text-sm text-text-secondary mb-6">
        {t('chat.welcomeWithProject')}
      </p>
      <div className="flex flex-wrap justify-center gap-3 max-w-lg">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => handleAction(action.message)}
            className="px-4 py-2 text-xs font-medium
              text-text-secondary rounded-full
              border border-border-subtle
              cursor-pointer select-none
              hover:text-text-primary hover:border-text-muted hover:bg-bg-tertiary
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/30
              active:scale-[0.97]"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

import { memo, useState, useCallback, type ReactNode } from 'react';
import { stavebakToolTitle, useToolTitles } from '../../lib/tool-titles';
import { type ChatMessage, useActiveTab } from '../../stores/chatStore';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { classifyPathToken, resolvePathToken } from '../../stores/fileReveal';
import { useLightboxStore } from '../shared/ImageLightbox';
import { useT } from '../../lib/i18n';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { CommandProcessingCard } from './CommandProcessingCard';
import { PlanReviewCard } from './PlanReviewCard';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import {
  ArrowsDownUp,
  CaretRight,
  Check,
  Copy,
  CheckSquare,
  Cube,
  File,
  FileArrowUp,
  FileText,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  PlusCircle,
  Play,
  Square,
  Terminal,
  WarningCircle,
} from '@phosphor-icons/react';

interface Props {
  message: ChatMessage;
  isFirstInGroup?: boolean;
}

/** Guard against raw content-block objects ({text, type}) being rendered as
 *  JSX children — causes Minified React error #31. */
function safeContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

export const MessageBubble = memo(function MessageBubble({ message, isFirstInGroup = true }: Props) {
  if (message.role === 'user') return <UserMsg message={message} />;
  if (message.role === 'system' && message.commandType === 'processing') return <CommandProcessingCard message={message} />;
  if (message.role === 'system' && message.commandType) return <CommandFeedbackMsg message={message} />;
  // Unresolved question/plan_review cards are rendered as floating overlays
  // above the InputBar. Only show them inline once resolved.
  if (message.type === 'question' && !message.resolved) return null;
  if (message.type === 'question') return <QuestionCard message={message} />;
  if (message.type === 'todo') return <TodoMsg message={message} />;
  if (message.type === 'plan_review' && !message.resolved) return null;
  if (message.type === 'plan_review') return <PlanReviewCard message={message} />;
  if (message.type === 'tool_use') return <ToolUseMsg message={message} />;
  if (message.type === 'thinking') return <ThinkingMsg message={message} />;
  if (message.type === 'tool_result') return <ToolResultMsg message={message} />;
  // Unresolved permission cards are rendered as floating overlays above InputBar
  if (message.type === 'permission' && !message.resolved && message.interactionState !== 'resolved') return null;
  if (message.type === 'permission') return <PermissionCard message={message} />;
  if (message.type === 'plan') return <PlanMsg message={message} />;
  return <AssistantMsg message={message} isFirstInGroup={isFirstInGroup} />;
});

/* ================================================================
   UserMsg — bubble on the right
   ================================================================ */
/** Collapse threshold: messages longer than this are collapsed by default */
const USER_MSG_COLLAPSE_LINES = 12;

/** Extract file extension from a filename */
function getFileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Render a single backtick-inner segment: file path → clickable chip, else → inline code */
function renderCodeSegment(inner: string, key: number): ReactNode {
  const kind = classifyPathToken(inner);
  if (kind) {
    const wd = useSettingsStore.getState().workingDirectory || '';
    const resolved = resolvePathToken(inner, wd);
    return (
      <button
        key={key}
        onClick={(e) => {
          e.stopPropagation();
          // Navigate: expand the file tree to this path and highlight it (no preview)
          useSettingsStore.getState().setSecondaryTab('files');
          useFileStore.getState().revealPath(resolved);
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5
          bg-bg-chat/70 border border-border rounded-full
          text-xs font-medium cursor-pointer
          hover:bg-bg-chat select-none
          align-baseline leading-normal whitespace-nowrap inline-block"
        title={resolved}
      >
        <span className="text-xs leading-none">{kind === 'folder' ? '📁' : '📄'}</span>
        <span className="max-w-[240px] truncate">{inner}</span>
      </button>
    );
  }
  return (
    <code key={key} className="px-1.5 py-0.5 mx-0.5 rounded-md text-sm
      bg-bg-chat/70 border border-border-subtle font-mono">
      {inner}
    </code>
  );
}

/** Parse backtick-wrapped segments in user text into styled inline code elements.
 *  Handles both single ` and triple ``` (renders as single-line code).
 *  File paths inside backticks become clickable chips. */
function renderUserContent(text: string): ReactNode {
  // Split on backtick patterns: ```...``` or `...`
  const parts = text.split(/(```[^`]*```|`[^`\n]+`)/g);
  if (parts.length === 1) return text; // no backticks found, return plain string

  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3).trim();
      if (!inner) return part;
      return renderCodeSegment(inner, i);
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1);
      if (!inner) return part;
      return renderCodeSegment(inner, i);
    }
    return part;
  });
}

/** User turns sent by an action button start with this marker (kept in the transcript, so it survives reload). */
export const ACTION_PREFIX = '▶ ';

function UserMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const attachments = message.attachments;
  const content = safeContent(message.content);
  const lines = content.split('\n');
  const isLong = lines.length > USER_MSG_COLLAPSE_LINES || content.length > 600;
  const displayContent = (!expanded && isLong)
    ? lines.slice(0, USER_MSG_COLLAPSE_LINES).join('\n')
    : content;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  // Action from a button (e.g. "▶ Další krok: …"), not something the user typed
  if (content.startsWith(ACTION_PREFIX)) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-text-muted">
        <Play size={11} weight="fill" className="text-text-tertiary flex-shrink-0" />
        <span>{content.slice(ACTION_PREFIX.length)}</span>
      </div>
    );
  }

  return (
    <div className="flex justify-end group/user relative">
      {/* Copy button — visible on hover */}
      <button
        onClick={handleCopy}
        className="absolute -top-3 right-0 z-10 opacity-0 group-hover/user:opacity-100
          w-7 h-7 rounded-full flex items-center justify-center
          bg-bg-card text-text-muted hover:text-text-primary
          border border-border-subtle shadow-sm
          transition-smooth cursor-pointer"
        title={copied ? t('msg.copied') : t('msg.copyText')}
      >
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="regular" />}
      </button>
      <div className="max-w-[75%] px-4 py-2.5 rounded-[var(--radius-message)]
        user-bubble text-base leading-normal whitespace-pre-wrap">
        {renderUserContent(displayContent)}
        {!expanded && isLong && (
          <span className="text-text-tertiary">…</span>
        )}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="block mt-1.5 text-xs text-text-tertiary hover:text-text-primary"
          >
            {expanded ? '▲ Collapse' : '▼ Expand all'}
          </button>
        )}
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {attachments.map((att, i) => (
              <button
                key={i}
                onClick={() => {
                  if (att.isImage) {
                    useLightboxStore.getState().openFile(att.path, att.name);
                  } else {
                    useFileStore.getState().selectFile(att.path);
                  }
                }}
                className="inline-flex items-center gap-2 px-2.5 py-1.5
                  bg-bg-chat/70 hover:bg-bg-chat rounded-lg border border-border-subtle
                  cursor-pointer text-left"
              >
                {att.isImage && att.preview ? (
                  <img src={att.preview} alt="" className="w-8 h-8 rounded object-cover" />
                ) : (
                  <span className="flex items-center justify-center w-8 h-8 rounded
                    bg-bg-tertiary text-xs font-mono font-semibold uppercase opacity-80">
                    {getFileExt(att.name) || (
                      <File size={14} weight="light" />
                    )}
                  </span>
                )}
                <span className="text-xs truncate max-w-[180px]">{att.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   CommandFeedbackMsg — rich UI for slash command results
   Renders mode switches, info cards, help lists, action feedback
   ================================================================ */
function CommandFeedbackMsg({ message }: Props) {
  const t = useT();
  const cType = message.commandType;
  const data = message.commandData || {};

  // --- Mode switch: animated pill with icon ---
  if (cType === 'mode') {
    const modeColors: Record<string, string> = {
      ask: 'from-blue-500/15 to-blue-400/5 border-blue-400/30 text-blue-400',
      plan: 'from-amber-500/15 to-amber-400/5 border-amber-400/30 text-amber-400',
      code: 'from-emerald-500/15 to-emerald-400/5 border-emerald-400/30 text-emerald-400',
    };
    const colorClass = modeColors[data.mode] || modeColors.code;
    return (
      <div className="flex justify-center my-2 animate-fade-in">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full
          bg-gradient-to-r ${colorClass} border
          shadow-sm transition-all duration-300`}>
          <span className="text-base">{data.icon}</span>
          <span className="text-xs font-medium">{safeContent(message.content)}</span>
        </div>
      </div>
    );
  }

  // --- Model switch: centered pill ---
  if (cType === 'model-switch') {
    return (
      <div className="flex justify-center my-2 animate-fade-in">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full
          border border-border-subtle text-text-tertiary text-xs">
          <ArrowsDownUp size={11} weight="light" className="flex-shrink-0 opacity-60" />
          {safeContent(message.content)}
        </div>
      </div>
    );
  }

  // --- Info card: structured key-value table or preformatted text ---
  if (cType === 'info') {
    const rows: Array<{ label: string; value: string }> = data.rows || [];

    // Preformatted output (e.g. CLI command results)
    if (data.preformatted) {
      return (
        <div className="my-1 animate-fade-in">
          <div className="rounded-lg border border-border-subtle
            bg-bg-secondary/50 overflow-hidden max-w-md">
            <div className="flex items-center gap-2 px-3 py-1.5
              border-b border-border-subtle/50 bg-bg-tertiary/30">
              <span className="text-xs font-mono text-text-tertiary">{data.command}</span>
            </div>
            <pre className="px-3 py-2 text-xs font-mono text-text-primary
              whitespace-pre-wrap break-words overflow-x-auto max-h-60 overflow-y-auto">
              {safeContent(message.content)}
            </pre>
          </div>
        </div>
      );
    }

    return (
      <div className="my-1 animate-fade-in">
        <div className="inline-block rounded-lg border border-border-subtle
          bg-bg-secondary/50 overflow-hidden max-w-xs">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5
            border-b border-border-subtle/50 bg-bg-tertiary/30">
            <span className="text-xs font-semibold text-text-primary">
              {data.title || safeContent(message.content)}
            </span>
          </div>
          {/* Rows */}
          {rows.length > 0 ? (
            <div className="divide-y divide-border-subtle/30">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-3 py-1.5">
                  <span className="text-xs text-text-tertiary">{row.label}</span>
                  <span className={`text-xs font-mono font-medium
                    ${row.value === '—' ? 'text-text-tertiary/50' : 'text-text-primary'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-text-tertiary italic">
              {t('cmd.noSessionData')}
            </div>
          )}
          {/* Hint */}
          {data.hint && (
            <div className="px-3 py-1.5 border-t border-border-subtle/50
              text-xs text-text-tertiary/70">
              {data.hint}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Help: formatted command list ---
  if (cType === 'help') {
    const builtins: Array<{ name: string; desc: string }> = data.builtins || [];
    return (
      <div className="my-1 animate-fade-in">
        <div className="rounded-lg border border-border-subtle
          bg-bg-secondary/50 overflow-hidden max-w-md">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5
            border-b border-border-subtle/50 bg-bg-tertiary/30">
            <span className="text-xs">📖</span>
            <span className="text-xs font-semibold text-text-primary">
              {safeContent(message.content)}
            </span>
          </div>
          {/* Built-in commands */}
          <div className="p-2 space-y-0.5">
            {builtins.map((cmd, i) => (
              <div key={i} className="flex items-baseline gap-2 px-1.5 py-0.5
                rounded hover:bg-bg-tertiary/40 transition-colors">
                <code className="text-xs font-mono text-accent font-medium w-20 flex-shrink-0">
                  {cmd.name}
                </code>
                <span className="text-xs text-text-muted truncate">
                  {cmd.desc}
                </span>
              </div>
            ))}
          </div>
          {/* Footer stats */}
          <div className="flex items-center gap-3 px-3 py-1.5
            border-t border-border-subtle/50 text-xs text-text-tertiary">
            <span>{t('cmd.helpCustom')}: {data.customCount ?? 0}</span>
            <span>•</span>
            <span>{t('cmd.helpSkills')}: {data.skillCount ?? 0}</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Action feedback: inline with icon/spinner ---
  if (cType === 'action') {
    return (
      <div className="flex justify-center my-1.5 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
          bg-bg-secondary/60 border border-border-subtle text-xs text-text-muted">
          {data.loading ? (
            <span className="w-3 h-3 border-2 border-accent/30 border-t-accent
              rounded-full animate-spin" />
          ) : (
            <span className="text-sm">✓</span>
          )}
          <span>{safeContent(message.content)}</span>
        </div>
      </div>
    );
  }

  // --- Error feedback ---
  if (cType === 'error') {
    return (
      <div className="flex justify-center my-1.5 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
          bg-red-500/5 border border-red-500/20 text-xs text-red-400">
          <WarningCircle size={12} weight="light" className="flex-shrink-0" />
          <span>{safeContent(message.content)}</span>
        </div>
      </div>
    );
  }

  // Fallback: render as plain text
  return (
    <div className="flex justify-center my-1 animate-fade-in">
      <span className="text-xs text-text-tertiary">{safeContent(message.content)}</span>
    </div>
  );
}

/* ================================================================
   AssistantMsg — markdown with avatar (uses shared MarkdownRenderer)
   ================================================================ */
function AssistantMsg({ message }: Props) {
  return (
    <div>
      <div className="text-base text-text-primary leading-relaxed">
        <MarkdownRenderer content={safeContent(message.content)} />
      </div>
    </div>
  );
}

/* ================================================================
   ToolUseMsg — inline collapsible, no card
   Enhanced display for Edit/Write/Read with diff stats, file icons
   ================================================================ */

/** Compute line diff stats from Edit tool input (common prefix/suffix algorithm) */
function computeEditDiff(input: any): { added: number; removed: number } | null {
  if (!input?.old_string || !input?.new_string) return null;
  const oldLines: string[] = input.old_string.split('\n');
  const newLines: string[] = input.new_string.split('\n');

  // Find common prefix
  let prefixLen = 0;
  while (prefixLen < oldLines.length && prefixLen < newLines.length
         && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (from remaining after prefix)
  let suffixLen = 0;
  while (suffixLen < oldLines.length - prefixLen
         && suffixLen < newLines.length - prefixLen
         && oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]) {
    suffixLen++;
  }

  return {
    added: Math.max(0, newLines.length - prefixLen - suffixLen),
    removed: Math.max(0, oldLines.length - prefixLen - suffixLen),
  };
}

/** Compute lines for Write tool input */
function computeWriteLines(input: any): number | null {
  if (!input?.content) return null;
  return input.content.split('\n').length;
}

/** Get short filename from path */
function shortPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts.length > 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] || filePath;
}

/** Tool icon using Phosphor icons */
function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case 'Bash':
      return <Terminal size={12} weight="light" className="text-text-tertiary flex-shrink-0" />;
    case 'Read':
      return <FileText size={12} weight="light" className="text-text-tertiary flex-shrink-0" />;
    case 'Write':
      return <FileArrowUp size={12} weight="light" className="text-accent/70 flex-shrink-0" />;
    case 'Edit':
      return <PencilSimple size={12} weight="light" className="text-accent/70 flex-shrink-0" />;
    case 'Glob':
    case 'Grep':
      return <MagnifyingGlass size={12} weight="light" className="text-text-tertiary flex-shrink-0" />;
    case 'Task':
    case 'Agent':
      return <PlusCircle size={12} weight="light" className="text-text-tertiary flex-shrink-0" />;
    case 'WebFetch':
    case 'WebSearch':
      return <Globe size={12} weight="light" className="text-text-tertiary flex-shrink-0" />;
    default:
      return <Cube size={12} weight="light" className="text-text-tertiary flex-shrink-0" />;
  }
}

function getToolLabel(name: string, t: (key: string) => string): string {
  switch (name) {
    case 'Bash': return t('msg.terminal');
    case 'Read': return t('msg.readFile');
    case 'Write': return t('msg.writeFile');
    case 'Edit': return t('msg.editFile');
    case 'Glob': case 'Grep': return t('msg.search');
    case 'Task': case 'Agent': return t('msg.subAgent');
    case 'TodoWrite': return t('msg.todo');
    case 'WebFetch': case 'WebSearch': return t('msg.webFetch');
    case 'ExitPlanMode': case 'EnterPlanMode': return t('msg.planLabel');
    default: return stavebakToolTitle(name) ?? name;
  }
}

export const ToolUseMsg = memo(function ToolUseMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const toolName = message.toolName || 'Tool';
  useToolTitles((s) => s.titles); // překreslit, až se načtou české názvy nástrojů Stavebáku
  const label = getToolLabel(toolName, t);
  const input = message.toolInput;

  // Compute diff stats for Edit tool
  const editDiff = toolName === 'Edit' ? computeEditDiff(input) : null;
  // Compute line count for Write tool
  const writeLines = toolName === 'Write' ? computeWriteLines(input) : null;

  // Build preview content based on tool type
  const renderPreview = () => {
    if (toolName === 'Bash' && input?.command) {
      return (
        <span className="text-xs text-text-tertiary truncate
          font-mono max-w-[350px] bg-bg-secondary/60 px-1.5 py-0.5 rounded">
          {input.command.length > 80 ? input.command.slice(0, 80) + '…' : input.command}
        </span>
      );
    }

    if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') && input?.file_path) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              useFileStore.getState().selectFile(input.file_path);
            }}
            className="text-xs text-accent/70 hover:text-accent font-mono
              truncate max-w-[280px] hover:underline cursor-pointer transition-smooth"
            title={input.file_path}
          >
            {shortPath(input.file_path)}
          </button>
          {/* Diff stats for Edit */}
          {editDiff && (
            <span className="inline-flex items-center gap-1 ml-0.5">
              <span className="text-xs font-mono text-success">+{editDiff.added}</span>
              <span className="text-xs font-mono text-error">-{editDiff.removed}</span>
            </span>
          )}
          {/* Line count for Write */}
          {writeLines !== null && (
            <span className="text-xs font-mono text-success ml-0.5">
              +{writeLines} lines
            </span>
          )}
        </span>
      );
    }

    if ((toolName === 'Glob' || toolName === 'Grep') && input?.pattern) {
      return (
        <span className="text-xs text-text-tertiary truncate
          font-mono max-w-[300px]">
          {input.pattern}
        </span>
      );
    }

    if ((toolName === 'Task' || toolName === 'Agent') && input?.description) {
      return (
        <span className="text-xs text-text-tertiary truncate max-w-[300px] italic">
          {input.description}
        </span>
      );
    }

    if (toolName === 'TeamCreate' && (input?.team_name || input?.name)) {
      return (
        <span className="text-xs text-text-tertiary truncate max-w-[300px] italic">
          Team: {input.team_name || input.name}
        </span>
      );
    }

    if (toolName === 'TaskCreate' && (input?.subject || input?.description)) {
      return (
        <span className="text-xs text-text-tertiary truncate max-w-[300px] italic">
          {input.subject || input.description}
        </span>
      );
    }

    if (toolName === 'SendMessage' && input?.recipient) {
      return (
        <span className="text-xs text-text-tertiary truncate max-w-[300px] italic">
          &rarr; {input.recipient}
        </span>
      );
    }

    if ((toolName === 'WebFetch' || toolName === 'WebSearch') && (input?.url || input?.query)) {
      const display = input.url || input.query;
      return (
        <span className="text-xs text-accent/70 truncate max-w-[300px] font-mono">
          {display}
        </span>
      );
    }

    return null;
  };

  // Determine if input has meaningful content (not empty {} or null)
  const hasInput = input && typeof input === 'object'
    ? Object.keys(input).length > 0
    : !!input;

  // Whether there's a result to show
  const resultContent = typeof message.toolResultContent === 'string'
    ? message.toolResultContent
    : message.toolResultContent ? JSON.stringify(message.toolResultContent) : '';
  const hasResult = resultContent.length > 0;
  const isCompleted = message.toolCompleted || hasResult;

  // Render the expanded detail section
  /** Render a side-by-side diff view for Edit tool old_string → new_string */
  const renderEditDiff = () => {
    if (!input?.old_string && !input?.new_string) return null;
    const oldLines = (input.old_string || '').split('\n');
    const newLines = (input.new_string || '').split('\n');

    return (
      <div key="diff" className="rounded-lg border border-border-subtle overflow-hidden
        max-h-48 overflow-y-auto">
        {/* Removed lines */}
        {oldLines.length > 0 && oldLines[0] !== '' && (
          <div>
            {oldLines.map((line: string, i: number) => (
              <div key={`old-${i}`}
                className="flex items-start gap-0 text-xs font-mono leading-relaxed
                  bg-red-500/8 dark:bg-red-500/10">
                <span className="flex-shrink-0 w-8 text-right pr-2 text-red-400/60
                  select-none border-r border-red-500/10">
                  {i + 1}
                </span>
                <span className="flex-shrink-0 w-5 text-center text-red-400 select-none">−</span>
                <span className="text-red-600 dark:text-red-400 whitespace-pre-wrap break-all
                  flex-1 px-1">{line}</span>
              </div>
            ))}
          </div>
        )}
        {/* Added lines */}
        {newLines.length > 0 && newLines[0] !== '' && (
          <div>
            {newLines.map((line: string, i: number) => (
              <div key={`new-${i}`}
                className="flex items-start gap-0 text-xs font-mono leading-relaxed
                  bg-blue-500/8 dark:bg-blue-500/10">
                <span className="flex-shrink-0 w-8 text-right pr-2 text-blue-400/60
                  select-none border-r border-blue-500/10">
                  {i + 1}
                </span>
                <span className="flex-shrink-0 w-5 text-center text-blue-400 select-none">+</span>
                <span className="text-blue-600 dark:text-blue-400 whitespace-pre-wrap break-all
                  flex-1 px-1">{line}</span>
              </div>
            ))}
          </div>
        )}
        {/* File path */}
        {input.file_path && (
          <div className="px-2 py-1 border-t border-border-subtle/50
            text-xs text-text-tertiary font-mono truncate">
            {input.file_path}
          </div>
        )}
      </div>
    );
  };

  /** Render a Write tool diff — all lines shown as additions (blue) */
  const renderWriteDiff = () => {
    if (!input?.content) return null;
    const allLines = input.content.split('\n');
    const maxDisplay = 20;
    const displayLines = allLines.slice(0, maxDisplay);
    const remaining = allLines.length - maxDisplay;

    return (
      <div key="write-diff" className="rounded-lg border border-border-subtle overflow-hidden
        max-h-48 overflow-y-auto">
        {displayLines.map((line: string, i: number) => (
          <div key={i}
            className="flex items-start gap-0 text-xs font-mono leading-relaxed
              bg-blue-500/8 dark:bg-blue-500/10">
            <span className="flex-shrink-0 w-8 text-right pr-2 text-blue-400/60
              select-none border-r border-blue-500/10">
              {i + 1}
            </span>
            <span className="flex-shrink-0 w-5 text-center text-blue-400 select-none">+</span>
            <span className="text-blue-600 dark:text-blue-400 whitespace-pre-wrap break-all
              flex-1 px-1">{line}</span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="px-2 py-1 text-xs text-text-tertiary font-mono
            bg-blue-500/5 border-t border-blue-500/10">
            ... +{remaining} more lines
          </div>
        )}
        {input.file_path && (
          <div className="px-2 py-1 border-t border-border-subtle/50
            text-xs text-text-tertiary font-mono truncate">
            {input.file_path}
          </div>
        )}
      </div>
    );
  };

  const renderExpandedContent = () => {
    const sections: React.ReactNode[] = [];

    // Show tool input (if meaningful)
    if (hasInput) {
      if (toolName === 'Bash' && input?.command) {
        sections.push(
          <div key="cmd" className="flex items-start gap-1.5">
            <span className="text-text-tertiary/60 text-xs font-mono select-none">$</span>
            <pre className="text-xs text-text-muted font-mono whitespace-pre-wrap break-all">
              {input.command}
            </pre>
          </div>
        );
      } else if (toolName === 'Edit' && (input?.old_string || input?.new_string)) {
        const diffView = renderEditDiff();
        if (diffView) sections.push(diffView);
      } else if (toolName === 'Write' && input?.content) {
        const writeDiffView = renderWriteDiff();
        if (writeDiffView) sections.push(writeDiffView);
      } else {
        sections.push(
          <pre key="input" className="text-xs text-text-tertiary
            overflow-x-auto font-mono leading-relaxed
            max-h-32 overflow-y-auto whitespace-pre-wrap">
            {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
          </pre>
        );
      }
    }

    // Show result content
    if (hasResult) {
      if (hasInput) {
        // Divider between input and result
        sections.push(
          <div key="divider" className="border-t border-border-subtle/50 my-1" />
        );
      }
      sections.push(
        <pre key="result" className="text-xs text-text-tertiary
          overflow-x-auto font-mono leading-relaxed
          max-h-48 overflow-y-auto whitespace-pre-wrap">
          {resultContent}
        </pre>
      );
    }

    return sections.length > 0 ? sections : null;
  };

  // Determine if expand makes sense
  const canExpand = hasInput || hasResult;
  const depth = message.subAgentDepth ?? 0;

  return (
    <div className={depth > 0 ? 'ml-4 mr-0 pl-3 border-l-2 border-accent/15' : 'mr-0'}>
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 py-1 text-left group
          ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {canExpand ? (
          <CaretRight size={10} weight="light"
            className={`flex-shrink-0 text-text-tertiary transition-transform
              duration-150 ${expanded ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-[10px] flex-shrink-0" />
        )}
        <ToolIcon name={toolName} />
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {renderPreview()}
        {/* In-progress indicator: typing dots — result text is optional, completion is explicit. */}
        {!isCompleted && (
          <span
            className="inline-flex items-center gap-[3px] ml-1.5 flex-shrink-0"
            title={t('msg.toolRunning')}
          >
            <span className="w-1 h-1 rounded-full bg-accent animate-typing-dot"
              style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-accent animate-typing-dot"
              style={{ animationDelay: '200ms' }} />
            <span className="w-1 h-1 rounded-full bg-accent animate-typing-dot"
              style={{ animationDelay: '400ms' }} />
          </span>
        )}
        {/* Show a small result indicator when collapsed with result */}
        {!expanded && isCompleted && (
          <Check size={10} weight="light" className="text-success flex-shrink-0 ml-0.5" />
        )}
      </button>
      {expanded && (
        <div className="ml-5 mt-0.5">
          {renderExpandedContent()}
        </div>
      )}
    </div>
  );
});

/* ================================================================
   ToolResultMsg — inline result
   ================================================================ */
function ToolResultMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const content = safeContent(message.content);
  const depth = message.subAgentDepth ?? 0;

  // Show a short one-line preview on the same line as the "Result" label
  const preview = content.length > 0
    ? content.split('\n')[0].slice(0, 60) + (content.length > 60 ? '…' : '')
    : '';

  return (
    <div className={depth > 0 ? 'ml-4 mr-0 pl-3 border-l-2 border-accent/15' : 'mr-0'}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-0.5 cursor-pointer group"
      >
        <CaretRight size={10} weight="light"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`} />
        <Check size={10} weight="light" className="text-success flex-shrink-0" />
        <span className="text-xs text-text-tertiary">{t('msg.result')}</span>
        {!expanded && preview && (
          <span className="text-xs text-text-tertiary/60 font-mono truncate max-w-[300px]">
            {preview}
          </span>
        )}
      </button>
      {expanded && content && (
        <pre className="ml-5 mt-0.5 text-xs text-text-tertiary
          overflow-x-auto font-mono leading-relaxed
          max-h-48 overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}

/* ================================================================
   ThinkingMsg — minimal collapsible
   ================================================================ */
function ThinkingMsg({ message }: Props) {
  const t = useT();
  const durationSec = useActiveTab((tab) => {
    const idx = tab.messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return undefined;
    const next = tab.messages[idx + 1];
    if (!next) return undefined;
    // Messages replayed from disk carry no timestamps — duration is unknown, not running
    const ms = next.timestamp - message.timestamp;
    return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 1000)) : null;
  });
  const label = durationSec === undefined
    ? t('msg.thinking')
    : durationSec === null
      ? t('msg.thought')
      : t('msg.thoughtFor').replace('{seconds}', String(durationSec));
  return (
    <div className="mr-0">
      <details className="group">
        <summary className="flex items-center gap-1.5 py-1
          cursor-pointer text-xs text-text-tertiary list-none select-none">
          <CaretRight size={10} weight="light"
            className="transition-transform duration-150 group-open:rotate-90" />
          {label}
        </summary>
        <pre className="ml-5 mt-0.5 text-xs text-text-tertiary
          whitespace-pre-wrap max-h-48 overflow-y-auto
          font-mono leading-relaxed">
          {safeContent(message.content)}
        </pre>
      </details>
    </div>
  );
}

/* PermissionMsg — extracted to PermissionCard.tsx */

/* ================================================================
   PlanMsg — inline collapsible list (no card)
   ================================================================ */
function PlanMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const items = message.planItems || (typeof message.content === 'string' ? message.content.split('\n').filter(Boolean) : []);

  return (
    <div className="mr-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 cursor-pointer"
      >
        <CaretRight size={10} weight="light"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`} />
        <span className="text-xs font-medium text-text-muted">
          {t('msg.planTitle')}
        </span>
        <span className="text-xs text-text-tertiary">
          ({items.length} {t('msg.planSteps')})
        </span>
      </button>
      {expanded && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-text-muted">
              <span className="flex-shrink-0 text-text-tertiary font-mono w-4 text-right">
                {i + 1}.
              </span>
              <span className="leading-relaxed">
                {item.replace(/^[\d]+\.\s*/, '').replace(/^[-•]\s*/, '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   TodoMsg — tree-style with indent connector lines (Claude Code style)
   ================================================================ */
function TodoMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const items = Array.isArray(message.todoItems) ? message.todoItems : [];
  const completedCount = items.filter((i) => i.status === 'completed').length;
  const inProgressItem = items.find((i) => i.status === 'in_progress');

  return (
    <div className="mr-0">
      {/* Header — collapsible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 cursor-pointer text-left"
      >
        <CaretRight size={10} weight="light"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`} />
        <span className="text-xs font-semibold text-text-primary">{t('msg.todo')}</span>
        <span className="text-xs text-text-tertiary">
          {completedCount}/{items.length}
        </span>
        {inProgressItem && (
          <span className="text-xs text-accent italic ml-1 truncate max-w-[200px]">
            {inProgressItem.activeForm || inProgressItem.content}
          </span>
        )}
      </button>
      {/* Tree-style checklist with connector lines */}
      {expanded && (
        <div className="ml-[7px] mt-0.5">
          {items.map((item, i) => {
            const isLast = i === items.length - 1;
            return (
              <div key={i} className="flex items-stretch">
                {/* Connector line column */}
                <div className="flex flex-col items-center w-4 flex-shrink-0">
                  {/* Horizontal branch + vertical trunk */}
                  <div className="flex items-center h-5">
                    <div className={`w-px h-full ${isLast ? 'h-1/2 self-start' : ''}`}
                      style={{
                        background: 'var(--color-border)',
                        height: isLast ? '50%' : '100%',
                        alignSelf: isLast ? 'flex-start' : undefined,
                      }}
                    />
                    <div className="w-2 h-px" style={{ background: 'var(--color-border)' }} />
                  </div>
                  {/* Continuing trunk below (hidden for last item) */}
                  {!isLast && (
                    <div className="w-px flex-1" style={{ background: 'var(--color-border)' }} />
                  )}
                </div>
                {/* Status icon + text */}
                <div className="flex items-center gap-1.5 py-0.5 min-h-[20px]">
                  {item.status === 'completed' ? (
                    <CheckSquare size={11} weight="fill" className="flex-shrink-0 text-success" />
                  ) : item.status === 'in_progress' ? (
                    <span className="w-[11px] h-[11px] flex items-center justify-center flex-shrink-0">
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-accent
                        bg-accent/20 animate-pulse-soft" />
                    </span>
                  ) : (
                    <Square size={11} weight="light" className="flex-shrink-0 text-text-tertiary/40" />
                  )}
                  <span className={`text-xs leading-tight
                    ${item.status === 'completed'
                      ? 'text-text-tertiary line-through'
                      : item.status === 'in_progress'
                        ? 'text-text-primary font-medium'
                        : 'text-text-muted'
                    }`}>
                    {item.content}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* PlanReviewMsg — extracted to PlanReviewCard.tsx */

/* QuestionMsg — extracted to QuestionCard.tsx */

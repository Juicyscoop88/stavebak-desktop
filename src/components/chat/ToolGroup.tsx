import { useState, useMemo } from 'react';
import { type ChatMessage } from '../../stores/chatStore';
import { ToolUseMsg } from './MessageBubble';
import { useT } from '../../lib/i18n';
import { CaretRight, Check, Stack } from '@phosphor-icons/react';

interface Props {
  messages: ChatMessage[];
}

/** Build a summary like "Edit x2, Read, Bash" from a list of tool messages */
function buildToolSummary(messages: ChatMessage[]): string {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    const name = m.toolName || 'Tool';
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => count > 1 ? `${name} \u00d7${count}` : name)
    .join(', ');
}

/**
 * ToolGroup — collapsible wrapper for 3+ consecutive tool_use messages.
 *
 * - Collapsed: summary line "4 tool calls (Edit x2, Read, Bash)"
 * - Expanded: individual ToolUseMsg components with a left border connector
 * - Auto-collapses when all tools have results
 */
export function ToolGroup({ messages }: Props) {
  const t = useT();

  // Auto-collapse when all tools have results
  const allHaveResults = useMemo(
    () => messages.every((m) => m.toolCompleted || (m.toolResultContent && m.toolResultContent.length > 0)),
    [messages],
  );

  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => buildToolSummary(messages), [messages]);
  const count = messages.length;

  // Check if this group is inside a sub-agent (first message determines depth)
  const depth = messages[0]?.subAgentDepth ?? 0;

  return (
    <div className={`ml-11 ${depth > 0 ? 'ml-16 pl-3 border-l-2 border-accent/15' : ''}`}>
      {/* Summary header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 text-left group cursor-pointer"
      >
        <CaretRight size={10} weight="light"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`} />
        {/* Stacked tool icon */}
        <Stack size={12} weight="light" className="text-text-tertiary flex-shrink-0" />
        <span className="text-xs font-medium text-text-muted">
          {t('msg.toolGroup').replace('{n}', String(count))}
        </span>
        <span className="text-xs text-text-tertiary truncate max-w-[300px]">
          ({summary})
        </span>
        {/* All-complete indicator */}
        {allHaveResults && !expanded && (
          <Check size={10} weight="light" className="text-success flex-shrink-0 ml-0.5" />
        )}
      </button>

      {/* Expanded: individual tool messages with connector */}
      {expanded && (
        <div className="border-l-2 border-border-subtle ml-[5px] pl-2 space-y-0">
          {messages.map((msg) => (
            <div key={msg.id} className="-ml-11">
              <ToolUseMsg message={msg} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

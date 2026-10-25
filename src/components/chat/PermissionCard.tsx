import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ChatMessage, useChatStore } from '../../stores/chatStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { Check, SpinnerGap, Warning } from '@phosphor-icons/react';

interface Props {
  message: ChatMessage;
}

/**
 * PermissionCard — displays structured permission requests from the SDK control protocol.
 *
 * Uses the `permissionData` field (from control_request/can_use_tool) for rich display
 * and `bridge.respondPermission` for typed allow/deny responses.
 *
 * Interaction state machine:
 *   pending  → user sees Allow/Deny buttons
 *   sending  → spinner while response is being sent to CLI
 *   resolved → checkmark, card fades
 *   failed   → error message + Retry button
 */
export function PermissionCard({ message }: Props) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  const interactionState = message.interactionState ?? (message.resolved ? 'resolved' : 'pending');
  const permData = message.permissionData;
  const resolveOwner = useCallback((): { tabId: string; stdinId: string } | null => {
    if (message.owner?.tabId && message.owner.stdinId) return { ...message.owner };
    const tabs = Array.from(useChatStore.getState().tabs.values());
    const match = tabs.find((tab) => tab.messages.some((m) => m.id === message.id));
    const stdinId = match?.sessionMeta.stdinId;
    if (match && stdinId) return { tabId: match.tabId, stdinId };
    return null;
  }, [message.id, message.owner]);

  // Determine display values — prefer structured permissionData, fallback to legacy fields
  const toolName = permData?.toolName ?? message.permissionTool ?? '';
  const description = permData?.description ?? '';
  const inputPreview = useMemo(() => {
    if (permData?.input) {
      return formatInput(permData.toolName, permData.input);
    }
    return typeof message.content === 'string' ? message.content : '';
  }, [message.content, permData?.input, permData?.toolName]);

  const handleRespond = useCallback(async (allow: boolean) => {
    const owner = resolveOwner();
    if (!owner) return;
    const { setInteractionState, setSessionStatus, setActivityStatus } = useChatStore.getState();

    // If we have structured permissionData, use SDK control protocol
    if (permData?.requestId) {
      setInteractionState(owner.tabId, message.id, 'sending');
      try {
        await bridge.respondPermission(
          owner.stdinId,
          permData.requestId,
          allow,
          allow ? undefined : 'User denied this operation',
          permData.toolUseId,
          allow ? permData.input : undefined,
        );
        setInteractionState(owner.tabId, message.id, 'resolved');
        setSessionStatus(owner.tabId, 'running');
        setActivityStatus(owner.tabId, { phase: 'thinking' });
      } catch (err) {
        setInteractionState(owner.tabId, message.id, 'failed', String(err));
      }
    } else {
      // Legacy fallback: send raw y/n to stdin (for bypass/old-style)
      setInteractionState(owner.tabId, message.id, 'sending');
      try {
        await bridge.sendRawStdin(owner.stdinId, allow ? 'y' : 'n');
        setInteractionState(owner.tabId, message.id, 'resolved');
        setSessionStatus(owner.tabId, 'running');
        setActivityStatus(owner.tabId, { phase: 'thinking' });
      } catch (err) {
        console.warn('[TC:permission] Legacy permission response failed:', err);
        setInteractionState(owner.tabId, message.id, 'failed', String(err));
      }
    }
    setRetrying(false);
  }, [message.id, permData, resolveOwner]);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    // Reset to pending state, then let user choose again
    const owner = resolveOwner();
    if (owner) {
      useChatStore.getState().setInteractionState(owner.tabId, message.id, 'pending');
    }
    setRetrying(false);
  }, [message.id, resolveOwner]);

  const isResolved = interactionState === 'resolved';
  const isSending = interactionState === 'sending';
  const isFailed = interactionState === 'failed';
  const isPending = interactionState === 'pending';

  // Expose permission respond handler for test harness (dev only)
  useEffect(() => {
    if (import.meta.env.DEV && isPending) {
      (window as any).__stavebak_respond_permission = handleRespond;
    }
    return () => {
      if (import.meta.env.DEV) {
        delete (window as any).__stavebak_respond_permission;
      }
    };
  }, [handleRespond, isPending]);

  return (
    <div className={`animate-scale-in ${isResolved ? 'opacity-60' : ''}`}
      {...(import.meta.env.DEV && { 'data-testid': 'permission-card' })}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${isResolved
          ? 'border-border-subtle bg-bg-secondary/30'
          : isFailed
            ? 'border-l-[3px] border-l-error border-r border-t border-b border-r-error/20 border-t-error/20 border-b-error/20 bg-gradient-to-r from-error/5 to-transparent shadow-sm'
            : 'border-l-[3px] border-l-warning border-r border-t border-b border-r-warning/20 border-t-warning/20 border-b-warning/20 bg-gradient-to-r from-warning/5 to-transparent shadow-sm'
        }`}>
        {/* Header row */}
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <Warning size={14} weight="light" className="text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-text-primary">
                {t('msg.permissionTitle')}
              </span>
              {toolName && (
                <code className="text-xs px-1.5 py-0.5 rounded
                  bg-warning/10 text-warning font-mono font-medium">
                  {toolName}
                </code>
              )}
            </div>
            {description && (
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {/* Status indicator */}
          {isResolved && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <Check size={12} weight="light" className="text-success" />
              <span className="text-xs text-success font-medium">
                {t('msg.responded')}
              </span>
            </span>
          )}
          {isSending && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <SpinnerGap size={12} weight="light" className="text-text-muted animate-spin" />
              <span className="text-xs text-text-muted">
                Sending...
              </span>
            </span>
          )}
        </div>

        {/* Input preview */}
        {inputPreview && (
          <div className="px-3 pb-2">
            <pre className="text-xs text-text-muted font-mono leading-relaxed
              whitespace-pre-wrap break-words bg-bg-secondary/50 rounded-lg px-2.5 py-2
              border border-border-subtle/30 max-h-32 overflow-y-auto">
              {inputPreview}
            </pre>
          </div>
        )}

        {/* Error state */}
        {isFailed && (
          <div className="px-3 pb-2">
            <div className="text-xs text-error bg-error/5 rounded-lg px-2.5 py-2
              border border-error/20">
              {message.interactionError || 'Failed to send response'}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {(isPending || isFailed) && (
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-subtle/50
            bg-bg-secondary/20">
            {isPending && (
              <>
                <button
                  onClick={() => handleRespond(true)}
                  {...(import.meta.env.DEV && { 'data-testid': 'permission-allow-button' })}
                  className="px-4 py-2 rounded-lg text-xs font-semibold
                    border-2 border-success/40 text-success bg-success/5
                    hover:bg-success/15 transition-smooth cursor-pointer
                    flex items-center gap-1.5"
                >
                  <Check size={12} weight="light" />
                  {t('msg.permissionAllowHint')}
                </button>
                <button
                  onClick={() => handleRespond(false)}
                  {...(import.meta.env.DEV && { 'data-testid': 'permission-deny-button' })}
                  className="px-3 py-2 rounded-lg text-xs font-medium
                    text-text-muted border border-border-subtle
                    hover:bg-bg-secondary hover:text-text-primary
                    transition-smooth cursor-pointer"
                >
                  {t('msg.permissionDenyHint')}
                </button>
              </>
            )}
            {isFailed && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-4 py-2 rounded-lg text-xs font-semibold
                  border-2 border-warning/40 text-warning bg-warning/5
                  hover:bg-warning/15 transition-smooth cursor-pointer
                  flex items-center gap-1.5"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Format tool input for display. Shows the most relevant field per tool type. */
function formatInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return String(input.command ?? JSON.stringify(input, null, 2));
    case 'Edit':
    case 'Write':
      return String(input.file_path ?? JSON.stringify(input, null, 2));
    case 'Read':
      return String(input.file_path ?? JSON.stringify(input, null, 2));
    default:
      return JSON.stringify(input, null, 2);
  }
}

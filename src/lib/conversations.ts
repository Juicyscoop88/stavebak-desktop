/**
 * Conversations scoped to a project folder.
 *
 * Builders think in projects, not chats: opening a project resumes its most recent
 * conversation, "Nové téma" starts a fresh one in the same folder, and history only
 * ever lists conversations of the open project.
 */
import { useSessionStore } from '../stores/sessionStore';
import { useChatStore, generateMessageId } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFileStore } from '../stores/fileStore';
import { useAgentStore } from '../stores/agentStore';
import { bridge, type SessionListItem } from './tauri-bridge';
import { parseSessionMessages } from './session-loader';
import { t } from './i18n';

const sameDir = (a: string, b: string) => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

/** Saved conversations of one project folder, newest first. */
export function projectConversations(sessions: SessionListItem[], dir: string): SessionListItem[] {
  return sessions
    .filter((s) => s.path && sameDir(s.project, dir))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function stashCurrent() {
  const currentId = useSessionStore.getState().selectedSessionId;
  if (!currentId) return;
  const tab = useChatStore.getState().tabs.get(currentId);
  // An untouched draft isn't worth keeping around
  if (!currentId.match(/^[0-9a-f-]{36}$/) && (!tab || tab.messages.length === 0)) {
    useSessionStore.getState().removeDraft(currentId);
    useChatStore.getState().removeTab(currentId);
    return;
  }
  useChatStore.getState().saveToCache(currentId);
  useAgentStore.getState().saveToCache(currentId);
}

/** Start an empty conversation in `dir`. */
export function startConversation(dir: string): string {
  stashCurrent();
  const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  useChatStore.getState().ensureTab(draftId);
  useChatStore.getState().resetTab(draftId);
  useSessionStore.getState().addDraftSession(draftId, dir);
  useSessionStore.getState().setSelectedSession(draftId);
  return draftId;
}

/** Show a saved conversation (from cache, or replayed from the CLI's JSONL). */
export async function openConversation(session: SessionListItem): Promise<void> {
  const { id: sessionId, path: sessionPath } = session;
  if (useSessionStore.getState().selectedSessionId === sessionId) return;

  stashCurrent();
  useSessionStore.getState().setSelectedSession(sessionId);

  if (useChatStore.getState().restoreFromCache(sessionId)) {
    useAgentStore.getState().restoreFromCache(sessionId);
    nameIfUntitled(sessionId);
    return;
  }

  const chat = useChatStore.getState();
  chat.ensureTab(sessionId);
  chat.clearMessages(sessionId);
  useAgentStore.getState().clearAgents();
  chat.setSessionStatus(sessionId, 'running');
  // No live process yet — only the CLI id for --resume (see TK-329)
  chat.setSessionMeta(sessionId, { sessionId, stdinId: undefined });
  useSessionStore.getState().setCliResumeId(sessionId, sessionId);

  try {
    const raw = await bridge.loadSession(sessionPath);
    if (useSessionStore.getState().selectedSessionId !== sessionId) return;
    const { messages, agents } = parseSessionMessages(raw);
    for (const agent of agents) useAgentStore.getState().upsertAgent(agent);
    for (const msg of messages) {
      if (msg.toolResultContent) {
        const { toolResultContent, ...base } = msg;
        chat.addMessage(sessionId, base);
        useChatStore.getState().updateMessage(sessionId, msg.id, { toolResultContent });
      } else {
        chat.addMessage(sessionId, msg);
      }
    }
    chat.setSessionStatus(sessionId, 'completed');
    nameIfUntitled(sessionId);
  } catch (err) {
    if (useSessionStore.getState().selectedSessionId !== sessionId) return;
    chat.setSessionStatus(sessionId, 'error');
    chat.addMessage(sessionId, {
      id: generateMessageId(),
      role: 'system',
      type: 'text',
      content: `${t('conv.loadFailed')}: ${err}`,
      timestamp: Date.now(),
    });
  }
}

/** Older conversations predate titles — name them from content the first time they're opened. */
function nameIfUntitled(sessionId: string) {
  if (useSessionStore.getState().customPreviews[sessionId]) return;
  const messages = useChatStore.getState().tabs.get(sessionId)?.messages ?? [];
  const text = (role: string) => messages
    .filter((m) => m.role === role && m.type === 'text' && m.content)
    .map((m) => m.content).join('\n').slice(0, 500);
  const user = text('user');
  const assistant = text('assistant');
  if (!user || !assistant) return;
  bridge.generateSessionTitle(user, assistant)
    .then((title) => { if (title) useSessionStore.getState().setCustomPreview(sessionId, title); })
    .catch(() => {});
}

/** Switch to a project folder and pick up where its last conversation left off. */
export async function openProject(dir: string): Promise<void> {
  useFileStore.getState().closePreview();
  useSettingsStore.getState().setWorkingDirectory(dir);
  await useSessionStore.getState().fetchSessions();
  if (useSettingsStore.getState().workingDirectory !== dir) return;

  const last = projectConversations(useSessionStore.getState().sessions, dir)[0];
  if (last) await openConversation(last);
  else startConversation(dir);
}

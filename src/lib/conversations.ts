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
import { teardownSession, waitForStdinCleared } from './sessionLifecycle';

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

/** Switch to a project folder and pick up where its last conversation left off.
 *  `fresh` (a just-created project) always starts empty, even if an older folder at the
 *  same path left conversations behind. */
export async function openProject(dir: string, { fresh = false }: { fresh?: boolean } = {}): Promise<void> {
  useFileStore.getState().closePreview();
  useSettingsStore.getState().setWorkingDirectory(dir);
  if (fresh) {
    startConversation(dir);
    return;
  }
  await useSessionStore.getState().fetchSessions();
  if (useSettingsStore.getState().workingDirectory !== dir) return;

  const last = projectConversations(useSessionStore.getState().sessions, dir)[0];
  if (last) await openConversation(last);
  else startConversation(dir);
}

/** Delete a saved conversation; if it's the open one, continue with the project's next latest. */
export async function deleteConversation(session: SessionListItem): Promise<void> {
  const { id: sessionId, path: sessionPath } = session;
  // Stop its CLI process first so nothing keeps writing to the deleted transcript
  const tab = useChatStore.getState().getTab(sessionId);
  const stdinIds = new Set([
    ...(tab?.sessionMeta.stdinId ? [tab.sessionMeta.stdinId] : []),
    ...Object.entries(useSessionStore.getState().stdinToTab).filter(([, id]) => id === sessionId).map(([stdin]) => stdin),
  ]);
  for (const stdinId of stdinIds) {
    await teardownSession(stdinId, sessionId, 'delete');
    if (tab?.sessionMeta.stdinId === stdinId) await waitForStdinCleared(sessionId, stdinId).catch(() => {});
  }

  if (sessionPath) await bridge.deleteSession(sessionId, sessionPath);
  else useSessionStore.getState().removeDraft(sessionId);
  useChatStore.getState().removeFromCache(sessionId);
  useAgentStore.getState().clearCacheForTab(sessionId);
  bridge.clearPathGrants(sessionId).catch(() => {});

  const wasOpen = useSessionStore.getState().selectedSessionId === sessionId;
  await useSessionStore.getState().fetchSessions();
  if (!wasOpen) return;
  useChatStore.getState().removeTab(sessionId);
  const dir = useSettingsStore.getState().workingDirectory;
  const next = projectConversations(useSessionStore.getState().sessions, dir)[0];
  useSessionStore.getState().setSelectedSession(null);
  if (next) await openConversation(next);
  else startConversation(dir);
}

/** Move a project folder and its conversations to the system Trash (recoverable), drop it from the list. */
export async function deleteProject(dir: string): Promise<void> {
  const isOpen = useSettingsStore.getState().workingDirectory === dir;
  if (isOpen) {
    stashCurrent();
    useFileStore.getState().closePreview();
    useSessionStore.getState().setSelectedSession(null);
  }
  // Its conversations go too — otherwise they resurface if a folder with the same name is created
  await useSessionStore.getState().fetchSessions();
  for (const session of projectConversations(useSessionStore.getState().sessions, dir)) {
    await deleteConversation(session);
  }
  await bridge.deleteFile(dir);
  useSettingsStore.getState().removeProject(dir);
  if (isOpen) useSettingsStore.getState().setWorkingDirectory('');
}

import { useEffect } from 'react';
import { useOpenAiStore } from '../../stores/openaiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useT } from '../../lib/i18n';

const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

function openUrl(url: string) {
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => {});
}

/** Poskytovatel aktivní konverzace (nová konverzace dostane výchozího z nastavení). */
function useActiveProvider() {
  const tabId = useSessionStore((s) => s.selectedSessionId);
  const tabProvider = useChatStore((s) => (tabId ? s.getTab(tabId)?.sessionMeta.provider : undefined));
  const fallback = useSettingsStore((s) => s.aiProvider);
  return tabProvider ?? fallback;
}

/**
 * „Using ChatGPT plan“ u pole pro zprávu, když konverzace čerpá z plánu ChatGPT
 * (pokyny Sign in with ChatGPT: označení u composeru a odkaz Manage usage).
 */
export function ChatGptPlanBadge() {
  const t = useT();
  const provider = useActiveProvider();
  const status = useOpenAiStore((s) => s.status);
  const refresh = useOpenAiStore((s) => s.refresh);
  useEffect(() => { if (provider === 'codex' && !status) refresh(); }, [provider, status, refresh]);

  if (provider !== 'codex' || !status?.chatgpt_signed_in) return null;
  return (
    <div className="flex justify-end gap-2 px-4 pt-1 text-xs text-text-tertiary select-none">
      <span>{t('chatgpt.usingPlan')}</span>
      <span aria-hidden>·</span>
      <button onClick={() => openUrl(MANAGE_USAGE_URL)} className="hover:text-text-primary underline-offset-2 hover:underline cursor-pointer">
        {t('chatgpt.manageUsage')}
      </button>
    </div>
  );
}

/** Jednou po prvním přihlášení přes ChatGPT: „You're using your ChatGPT plan“ / „Got it“. */
export function ChatGptWelcome() {
  const t = useT();
  const show = useOpenAiStore((s) => s.showWelcome);
  const dismiss = useOpenAiStore((s) => s.dismissWelcome);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30">
      <div role="dialog" aria-modal="true"
        className="w-full max-w-[380px] mx-4 rounded-xl border border-border-subtle bg-bg-card p-6 shadow-lg">
        <h2 className="text-base font-semibold text-text-primary">{t('chatgpt.welcomeTitle')}</h2>
        <p className="mt-2 text-sm text-text-muted leading-relaxed">{t('chatgpt.welcomeDesc')}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={() => openUrl(MANAGE_USAGE_URL)}
            className="h-8 px-3 rounded-lg text-xs text-text-primary border border-border hover:bg-bg-secondary cursor-pointer">
            {t('chatgpt.manageUsage')}
          </button>
          <button onClick={dismiss}
            className="h-8 px-3 rounded-lg text-xs font-medium text-white send-button cursor-pointer">
            {t('chatgpt.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}

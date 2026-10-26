import { useEffect, type ReactNode } from 'react';
import { GoogleLogo } from '@phosphor-icons/react';
import { useAccountStore } from '../../stores/accountStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { accessState, daysLeft } from '../../lib/onboarding';
import { useT } from '../../lib/i18n';

const REFRESH_MS = 30 * 60 * 1000;

/** Načte stav účtu po startu, při návratu do okna (třeba z platby) a jednou za půl hodiny. */
export function useAccountRefresh() {
  const setupCompleted = useSettingsStore((s) => s.setupCompleted);
  const refresh = useAccountStore((s) => s.refresh);
  useEffect(() => {
    if (!setupCompleted) return;
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [setupCompleted, refresh]);
}

/**
 * Lišta nad chatem podle účtu Stavebák. Chat nikdy neblokuje: asistent funguje i bez účtu
 * a po zkušební době, placené jsou jen nástroje Stavebáku (server je sám odmítne a nabídne upgrade).
 * Podmínky Sign in with ChatGPT („No charge“) nedovolují dát plán ChatGPT za naši platbu.
 */
export function AccountBanner() {
  const t = useT();
  const setupCompleted = useSettingsStore((s) => s.setupCompleted);
  const { signedIn, status, busy, error, login, openBilling, refresh } = useAccountStore();
  const access = accessState(signedIn, status);
  if (!setupCompleted) return null;

  let text: string;
  let action: ReactNode = null;
  if (access === 'trial-ending' && status) {
    const left = daysLeft(status.trialEndsAt);
    text = left === 0 ? t('acc.trialEndsToday') : t('acc.trialEndsIn').replace('{date}', new Date(status.trialEndsAt).toLocaleDateString('cs-CZ'));
    action = <BannerButton primary onClick={() => { openBilling(); }} disabled={busy}>{t('settings.stavebakBuy')}</BannerButton>;
  } else if (access === 'expired' && status) {
    text = t('acc.expiredDesc').replace('{date}', new Date(status.trialEndsAt).toLocaleDateString('cs-CZ'));
    action = (
      <>
        <BannerButton primary onClick={() => { openBilling('monthly'); }} disabled={busy}>{t('acc.buyMonthly')}</BannerButton>
        <button onClick={() => { refresh(); }} className="text-text-tertiary hover:text-text-primary cursor-pointer">{t('acc.paidRefresh')}</button>
      </>
    );
  } else if (access === 'signed-out') {
    text = t('acc.signedOutDesc');
    action = (
      <BannerButton onClick={() => { login(); }} disabled={busy}>
        <GoogleLogo size={12} weight="bold" />
        {t('onb.stavebak.google')}
      </BannerButton>
    );
  } else {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-2 text-xs text-text-primary border-b border-border-subtle bg-bg-secondary">
      <span className="text-center">{text}</span>
      {action}
      {error && <span className="text-text-tertiary">{t('acc.error')}</span>}
    </div>
  );
}

function BannerButton({ primary, onClick, disabled, children }: { primary?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={primary
        ? 'rounded-lg px-2.5 py-1 font-medium text-white send-button disabled:opacity-40 cursor-pointer'
        : 'rounded-lg px-2.5 py-1 border border-border hover:bg-bg-tertiary inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer'}>
      {children}
    </button>
  );
}

import { useEffect } from 'react';
import { GoogleLogo } from '@phosphor-icons/react';
import { useAccountStore } from '../../stores/accountStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { accessState, daysLeft } from '../../lib/onboarding';
import { useT } from '../../lib/i18n';
import { AiAvatar } from '../shared/AiAvatar';

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

/** Lišta nad chatem posledních pár dní zkušební doby. */
export function TrialBanner() {
  const t = useT();
  const { signedIn, status, busy, openBilling } = useAccountStore();
  if (accessState(signedIn, status) !== 'trial-ending' || !status) return null;
  const left = daysLeft(status.trialEndsAt);
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 text-xs text-text-primary border-b border-border-subtle bg-bg-secondary">
      <span>{left === 0 ? t('acc.trialEndsToday') : t('acc.trialEndsIn').replace('{date}', new Date(status.trialEndsAt).toLocaleDateString('cs-CZ'))}</span>
      <button onClick={() => { openBilling(); }} disabled={busy}
        className="rounded-lg px-2.5 py-1 font-medium text-white send-button disabled:opacity-40 cursor-pointer">
        {t('settings.stavebakBuy')}
      </button>
    </div>
  );
}

/** Překryv místo chatu, když bez účtu nebo po zkušební době nejde pracovat. */
export function AccountGate() {
  const t = useT();
  const setupCompleted = useSettingsStore((s) => s.setupCompleted);
  const { signedIn, status, busy, error, login, openBilling, refresh } = useAccountStore();
  const access = accessState(signedIn, status);
  if (!setupCompleted || (access !== 'expired' && access !== 'signed-out')) return null;

  const expired = access === 'expired';
  const ended = status ? new Date(status.trialEndsAt).toLocaleDateString('cs-CZ') : '';
  return (
    <div className="fixed inset-0 z-90 flex items-center justify-center bg-bg-chat">
      <div className="w-full max-w-[400px] px-6 select-none text-center">
        <div className="flex justify-center mb-6"><AiAvatar size="w-12 h-12" rounded="rounded-xl" /></div>
        <h1 className="text-xl font-semibold text-text-primary">
          {expired ? t('acc.expiredTitle') : t('acc.signedOutTitle')}
        </h1>
        <p className="text-sm text-text-muted mt-1.5 mb-6 leading-relaxed">
          {expired ? t('acc.expiredDesc').replace('{date}', ended) : t('acc.signedOutDesc')}
        </p>
        {expired ? (
          <div className="space-y-2">
            <button onClick={() => { openBilling('monthly'); }} disabled={busy}
              className="w-full h-9 rounded-lg text-sm font-medium text-white send-button disabled:opacity-40 cursor-pointer">
              {t('acc.buyMonthly')}
            </button>
            <button onClick={() => { openBilling('yearly'); }} disabled={busy}
              className="w-full h-9 rounded-lg text-sm text-text-primary border border-border hover:bg-bg-secondary cursor-pointer disabled:opacity-40">
              {t('acc.buyYearly')}
            </button>
            <button onClick={() => { refresh(); }}
              className="block mx-auto pt-2 text-xs text-text-tertiary hover:text-text-primary">
              {t('acc.paidRefresh')}
            </button>
          </div>
        ) : (
          <button onClick={() => { login(); }} disabled={busy}
            className="w-full h-9 rounded-lg text-sm text-text-primary border border-border hover:bg-bg-secondary flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40">
            <GoogleLogo size={14} weight="bold" />
            {t('onb.stavebak.google')}
          </button>
        )}
        {error && <p className="pt-3 text-xs text-text-tertiary">{t('acc.error')}</p>}
      </div>
    </div>
  );
}

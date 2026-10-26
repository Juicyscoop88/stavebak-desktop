/**
 * Logika onboardingu a přístupu (spec 098 v repu serveru), bez UI, aby šla testovat i projít agentem.
 * Povinný je jen asistent (Claude, platí se Anthropicu). Účet Stavebák (30 dní zdarma, pak Pro) odemyká
 * nástroje Stavebáku a dá se přeskočit: chat nesmí být za naší platbou (podmínky Sign in with ChatGPT,
 * „No charge“), placené jsou jen nástroje, které bez účtu odmítne server.
 */

export type OnboardingStep = 'checking' | 'welcome' | 'claude' | 'stavebak' | 'done';

export interface OnboardingFacts {
  claudeOk: boolean;
  stavebakOk: boolean;
}

/** Kam po startu: oba účty v pořádku → rovnou do aplikace (null), jinak úvod (účet Stavebák se tam nabídne). */
export function startStep(f: OnboardingFacts): OnboardingStep | null {
  return f.claudeOk && f.stavebakOk ? null : 'welcome';
}

/** Další krok po úvodu nebo po dokončení kroku. Krok 'stavebak' jde přeskočit rovnou na 'done'. */
export function nextStep(f: OnboardingFacts): OnboardingStep {
  if (!f.claudeOk) return 'claude';
  if (!f.stavebakOk) return 'stavebak';
  return 'done';
}

export type Plan = 'trial' | 'free' | 'pro';

/** Co aplikace ukáže nad chatem podle účtu Stavebák. */
export type Access =
  | 'unknown'      // ještě nenačteno nebo server nedostupný: nic neblokovat
  | 'signed-out'   // bez účtu: lišta s nabídkou přihlášení, chat běží
  | 'trial'        // zkušební měsíc, víc než REMINDER_DAYS dní
  | 'trial-ending' // posledních REMINDER_DAYS dní: lišta s Koupit Pro
  | 'expired'      // zkušební měsíc skončil bez platby: lišta s platbou, chat běží bez nástrojů
  | 'pro';

export const REMINDER_DAYS = 5;

export function daysLeft(trialEndsAt: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / 86_400_000));
}

export function accessState(
  signedIn: boolean | null,
  status: { plan: Plan; trialEndsAt: string } | null,
  now = new Date(),
): Access {
  if (signedIn === false) return 'signed-out';
  if (!signedIn || !status) return 'unknown';
  if (status.plan === 'pro') return 'pro';
  if (status.plan === 'free') return 'expired';
  return daysLeft(status.trialEndsAt, now) <= REMINDER_DAYS ? 'trial-ending' : 'trial';
}

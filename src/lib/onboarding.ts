/**
 * Logika onboardingu a přístupu (spec 098 v repu serveru), bez UI, aby šla testovat i projít agentem.
 * Stavebák potřebuje dvě věci: Claude (AI, platí se Anthropicu) a účet Stavebák (30 dní zdarma, pak Pro).
 * Bez účtu Stavebák nefunguje žádný nástroj, proto se krok nedá přeskočit.
 */

export type OnboardingStep = 'checking' | 'welcome' | 'claude' | 'stavebak' | 'done';

export interface OnboardingFacts {
  claudeOk: boolean;
  stavebakOk: boolean;
}

/** Kam po startu: oba účty v pořádku → rovnou do aplikace (null), jinak úvod. */
export function startStep(f: OnboardingFacts): OnboardingStep | null {
  return f.claudeOk && f.stavebakOk ? null : 'welcome';
}

/** Další krok po úvodu nebo po dokončení kroku. */
export function nextStep(f: OnboardingFacts): OnboardingStep {
  if (!f.claudeOk) return 'claude';
  if (!f.stavebakOk) return 'stavebak';
  return 'done';
}

export type Plan = 'trial' | 'free' | 'pro';

/** Co aplikace ukáže nad chatem podle účtu Stavebák. */
export type Access =
  | 'unknown'      // ještě nenačteno nebo server nedostupný: nic neblokovat
  | 'signed-out'   // po onboardingu odhlášeno: výzva k přihlášení
  | 'trial'        // zkušební měsíc, víc než REMINDER_DAYS dní
  | 'trial-ending' // posledních REMINDER_DAYS dní: lišta s Koupit Pro
  | 'expired'      // zkušební měsíc skončil bez platby: obrazovka s platbou místo chatu
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

/**
 * Logika onboardingu a přístupu (spec 098 v repu serveru), bez UI, aby šla testovat i projít agentem.
 * Povinný je jen asistent: Claude (platí se Anthropicu) nebo ChatGPT (platí se OpenAI). Účet Stavebák (30 dní zdarma, pak Pro) odemyká
 * nástroje Stavebáku a dá se přeskočit: chat nesmí být za naší platbou (podmínky Sign in with ChatGPT,
 * „No charge“), placené jsou jen nástroje, které bez účtu odmítne server.
 */

export type OnboardingStep = 'checking' | 'welcome' | 'assistant' | 'claude' | 'chatgpt' | 'stavebak' | 'done';

/** Asistent, se kterým projektant pracuje: Claude (Claude Code) nebo ChatGPT (Codex). */
export type Assistant = 'claude' | 'codex';

export interface OnboardingFacts {
  /** Vybraný asistent je připravený: nainstalovaný a přihlášený */
  assistantOk: boolean;
  stavebakOk: boolean;
}

/** Kam po startu: asistent i účet v pořádku → rovnou do aplikace (null), jinak úvod. */
export function startStep(f: OnboardingFacts): OnboardingStep | null {
  return f.assistantOk && f.stavebakOk ? null : 'welcome';
}

/** Po úvodu vždy volba asistenta: Claude, nebo ChatGPT. */
export function afterWelcome(): OnboardingStep {
  return 'assistant';
}

/** Po volbě asistenta: přihlásit ho, pokud ještě není připravený, jinak dál. */
export function afterAssistant(chosen: Assistant, f: OnboardingFacts): OnboardingStep {
  if (!f.assistantOk) return chosen === 'claude' ? 'claude' : 'chatgpt';
  return afterSignIn(f);
}

/** Po přihlášení asistenta. Krok 'stavebak' jde přeskočit rovnou na 'done'. */
export function afterSignIn(f: Pick<OnboardingFacts, 'stavebakOk'>): OnboardingStep {
  return f.stavebakOk ? 'done' : 'stavebak';
}

/** 'beta': placení je na serveru vypnuté, každý účet má všechno zdarma. */
export type Plan = 'beta' | 'trial' | 'free' | 'pro';

/** Co aplikace ukáže nad chatem podle účtu Stavebák. */
export type Access =
  | 'unknown'      // ještě nenačteno nebo server nedostupný: nic neblokovat
  | 'signed-out'   // bez účtu: lišta s nabídkou přihlášení, chat běží
  | 'trial'        // zkušební měsíc, víc než REMINDER_DAYS dní
  | 'trial-ending' // posledních REMINDER_DAYS dní: lišta s Koupit Pro
  | 'expired'      // zkušební měsíc skončil bez platby: lišta s platbou, chat běží bez nástrojů
  | 'pro'
  | 'beta';        // beta zdarma: žádná lišta

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
  if (status.plan === 'beta') return 'beta';
  if (status.plan === 'pro') return 'pro';
  if (status.plan === 'free') return 'expired';
  return daysLeft(status.trialEndsAt, now) <= REMINDER_DAYS ? 'trial-ending' : 'trial';
}

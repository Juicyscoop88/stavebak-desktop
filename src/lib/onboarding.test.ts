import { describe, it, expect } from 'vitest';
import { startStep, nextStep, accessState, daysLeft } from './onboarding';

describe('onboarding', () => {
  it('oba účty v pořádku: rovnou do aplikace', () => {
    expect(startStep({ claudeOk: true, stavebakOk: true })).toBeNull();
  });

  it('chybí cokoli: úvod, pak Claude, pak Stavebák, pak hotovo', () => {
    expect(startStep({ claudeOk: true, stavebakOk: false })).toBe('welcome');
    expect(nextStep({ claudeOk: false, stavebakOk: false })).toBe('claude');
    expect(nextStep({ claudeOk: true, stavebakOk: false })).toBe('stavebak');
    expect(nextStep({ claudeOk: true, stavebakOk: true })).toBe('done');
  });
});

describe('přístup podle účtu', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const trial = (days: number) => ({ plan: 'trial' as const, trialEndsAt: new Date(now.getTime() + days * 86_400_000).toISOString() });

  it('nenačteno nebo bez spojení nic neblokuje', () => {
    expect(accessState(null, null, now)).toBe('unknown');
    expect(accessState(true, null, now)).toBe('unknown');
  });

  it('odhlášeno', () => {
    expect(accessState(false, null, now)).toBe('signed-out');
  });

  it('zkušební měsíc, posledních 5 dní připomínka', () => {
    expect(accessState(true, trial(20), now)).toBe('trial');
    expect(accessState(true, trial(5), now)).toBe('trial-ending');
    expect(accessState(true, trial(0.5), now)).toBe('trial-ending');
  });

  it('po zkušební době bez platby a Pro', () => {
    expect(accessState(true, { plan: 'free', trialEndsAt: now.toISOString() }, now)).toBe('expired');
    expect(accessState(true, { plan: 'pro', trialEndsAt: now.toISOString() }, now)).toBe('pro');
  });

  it('dny se zaokrouhlují nahoru a nejdou pod nulu', () => {
    expect(daysLeft(trial(2.2).trialEndsAt, now)).toBe(3);
    expect(daysLeft(trial(-1).trialEndsAt, now)).toBe(0);
  });
});

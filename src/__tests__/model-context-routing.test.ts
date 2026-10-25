import { describe, it, expect, vi } from 'vitest';
import { is1MModel, getAutoCompactThreshold, toCliModel } from '../lib/models';

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
    configurable: true,
  });
});

describe('model context routing', () => {
  it('treats only explicit 1M variants as 1M models', () => {
    // Standard variants are 200K; 1M is opt-in via -1m / [1m].
    expect(is1MModel('claude-fable-5')).toBe(false);
    expect(is1MModel('claude-fable-5-1m')).toBe(true);
    expect(is1MModel('claude-fable-5[1m]')).toBe(true);
    expect(is1MModel('claude-opus-4-8')).toBe(false);
    expect(is1MModel('claude-opus-4-8-1m')).toBe(true);
    expect(is1MModel('claude-opus-4-8[1m]')).toBe(true);
    expect(is1MModel('claude-opus-4-6-1m')).toBe(true);
    expect(is1MModel('claude-opus-4-6')).toBe(false);
    expect(getAutoCompactThreshold('claude-fable-5')).toBe(160_000);
    expect(getAutoCompactThreshold('claude-fable-5-1m')).toBe(800_000);
    expect(getAutoCompactThreshold('claude-opus-4-8')).toBe(160_000);
    expect(getAutoCompactThreshold('claude-opus-4-8-1m')).toBe(800_000);
    expect(getAutoCompactThreshold('claude-opus-4-6-1m')).toBe(800_000);
    expect(getAutoCompactThreshold('claude-opus-4-6')).toBe(160_000);
  });

  it('translates -1m UI ids to the CLI [1m] model name', () => {
    expect(toCliModel('claude-fable-5-1m')).toBe('claude-fable-5[1m]');
    expect(toCliModel('claude-opus-4-8-1m')).toBe('claude-opus-4-8[1m]');
    expect(toCliModel('claude-opus-4-6-1m')).toBe('claude-opus-4-6[1m]');
    // Standard variant passes through unchanged.
    expect(toCliModel('claude-fable-5')).toBe('claude-fable-5');
    expect(toCliModel('claude-opus-4-8')).toBe('claude-opus-4-8');
  });
});

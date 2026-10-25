/**
 * Tests for spawnConfigHash — the stable fingerprint used to detect config
 * drift between a CLI process's spawn time and subsequent user submissions.
 *
 * Phase 2 §2.1 + appendix E.2 H2:
 * - hash MUST react to: selectedModel, thinkingLevel
 * - hash MUST NOT react to sessionMode — mode changes go through the
 *   runtime `set_permission_mode` control protocol, not kill + respawn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnConfigHash } from '../lib/models';
import { useSettingsStore } from '../stores/settingsStore';

beforeEach(() => {
  // Reset settings relevant to the hash.
  useSettingsStore.setState({
    selectedModel: 'claude-sonnet-4-6',
    thinkingLevel: 'medium',
    sessionMode: 'code',
  });
});

describe('spawnConfigHash', () => {
  it('returns a stable string under unchanged config', () => {
    const a = spawnConfigHash();
    const b = spawnConfigHash();
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('changes when selectedModel changes', () => {
    const before = spawnConfigHash();
    useSettingsStore.setState({ selectedModel: 'claude-opus-4-8' });
    const after = spawnConfigHash();
    expect(after).not.toBe(before);
  });

  it('changes when thinkingLevel changes', () => {
    const before = spawnConfigHash();
    useSettingsStore.setState({ thinkingLevel: 'max' });
    const after = spawnConfigHash();
    expect(after).not.toBe(before);
  });

  it('DOES NOT change when sessionMode changes (E.2 H2)', () => {
    const before = spawnConfigHash();
    useSettingsStore.setState({ sessionMode: 'plan' });
    const mid = spawnConfigHash();
    useSettingsStore.setState({ sessionMode: 'ask' });
    const after = spawnConfigHash();
    expect(mid).toBe(before);
    expect(after).toBe(before);
  });
});

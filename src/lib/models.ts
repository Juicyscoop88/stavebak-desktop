import { useSettingsStore, type ModelId } from '../stores/settingsStore';

/**
 * Check whether the given model ID (or the currently selected model) uses
 * the 1M context window variant.
 *
 * 1M variants advertise themselves either via a `-1m` suffix (UI ids such as
 * `claude-opus-4-8-1m`) or a `[1m]` marker (CLI ids such as
 * `claude-opus-4-8[1m]`). Standard variants (e.g. `claude-opus-4-8`) are 200K.
 */
export function is1MModel(modelId?: string): boolean {
  const id = modelId ?? useSettingsStore.getState().selectedModel;
  const lower = id.toLowerCase();
  return lower.endsWith('-1m')
    || lower.includes('[1m]');
}

/**
 * Return the auto-compact token threshold for the given model.
 * 80% of context window: 160K for 200K models, 800K for 1M models.
 */
export function getAutoCompactThreshold(modelId?: string): number {
  return is1MModel(modelId) ? 800_000 : 160_000;
}

/**
 * Map internal model IDs to CLI-expected format.
 *
 * Standard Opus variants (e.g. `claude-opus-4-8`) pass through unchanged. The
 * `-1m` UI ids are translated to the CLI's `[1m]` model name so the CLI requests
 * the larger context window.
 */
const CLI_MODEL_MAP: Partial<Record<ModelId, string>> = {
  'claude-fable-5-1m': 'claude-fable-5[1m]',
  'claude-opus-4-8-1m': 'claude-opus-4-8[1m]',
  'claude-opus-4-6-1m': 'claude-opus-4-6[1m]',
};

export function toCliModel(selectedModel: string): string {
  return CLI_MODEL_MAP[selectedModel as ModelId] ?? selectedModel;
}

/**
 * Stable hash of the spawn-time CLI configuration.
 *
 * Captures the dimensions whose change requires kill + respawn of the CLI
 * process: selected model and thinking level.
 *
 * Deliberately EXCLUDES `sessionMode` — mode switches go through the runtime
 * `set_permission_mode` SDK control protocol (see settingsStore.ts)
 * and must NOT trigger a respawn. See v3 plan appendix E.2 H2.
 */
export function spawnConfigHash(): string {
  const settings = useSettingsStore.getState();
  return [settings.selectedModel, settings.thinkingLevel].join('|');
}

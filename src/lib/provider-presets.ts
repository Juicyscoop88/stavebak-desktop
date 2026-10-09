export interface PresetProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: 'anthropic' | 'openai';
  extra_env: Record<string, string>;
  /** URL to the provider's API key management page */
  keyUrl?: string;
  /** Provider-level thinking support: full = native, ignored = param silently dropped, unknown = untested */
  thinkingSupport?: 'full' | 'ignored' | 'unknown';
  /** Default model for all tiers (non-Claude providers) */
  defaultModel?: string;
  /** Per-tier default models (takes precedence over defaultModel) */
  defaultModels?: {
    opus?: string;
    sonnet?: string;
    haiku?: string;
  };
}

export const PROVIDER_PRESETS: PresetProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://console.anthropic.com/account/keys',
    thinkingSupport: 'full',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://openrouter.ai/settings/keys',
    thinkingSupport: 'full',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai',
    extra_env: {},
    keyUrl: 'https://platform.openai.com/api-keys',
    thinkingSupport: 'ignored',
    defaultModels: {
      opus: 'gpt-4o',
      sonnet: 'gpt-4o-mini',
      haiku: 'gpt-4o-mini',
    },
  },
];

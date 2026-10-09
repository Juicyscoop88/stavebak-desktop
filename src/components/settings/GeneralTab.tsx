import { Check } from '@phosphor-icons/react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';
import { useT } from '../../lib/i18n';
import { getModelDisplayOptions, getSelectedModelOptionId } from '../../lib/api-provider';
import type { Locale } from '../../stores/settingsStore';

const LANGUAGE_OPTIONS: { id: Locale; label: string }[] = [
  { id: 'cs', label: 'CZ' },
  { id: 'en', label: 'EN' },
  { id: 'sk', label: 'SK' },
  { id: 'de', label: 'DE' },
];

export function GeneralTab() {
  const t = useT();
  const activeProvider = useProviderStore((s) => {
    if (!s.activeProviderId) return null;
    return s.providers.find((p) => p.id === s.activeProviderId) ?? null;
  });
  const theme = useSettingsStore((s) => s.theme);
  const locale = useSettingsStore((s) => s.locale);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const modelOptions = getModelDisplayOptions(activeProvider);
  const selectedModelOptionId = getSelectedModelOptionId(selectedModel, modelOptions);

  return (
    <div className="space-y-6">
      {/* Settings row */}
      <div className="flex items-start gap-8 flex-wrap">
        {/* Appearance */}
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-2">{t('settings.appearance')}</h3>
          <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
            {(['light', 'dark', 'system'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTheme(m)}
                className={`py-1.5 px-3 text-sm font-medium transition-smooth
                  border-r border-border-subtle last:border-r-0 whitespace-nowrap
                  ${theme === m
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-bg-secondary'
                  }`}
              >
                {t(`settings.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-2">{t('settings.language')}</h3>
          <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
            {LANGUAGE_OPTIONS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLocale(l.id)}
                className={`py-1.5 px-3 text-sm font-medium transition-smooth
                  border-r border-border-subtle last:border-r-0
                  ${locale === l.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-bg-secondary'
                  }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Default Model */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">{t('settings.defaultModel')}</h3>
        <div className="flex flex-wrap gap-2">
          {modelOptions.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2
                rounded-lg text-sm font-medium transition-smooth
                ${selectedModelOptionId === model.id
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'text-text-muted hover:bg-bg-secondary border border-border-subtle'
                }`}
            >
              {selectedModelOptionId === model.id && (
                <Check size={12} weight="light" />
              )}
              {model.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { Check, ArrowSquareOut, PencilSimple, Trash } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import type { ApiProvider } from '../../stores/providerStore';

export type CardTestStatus = 'idle' | 'testing' | 'success' | 'auth_error' | 'failed';

interface ProviderCardProps {
  provider: ApiProvider;
  isActive: boolean;
  isEditing: boolean;
  testStatus: CardTestStatus;
  testTimeMs?: number;
  onActivate: () => void;
  onToggleEdit: () => void;
  onRequestDelete: () => void;
  onExport: () => void;
  onTest: () => void;
}

export function ProviderCard({
  provider,
  isActive,
  isEditing,
  testStatus,
  testTimeMs,
  onActivate,
  onToggleEdit,
  onRequestDelete,
  onExport,
  onTest,
}: ProviderCardProps) {
  const t = useT();

  let hostname = '';
  if (provider.baseUrl) {
    try {
      hostname = new URL(provider.baseUrl).hostname;
    } catch { /* ignore */ }
  }

  const formatLabel = provider.apiFormat === 'anthropic'
    ? t('provider.formatAnthropicShort')
    : t('provider.formatOpenaiShort');

  return (
    <div
      onClick={onActivate}
      {...(import.meta.env.DEV && { 'data-testid': `provider-card-${provider.id}` })}
      className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-smooth cursor-pointer
        ${isEditing
          ? 'bg-bg-secondary border border-accent/30'
          : isActive
            ? 'bg-accent/5 border border-accent/20'
            : 'border border-border-subtle hover:bg-bg-secondary'
        }`}
    >
      {/* Active indicator dot */}
      <span className={`shrink-0 block w-2.5 h-2.5 rounded-full transition-smooth
        ${isActive
          ? 'bg-accent shadow-[0_0_4px_rgba(var(--accent-rgb,99,102,241),0.4)]'
          : 'border-[1.5px] border-text-tertiary'
        }`}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">
          {provider.name || t('provider.unnamed')}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {hostname && (
            <span className="text-xs text-text-tertiary truncate">
              {hostname}
            </span>
          )}
          {hostname && (
            <span className="text-xs text-text-tertiary">·</span>
          )}
          <span className="text-xs text-text-tertiary whitespace-nowrap">
            {formatLabel}
          </span>
        </div>
      </div>

      {/* Test button — same style as form test button */}
      <button
        onClick={(e) => { e.stopPropagation(); onTest(); }}
        disabled={testStatus === 'testing'}
        className={`shrink-0 px-2 py-1 rounded-md text-xs font-medium transition-smooth
          border
          ${testStatus === 'success'
            ? 'bg-green-500/10 text-green-500 border-green-500/30'
            : testStatus === 'failed' || testStatus === 'auth_error'
              ? 'bg-red-500/10 text-red-500 border-red-500/30'
              : 'border-border-subtle text-text-tertiary hover:text-text-muted hover:bg-bg-secondary'
          }
          disabled:cursor-not-allowed`}
      >
        {testStatus === 'testing' ? (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 border-[1.5px] border-accent/30
              border-t-accent rounded-full animate-spin" />
            {t('provider.testing')}
          </span>
        ) : testStatus === 'success' ? (
          <span className="flex items-center gap-1">
            <Check size={9} weight="light" />
            {testTimeMs != null ? `${testTimeMs}ms` : t('provider.testSuccess')}
          </span>
        ) : testStatus === 'auth_error' ? (
          t('provider.testAuthError')
        ) : testStatus === 'failed' ? (
          t('provider.testFailed')
        ) : (
          t('provider.testConnection')
        )}
      </button>

      {/* Action buttons — hover to reveal */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
        {/* Export */}
        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          className="p-1.5 rounded text-text-tertiary hover:text-text-muted transition-smooth"
          title={t('provider.exportConfig')}
        >
          <ArrowSquareOut size={13} weight="light" />
        </button>
        {/* Edit */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleEdit(); }}
          className="p-1.5 rounded text-text-tertiary hover:text-text-muted transition-smooth"
          title={t('provider.editProvider')}
        >
          <PencilSimple size={13} weight="light" />
        </button>
        {/* Delete — trash icon, red */}
        <button
          onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
          className="p-1.5 rounded text-red-400/60 hover:text-red-400 transition-smooth"
          title={t('provider.deleteProvider')}
        >
          <Trash size={13} weight="light" />
        </button>
      </div>
    </div>
  );
}

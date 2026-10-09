import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, DownloadSimple } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import { PROVIDER_PRESETS, type PresetProvider } from '../../lib/provider-presets';
import type { ApiProvider } from '../../stores/providerStore';

interface AddProviderMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  providers: ApiProvider[];
  onAddFromPreset: (preset: PresetProvider) => void;
  onAddCustom: () => void;
  onImport: () => void;
}

export function AddProviderMenu({
  open,
  onClose,
  anchorRef,
  providers,
  onAddFromPreset,
  onAddCustom,
  onImport,
}: AddProviderMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect) return null;

  const menuHeight = 320; // approximate max height of the dropdown
  const spaceBelow = window.innerHeight - rect.bottom - 6;
  const openUpward = spaceBelow < menuHeight && rect.top > spaceBelow;

  const style: React.CSSProperties = {
    position: 'fixed',
    ...(openUpward
      ? { bottom: window.innerHeight - rect.top + 6 }
      : { top: rect.bottom + 6 }),
    left: rect.left,
    zIndex: 9999,
    maxHeight: `${Math.max(openUpward ? rect.top - 12 : spaceBelow, 200)}px`,
    overflowY: 'auto',
  };

  return createPortal(
    <div ref={menuRef} style={style}
      className="w-[300px] rounded-xl border border-border-subtle bg-bg-primary/95 backdrop-blur-xl shadow-lg p-3 space-y-2">
      {/* Preset grid */}
      <div>
        <span className="text-xs text-text-tertiary font-medium mb-1.5 block">
          {t('provider.fromPresetTitle')}
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDER_PRESETS.map((preset) => {
            const addedCount = providers.filter((p) => p.preset === preset.id).length;
            return (
              <button
                key={preset.id}
                onClick={() => {
                  onAddFromPreset(preset);
                  onClose();
                }}
                className="text-left px-2.5 py-2 rounded-lg text-sm transition-smooth
                  text-text-muted hover:bg-bg-secondary border border-transparent hover:border-border-subtle"
              >
                {preset.name}
                {addedCount > 0 && (
                  <span className="text-xs text-text-tertiary ml-1">
                    ×{addedCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border-subtle" />

      {/* Custom + Import */}
      <div className="space-y-0.5">
        <button
          onClick={() => { onAddCustom(); onClose(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm
            text-text-muted hover:bg-bg-secondary transition-smooth"
        >
          <Plus size={14} weight="light" />
          {t('provider.customConfig')}
        </button>
        <button
          onClick={() => { onImport(); onClose(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm
            text-text-muted hover:bg-bg-secondary transition-smooth"
        >
          <DownloadSimple size={14} weight="light" />
          {t('provider.importFile')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

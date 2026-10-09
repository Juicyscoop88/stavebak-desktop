import { useEffect, useCallback } from 'react';
import { create } from 'zustand';
import { X, ArrowSquareOut, SpinnerGap } from '@phosphor-icons/react';
import { bridge } from '../../lib/tauri-bridge';

/* ================================================================
   Lightbox store — global state for the image lightbox overlay
   ================================================================ */

interface LightboxState {
  isOpen: boolean;
  /** Data URL or file path to display */
  imageSrc: string | null;
  /** Original file path (for "open externally" action) */
  filePath: string | null;
  /** Optional alt text */
  alt: string;

  open: (src: string, filePath?: string, alt?: string) => void;
  /** Open by loading a file from disk via Rust base64 */
  openFile: (path: string, alt?: string) => void;
  close: () => void;
}

export const useLightboxStore = create<LightboxState>()((set) => ({
  isOpen: false,
  imageSrc: null,
  filePath: null,
  alt: '',

  open: (src, filePath, alt) =>
    set({ isOpen: true, imageSrc: src, filePath: filePath || null, alt: alt || '' }),

  openFile: async (path, alt) => {
    set({ isOpen: true, imageSrc: null, filePath: path, alt: alt || '' });
    try {
      const dataUrl = await bridge.readFileBase64(path);
      set({ imageSrc: dataUrl });
    } catch {
      set({ isOpen: false, imageSrc: null });
    }
  },

  close: () =>
    set({ isOpen: false, imageSrc: null, filePath: null, alt: '' }),
}));

/* ================================================================
   ImageLightbox component — fullscreen overlay
   ================================================================ */

export function ImageLightbox() {
  const isOpen = useLightboxStore((s) => s.isOpen);
  const imageSrc = useLightboxStore((s) => s.imageSrc);
  const filePath = useLightboxStore((s) => s.filePath);
  const alt = useLightboxStore((s) => s.alt);
  const close = useLightboxStore((s) => s.close);

  // ESC to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center
        bg-black/80 backdrop-blur-sm animate-fade-in cursor-zoom-out"
      onClick={close}
    >
      {/* Close button */}
      <button
        onClick={close}
        className="absolute top-4 right-4 p-2 rounded-full
          bg-white/10 hover:bg-white/20 text-white
          transition-smooth z-10"
      >
        <X size={20} weight="light" />
      </button>

      {/* Open externally button */}
      {filePath && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            bridge.openWithDefaultApp(filePath);
          }}
          className="absolute top-4 left-4 px-3 py-1.5 rounded-lg
            bg-white/10 hover:bg-white/20 text-white text-xs font-medium
            transition-smooth z-10"
        >
          <ArrowSquareOut size={12} weight="light" className="inline mr-1.5" />
          Open
        </button>
      )}

      {/* Image */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={alt}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg
            shadow-2xl cursor-default"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        />
      ) : (
        /* Loading spinner */
        <div className="flex items-center justify-center">
          <SpinnerGap size={32} weight="light" className="animate-spin text-white" />
        </div>
      )}

      {/* Alt text caption */}
      {alt && imageSrc && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2
          px-4 py-2 rounded-lg bg-black/60 text-white/80 text-xs
          max-w-[80vw] truncate">
          {alt}
        </div>
      )}
    </div>
  );
}

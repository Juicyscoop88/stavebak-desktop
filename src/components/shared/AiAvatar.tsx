import { useSettingsStore } from '../../stores/settingsStore';

/** Default Stavebak logo SVG — uses brand/logo.svg paths, scaled by parent container */
function DefaultIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 80 80" fill="none">
      <path d="m60.49 28.48v-11.87h-7.3v7.73l-10.54-6-30.64 14.07v6.61l30.6-14.06 25.68 14.44v-6.52l-7.8-4.4z" fill="currentColor" />
      <path d="m17.57 38.99v22.76h6.89v-25.89c-2.39 0.98-4.73 2.23-6.89 3.13z" fill="currentColor" />
      <path d="m56.05 35.59v26.16h6.82v-22.56l-6.82-3.6z" fill="currentColor" />
      <path d="m45.56 44.09-9.16-2.07c-1.3-0.29-1.85-0.98-1.85-1.85 0-0.88 0.87-1.48 1.86-1.48h14.46v-6.66h-14.04c-6.3 0-9.51 3.74-9.51 8.33 0 4.8 3.11 7.43 7.92 8.48l8.21 1.77c1.52 0.33 2.15 0.97 2.15 1.94 0 1.13-0.93 1.86-2.13 1.86l-16.25 0.05v7.29l14.14-0.05c7.51 0 11.65-4.08 11.65-9.43 0-4.44-2.84-7.18-7.45-8.18z" fill="currentColor" />
    </svg>
  );
}

interface AiAvatarProps {
  /** Tailwind size class for the container, e.g. "w-8 h-8", "w-16 h-16", "w-20 h-20" */
  size: string;
  /** Tailwind border-radius class, e.g. "rounded-[10px]", "rounded-2xl", "rounded-3xl" */
  rounded?: string;
  /** Extra classes for the container */
  className?: string;
}

/**
 * AI avatar that shows a user-customized image if set, otherwise the default </> icon.
 * The custom image is stored as a data URL in settingsStore.aiAvatarUrl.
 */
export function AiAvatar({ size, rounded = 'rounded-[10px]', className = '' }: AiAvatarProps) {
  const avatarUrl = useSettingsStore((s) => s.aiAvatarUrl);

  // When custom image is set, use transparent bg to avoid black border bleed on rounded corners
  const bgClass = avatarUrl ? 'bg-transparent' : '';

  return (
    <div className={`${size} ${rounded} ${bgClass}
      flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="AI" className="w-full h-full object-cover" />
      ) : (
        <DefaultIcon />
      )}
    </div>
  );
}

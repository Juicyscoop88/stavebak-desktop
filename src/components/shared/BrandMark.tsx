/**
 * Značka Stavebáku (okno ze čtyř tvarů) bez pozadí, barva podle `currentColor`.
 * Kopie `brand/mark.svg`, jediný zdroj loga v UI. Ikona aplikace je `brand/icon.svg`.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="18 18 64 64" fill="currentColor" aria-hidden="true">
      <path d="M18 46H46V18Z" />
      <path d="M54 18V46H82Z" />
      <path d="M18 54H46V82H18Z" />
      <path d="M54 54H82V82H54Z" />
    </svg>
  );
}

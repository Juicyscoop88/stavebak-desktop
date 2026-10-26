/** Jak se soubor čte pro náhled. Jediný seznam pro první otevření i pro obnovu po změně souboru. */
export type PreviewKind = 'binary' | 'dwg' | 'text';

const BINARY_PREVIEW = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
  'pdf', 'mp4', 'webm', 'mov', 'avi',
  'mp3', 'wav', 'ogg', 'aac', 'm4a',
  'dxf', // může mít desítky MB; prohlížeč si data URL načte sám
]);

export function previewKind(path: string): PreviewKind {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  // DWG převádí na DXF až DwgPreview, tady se nic nečte
  if (ext === 'dwg') return 'dwg';
  return BINARY_PREVIEW.has(ext) ? 'binary' : 'text';
}

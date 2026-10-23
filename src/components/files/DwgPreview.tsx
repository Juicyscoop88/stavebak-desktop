import { lazy, Suspense, useEffect, useState } from 'react';
import { panelRegistry } from '../../lib/panel-registry';

const DxfPreview = lazy(() => import('./DxfPreview'));

/** DWG has no open viewer we can ship: a plugin converts it to DXF, then the DXF viewer shows it. */
export default function DwgPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    const converter = panelRegistry.getFileConverter('dwg');
    if (!converter) {
      setError('Náhled DWG zatím není k dispozici. Uložte výkres v CADu jako DXF.');
      return;
    }
    let cancelled = false;
    converter.convert(path).then(
      (dxf) => { if (!cancelled) setUrl(dxf); },
      (e) => { if (!cancelled) setError(String(e)); },
    );
    return () => { cancelled = true; };
  }, [path]);

  if (url) return <Suspense fallback={null}><DxfPreview url={url} /></Suspense>;
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
      {error ?? 'Převádím výkres…'}
    </div>
  );
}

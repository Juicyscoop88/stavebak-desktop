import { Cube } from '@phosphor-icons/react';

export default function CADPreviewPanel() {
  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">3D Náhled</h3>
      <p className="text-xs text-text-muted">
        IFC/DXF prohlížeč bude k dispozici po integraci web-ifc a Three.js.
      </p>
      <div className="aspect-video bg-bg-secondary rounded-xl flex items-center justify-center">
        <Cube size={48} weight="light" className="text-text-tertiary" />
      </div>
    </div>
  )
}

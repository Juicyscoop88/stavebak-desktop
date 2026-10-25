import { UploadSimple } from '@phosphor-icons/react';

export default function DocumentsPanel() {
  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">Dokumenty</h3>
      <p className="text-xs text-text-muted">
        Upload a nahrávání stavebních dokumentů. Připojte se k MCP serveru stavebak pro validaci extrakce.
      </p>
      <div className="border-2 border-dashed border-border-subtle rounded-xl p-8
        flex flex-col items-center justify-center text-text-tertiary">
        <UploadSimple size={32} weight="light" className="mb-2" />
        <span className="text-xs">Přetáhněte soubory sem</span>
      </div>
    </div>
  )
}

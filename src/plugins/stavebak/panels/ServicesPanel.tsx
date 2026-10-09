export default function ServicesPanel() {
  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">Služby</h3>
      <p className="text-xs text-text-muted">
        Seznam dostupných stavebních služeb z MCP serveru stavebak.
      </p>
      <div className="text-xs text-text-tertiary italic">
        Připojte MCP server pro načtení služeb.
      </div>
    </div>
  )
}

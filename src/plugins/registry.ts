import { panelRegistry } from '../lib/panel-registry'
import type { PluginManifest } from './types'
import { useMcpStore } from '../stores/mcpStore'

const pluginModules = import.meta.glob('./*/manifest.ts', { eager: true }) as Record<
  string,
  { manifest: PluginManifest }
>

/** A plugin is active while its MCP server is configured (~/.claude.json). */
function sync() {
  const servers = useMcpStore.getState().servers
  for (const { manifest } of Object.values(pluginModules)) {
    const hasServer = servers.some(s => s.name === manifest.mcpServer)
    const registered = panelRegistry.isRegistered(manifest.id)
    if (hasServer && !registered) panelRegistry.register(manifest.id, manifest.panels, manifest.fileRenderers, manifest.fileConverters)
    if (!hasServer && registered) panelRegistry.unregister(manifest.id)
  }
}

export function registerPlugins() {
  useMcpStore.subscribe((state, prev) => { if (state.servers !== prev.servers) sync() })
  useMcpStore.getState().fetchServers().catch(() => {})
  sync()
}

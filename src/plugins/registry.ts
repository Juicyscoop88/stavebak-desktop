import { panelRegistry } from '../lib/panel-registry'
import type { PluginManifest } from './types'
import { useMcpStore } from '../stores/mcpStore'

const pluginModules = import.meta.glob('./*/manifest.ts', { eager: true }) as Record<
  string,
  { manifest: PluginManifest }
>

export function registerPlugins() {
  const servers = useMcpStore.getState().servers

  for (const [, mod] of Object.entries(pluginModules)) {
    const manifest = mod.manifest
    const hasServer = servers.some(s => s.name === manifest.mcpServer)

    if (!hasServer) continue

    panelRegistry.register(manifest.id, manifest.panels)
  }
}

import type { PanelDefinition } from '../lib/panel-registry'

export interface PluginManifest {
  id: string
  name: string
  mcpServer: string
  panels: PanelDefinition[]
}

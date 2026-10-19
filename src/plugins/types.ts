import type { PanelDefinition, FileRendererDefinition, FileConverterDefinition } from '../lib/panel-registry'

export interface PluginManifest {
  id: string
  name: string
  mcpServer: string
  panels: PanelDefinition[]
  fileRenderers?: FileRendererDefinition[]
  fileConverters?: FileConverterDefinition[]
}

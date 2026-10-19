import type { ComponentType } from 'react'

/** left/right: switchable side panels. sidebar-top: always shown above the project's file tree. */
export type PanelSlotId = 'left' | 'right' | 'sidebar-top'

export interface PanelDefinition {
  id: string
  label: string
  icon?: string
  slot: PanelSlotId
  priority: number
  component: () => Promise<{ default: ComponentType }>
  requiredTools?: string[]
}

export type PanelEntry = PanelDefinition & { pluginId: string }

/** Custom preview for a file name (e.g. a plugin's project file) instead of the generic viewer. */
export interface FileRendererDefinition {
  fileName: string
  component: () => Promise<{ default: ComponentType }>
}

type FileRendererEntry = FileRendererDefinition & { pluginId: string }

class PanelRegistry {
  private panels = new Map<string, PanelEntry>()
  private fileRenderers = new Map<string, FileRendererEntry>()
  private listeners = new Set<() => void>()

  register(pluginId: string, panels: PanelDefinition[], fileRenderers: FileRendererDefinition[] = []) {
    for (const panel of panels) {
      this.panels.set(panel.id, { ...panel, pluginId })
    }
    for (const r of fileRenderers) {
      this.fileRenderers.set(r.fileName, { ...r, pluginId })
    }
    this.notify()
  }

  unregister(pluginId: string) {
    for (const [id, entry] of this.panels) {
      if (entry.pluginId === pluginId) this.panels.delete(id)
    }
    for (const [name, entry] of this.fileRenderers) {
      if (entry.pluginId === pluginId) this.fileRenderers.delete(name)
    }
    this.notify()
  }

  isRegistered(pluginId: string): boolean {
    return [...this.panels.values(), ...this.fileRenderers.values()].some(e => e.pluginId === pluginId)
  }

  getFileRenderer(fileName: string): FileRendererEntry | undefined {
    return this.fileRenderers.get(fileName)
  }

  getPanelsForSlot(slot: PanelSlotId): PanelEntry[] {
    return [...this.panels.values()]
      .filter(p => p.slot === slot)
      .sort((a, b) => b.priority - a.priority)
  }

  getPanel(id: string): PanelEntry | undefined {
    return this.panels.get(id)
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    this.listeners.forEach(fn => fn())
  }
}

export const panelRegistry = new PanelRegistry()

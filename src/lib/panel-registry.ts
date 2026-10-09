import type { ComponentType } from 'react'

export interface PanelDefinition {
  id: string
  label: string
  icon?: string
  slot: 'left' | 'right'
  priority: number
  component: () => Promise<{ default: ComponentType }>
  requiredTools?: string[]
}

export type PanelEntry = PanelDefinition & { pluginId: string }

class PanelRegistry {
  private panels = new Map<string, PanelEntry>()
  private listeners = new Set<() => void>()

  register(pluginId: string, panels: PanelDefinition[]) {
    for (const panel of panels) {
      this.panels.set(panel.id, { ...panel, pluginId })
    }
    this.notify()
  }

  unregister(pluginId: string) {
    for (const [id, entry] of this.panels) {
      if (entry.pluginId === pluginId) this.panels.delete(id)
    }
    this.notify()
  }

  getPanelsForSlot(slot: 'left' | 'right'): PanelEntry[] {
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

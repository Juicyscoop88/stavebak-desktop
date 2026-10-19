import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { panelRegistry, type PanelSlotId } from '../../lib/panel-registry'

function useLazy(loader: (() => Promise<{ default: ComponentType }>) | undefined): ComponentType | null {
  const [Component, setComponent] = useState<ComponentType | null>(null)
  useEffect(() => {
    setComponent(null)
    if (!loader) return
    let cancelled = false
    loader().then((mod) => { if (!cancelled) setComponent(() => mod.default) })
    return () => { cancelled = true }
  }, [loader])
  return Component
}

const subscribe = (fn: () => void) => panelRegistry.subscribe(fn)

function LazyPanel({ loader }: { loader: () => Promise<{ default: ComponentType }> }) {
  const Component = useLazy(loader)
  return Component ? <Component /> : null
}

/** Every plugin panel registered for an always-visible slot, stacked by priority. */
export function PluginSlotStack({ slot }: { slot: PanelSlotId }) {
  // Registry returns a fresh array per call — key on ids so the snapshot is stable
  const ids = useSyncExternalStore(subscribe, () => panelRegistry.getPanelsForSlot(slot).map((p) => p.id).join('|'))
  const panels = ids ? ids.split('|').map((id) => panelRegistry.getPanel(id)!).filter(Boolean) : []
  return <>{panels.map((p) => <LazyPanel key={p.id} loader={p.component} />)}</>
}

/** Plugin-provided preview for a file name, or null to use the generic viewer. */
export function useFileRenderer(fileName: string): ComponentType | null {
  const loader = useSyncExternalStore(subscribe, () => panelRegistry.getFileRenderer(fileName)?.component)
  return useLazy(loader)
}

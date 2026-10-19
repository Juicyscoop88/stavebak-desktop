import { useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
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

function useSlotIds(slot: PanelSlotId): string[] {
  // Registry returns a fresh array per call — key on ids so the snapshot is stable
  const ids = useSyncExternalStore(subscribe, () => panelRegistry.getPanelsForSlot(slot).map((p) => p.id).join('|'))
  return ids ? ids.split('|') : []
}

/** Every plugin panel registered for an always-visible slot, stacked by priority; `fallback` when none. */
export function PluginSlotStack({ slot, fallback = null }: { slot: PanelSlotId; fallback?: ReactNode }) {
  const panels = useSlotIds(slot).map((id) => panelRegistry.getPanel(id)!).filter(Boolean)
  if (panels.length === 0) return <>{fallback}</>
  return <>{panels.map((p) => <LazyPanel key={p.id} loader={p.component} />)}</>
}

/** Plugin-provided preview for a file name, or null to use the generic viewer. */
export function useFileRenderer(fileName: string): ComponentType | null {
  const loader = useSyncExternalStore(subscribe, () => panelRegistry.getFileRenderer(fileName)?.component)
  return useLazy(loader)
}

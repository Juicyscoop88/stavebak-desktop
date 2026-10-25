import { useState, useEffect, type ComponentType } from 'react'
import { X } from '@phosphor-icons/react'
import { panelRegistry, type PanelEntry } from '../../lib/panel-registry'
import { PanelDropdown } from './PanelDropdown'

interface PanelSlotProps {
  slot: 'left' | 'right'
  activePanelId: string | null
  onPanelChange: (id: string | null) => void
  onClose?: () => void
  header?: React.ReactNode
  footer?: React.ReactNode
  hideDropdown?: boolean
  hideContent?: boolean
  emptyState?: React.ReactNode
}

export function PanelSlot({ slot, activePanelId, onPanelChange, onClose, header, footer, hideDropdown, hideContent, emptyState }: PanelSlotProps) {
  const [panels, setPanels] = useState<PanelEntry[]>(() => panelRegistry.getPanelsForSlot(slot))
  const [ActiveComponent, setActiveComponent] = useState<ComponentType | null>(null)

  useEffect(() => {
    return panelRegistry.subscribe(() => {
      setPanels(panelRegistry.getPanelsForSlot(slot))
    })
  }, [slot])

  // Auto-select highest priority panel when none is active
  useEffect(() => {
    if (!activePanelId && panels.length > 0) {
      onPanelChange(panels[0].id)
    }
  }, [activePanelId, panels, onPanelChange])

  useEffect(() => {
    if (!activePanelId) { setActiveComponent(null); return }
    const panel = panelRegistry.getPanel(activePanelId)
    if (!panel) return
    let cancelled = false
    panel.component().then(mod => {
      if (!cancelled) setActiveComponent(() => mod.default)
    })
    return () => { cancelled = true }
  }, [activePanelId])

  if (panels.length === 0) return null

  return (
    <div className="flex flex-col h-full">
      {header}
      {/* Panel switcher bar */}
      {!hideDropdown && (
        <div className="flex items-center justify-between px-2 pt-6 pb-2
          border-b border-border-subtle cursor-default">
          <PanelDropdown panels={panels} activeId={activePanelId} onChange={onPanelChange} />
          {onClose && (
            <button onClick={onClose}
              className="p-1 rounded-lg hover:bg-bg-tertiary
                text-text-tertiary transition-smooth">
              <X size={14} weight="light" />
            </button>
          )}
        </div>
      )}

      {/* Panel content */}
      {hideContent ? (
        <div className="flex-1 flex items-start justify-center pt-6">
          {emptyState}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {ActiveComponent ? <ActiveComponent /> : null}
        </div>
      )}
      {footer}
    </div>
  )
}

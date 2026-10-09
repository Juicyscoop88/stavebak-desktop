import { useState, useRef, useEffect } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import type { PanelEntry } from '../../lib/panel-registry'

interface PanelDropdownProps {
  panels: PanelEntry[]
  activeId: string | null
  onChange: (id: string | null) => void
}

export function PanelDropdown({ panels, activeId, onChange }: PanelDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const active = panels.find(p => p.id === activeId)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium
          text-text-primary hover:bg-bg-secondary transition-smooth"
      >
        {active?.label ?? 'Select panel'}
        <CaretDown size={10} weight="light" className="text-text-tertiary" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[160px] z-50
          bg-bg-primary border border-border-subtle rounded-xl shadow-lg
          py-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {panels.map(panel => (
            <button
              key={panel.id}
              onClick={() => { onChange(panel.id); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm transition-smooth
                ${panel.id === activeId
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-text-primary hover:bg-bg-secondary'
                }`}
            >
              {panel.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

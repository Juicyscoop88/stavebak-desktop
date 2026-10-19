import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { bridge } from '../../lib/tauri-bridge'

export const PROJECT_FILE = 'stavebak.json'

export type StepStatus = 'done' | 'available' | 'waiting'

export interface GuideStep {
  id: string
  label: string
  phase: string
  status: StepStatus
  duration: string
  optional?: boolean
  missingFacts: Record<string, string>
  prerequisites: { id: string; label: string; required: string | boolean; fulfilled: boolean }[]
}

export interface NextAction {
  kind: 'ask-client' | 'public-data' | 'order-supplier' | 'request-authority' | 'design' | 'confirm'
  step: string
  title: string
  detail: string
  leadTime?: string
}

/** Subset of the Stavebák MCP `guide` result the desktop renders. */
export interface GuideResult {
  buildingType: { id: string; label: string }
  category: { label: string; authorityDeadlineDays?: number; feeCzk?: number; requiresPermit?: boolean }
  progress: { done: number; total: number }
  currentPhase: string
  steps: GuideStep[]
  nextActions: NextAction[]
  expiring: { id: string; label: string; validUntil: string; daysLeft: number }[]
}

export const PHASE_LABEL: Record<string, string> = {
  preparation: 'Příprava',
  design: 'Projekt',
  permit: 'Povolení',
  construction: 'Realizace',
  use: 'Užívání',
}

type Status = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

interface StavebakState {
  dir: string | null
  status: Status
  name: string | null
  guide: GuideResult | null
  /** File predates the dictionary format (no `parameters`) — progress may be understated */
  outdated: boolean
  error: string | null
  load: (dir: string) => Promise<void>
}

/** stavebak.json has two shapes in the wild: the current one (typ_stavby, parameters)
 *  and the legacy one (projekt.typ_stavby, parametry po sekcích). guide accepts both. */
function guideArgs(file: Record<string, any>) {
  const buildingType = file.typ_stavby ?? file.projekt?.typ_stavby
  const parameters = file.parameters ?? file.parametry
  return {
    buildingType,
    ...(parameters ? { parameters } : {}),
    ...(file.checklist ? { checklist: file.checklist } : {}),
  }
}

export const useStavebakStore = create<StavebakState>((set, get) => ({
  dir: null,
  status: 'idle',
  name: null,
  guide: null,
  outdated: false,
  error: null,

  load: async (dir) => {
    // Keep the previous result visible while refreshing the same project
    if (get().dir !== dir) set({ dir, status: 'loading', guide: null, name: null, error: null })

    let file: Record<string, any>
    try {
      const raw = await bridge.readFileContent(`${dir}/${PROJECT_FILE}`)
      file = JSON.parse(raw)
    } catch {
      if (get().dir === dir) set({ status: 'missing', guide: null, name: null })
      return
    }

    const name = file.displayName ?? file.nazev ?? file.projekt?.nazev ?? null
    const outdated = !file.parameters
    try {
      const guide = await invoke<GuideResult>('stavebak_guide', { args: guideArgs(file) })
      if (get().dir === dir) set({ status: 'ready', guide, name, outdated, error: null })
    } catch (e) {
      if (get().dir === dir) set({ status: 'error', name, error: String(e) })
    }
  },
}))

export const MIGRATE_PROMPT =
  'stavebak.json je ve starším formátu, takže přehled projektu nesedí. Převeď ho do aktuálního formátu Stavebáku: ' +
  'všechny údaje (i ze sekce projekt) zapiš přes set_parameters podle slovníku stavebak://parameters se zdrojem a datem dokumentu, ' +
  'checklist přepiš na ID kroků a podkladů z guide. Nic nedomýšlej, co nejde přiřadit, mi vypiš.'

/** Put a prepared instruction into the chat input without sending it. */
export function prefillChat(text: string) {
  window.dispatchEvent(new CustomEvent('stavebak:prefill', { detail: text }))
}

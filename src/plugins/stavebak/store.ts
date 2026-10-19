import { create } from 'zustand'
import { bridge } from '../../lib/tauri-bridge'
import { useMcpStore } from '../../stores/mcpStore'

export const PROJECT_FILE = 'stavebak.json'
const SERVER = 'stavebak'

export type StepStatus = 'done' | 'available' | 'waiting'

export interface GuideStep {
  id: string
  label: string
  phase: string
  status: StepStatus
  duration: string
  optional?: boolean
  missingFacts: Record<string, string>
}

export interface NextAction {
  kind: string
  kindLabel?: string
  step: string
  title: string
  detail: string
  leadTime?: string
}

/** What the Stavebák MCP `guide` returns for a stavebak.json — rendered as-is, no domain logic here. */
export interface GuideResult {
  projectName?: string | null
  format?: { current: boolean; unmapped: string[]; unknownChecklist: string[]; hint?: string }
  buildingType: { id: string; label: string }
  category: { label: string; authorityDeadlineDays?: number; feeCzk?: number }
  progress: { done: number; total: number }
  currentPhase: string
  phases?: { id: string; label: string }[]
  steps: GuideStep[]
  nextActions: NextAction[]
  expiring: { id: string; label: string; validUntil: string; daysLeft: number }[]
}

type Status = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

interface StavebakState {
  dir: string | null
  status: Status
  guide: GuideResult | null
  error: string | null
  load: (dir: string) => Promise<void>
}

function serverUrl(): string | null {
  return useMcpStore.getState().servers.find((s) => s.name === SERVER)?.config.url ?? null
}

export const useStavebakStore = create<StavebakState>((set, get) => ({
  dir: null,
  status: 'idle',
  guide: null,
  error: null,

  load: async (dir) => {
    // Keep the previous result visible while refreshing the same project
    if (get().dir !== dir) set({ dir, status: 'loading', guide: null, error: null })

    let project: Record<string, unknown>
    try {
      project = JSON.parse(await bridge.readFileContent(`${dir}/${PROJECT_FILE}`))
    } catch {
      if (get().dir === dir) set({ status: 'missing', guide: null })
      return
    }

    const url = serverUrl()
    if (!url) {
      if (get().dir === dir) set({ status: 'error', error: 'Stavebák MCP není nastavený.' })
      return
    }
    try {
      const guide = await bridge.callMcpTool<GuideResult>(url, 'guide', { project })
      if (get().dir === dir) set({ status: 'ready', guide, error: null })
    } catch (e) {
      if (get().dir === dir) set({ status: 'error', error: String(e) })
    }
  },
}))

export const phaseLabel = (g: GuideResult, id: string) => g.phases?.find((p) => p.id === id)?.label ?? id

/** Send a message as if the user typed it — for explicit actions that need no extra input. */
export function sendChat(text: string) {
  window.dispatchEvent(new CustomEvent('stavebak:send', { detail: text }))
}

/** Messages carry the user's intent only — how to do it comes from the server's instructions. */
export const SETUP_MESSAGE = 'Založ pro tuto složku projekt Stavebáku.'
export const MIGRATE_MESSAGE = 'Převeď stavebak.json do aktuálního formátu.'
export const nextStepMessage = (title: string) => `Pojďme na další krok: ${title}.`

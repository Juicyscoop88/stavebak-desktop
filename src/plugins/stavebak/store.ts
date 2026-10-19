import { create } from 'zustand'
import { bridge } from '../../lib/tauri-bridge'
import { useMcpStore } from '../../stores/mcpStore'
import { ACTION_PREFIX } from '../../components/chat/MessageBubble'

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

export interface FormField {
  id: string
  type: 'text' | 'choice'
  label: string
  required: boolean
  placeholder?: string
  hint?: string
  options?: { id: string; label: string; primary: boolean }[]
}
export interface ProjectForm { title: string; submitLabel: string; fields: FormField[] }

let formCache: ProjectForm | null = null

/** The new-project form as the server defines it (fields, building types, labels). */
export async function fetchProjectForm(): Promise<ProjectForm> {
  if (formCache) return formCache
  const url = serverUrl()
  if (!url) throw new Error('Stavebák MCP není nastavený.')
  formCache = await bridge.callMcpTool<ProjectForm>(url, 'project_form', {})
  return formCache
}

/** Write the server-made stavebak.json into `dir` (no AI involved). */
export async function createProjectFile(dir: string, values: Record<string, string>): Promise<void> {
  const url = serverUrl()
  if (!url) throw new Error('Stavebák MCP není nastavený.')
  const { file, fileName } = await bridge.callMcpTool<{ file: unknown; fileName: string }>(url, 'new_project_file', values)
  await bridge.writeFileContent(`${dir}/${fileName}`, JSON.stringify(file, null, 2) + '\n')
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

/** Run an action in the chat. Shown as an event row ("▶ …"), not as something the user typed;
 *  the text carries the user's intent only — how to do it comes from the server's instructions. */
export function runAction(label: string) {
  window.dispatchEvent(new CustomEvent('stavebak:send', { detail: `${ACTION_PREFIX}${label}` }))
}

export const MIGRATE_ACTION = 'Převést stavebak.json do aktuálního formátu'
export const nextStepAction = (title: string) => `Další krok: ${title}`

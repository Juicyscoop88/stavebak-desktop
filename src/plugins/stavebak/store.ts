import { create } from 'zustand'
import { listProjects, getProjectStatus } from './mcp-client'

interface Project {
  id: string
  name: string
  [key: string]: unknown
}

interface ProjectStatus {
  [key: string]: unknown
}

interface StavebakState {
  projects: Project[]
  activeProjectId: string | null
  status: ProjectStatus | null
  loading: boolean

  fetchProjects: () => Promise<void>
  fetchStatus: (projectId: string) => Promise<void>
  setActiveProject: (id: string) => void
}

export const useStavebakStore = create<StavebakState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  status: null,
  loading: false,

  fetchProjects: async () => {
    set({ loading: true })
    try {
      const result = await listProjects()
      const content = result.content as Array<{ type: string; text: string }>
      set({ projects: JSON.parse(content[0].text), loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchStatus: async (projectId) => {
    try {
      const result = await getProjectStatus(projectId)
      const content = result.content as Array<{ type: string; text: string }>
      set({ status: JSON.parse(content[0].text) })
    } catch {
      // silently ignore
    }
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id })
    get().fetchStatus(id)
  },
}))

import { create } from 'zustand'
import { ProjectConfig } from '@/types/layout'
import * as api from '@/api/client'

const STORAGE_KEY = 'djui.project.config'
const PAGE_KEY = 'djui.project.lastPage'

export interface AgentsState {
  status: 'ok' | 'outdated' | 'missing' | 'unknown'
  latestVersion: string | null
  installedVersion: string | null
  message: string | null
}

export interface ScriptsState {
  status: 'ok' | 'outdated' | 'missing' | 'unavailable' | 'unknown'
  latestVersion: string | null
  installedVersion: string | null
  message: string | null
}

interface ProjectState {
  config: ProjectConfig | null
  lastPageId: string | null
  agents: AgentsState
  scripts: ScriptsState

  loadConfig: () => void
  setConfig: (config: ProjectConfig) => void
  clearConfig: () => void
  setLastPage: (pageId: string) => void
  refreshAgents: (workspacePath?: string) => Promise<void>
  setAgents: (s: AgentsState) => void
  refreshScripts: (workspacePath?: string) => Promise<void>
  setScripts: (s: ScriptsState) => void
}

const initialAgents: AgentsState = {
  status: 'unknown',
  latestVersion: null,
  installedVersion: null,
  message: null,
}

const initialScripts: ScriptsState = {
  status: 'unknown',
  latestVersion: null,
  installedVersion: null,
  message: null,
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  config: null,
  lastPageId: null,
  agents: initialAgents,
  scripts: initialScripts,

  loadConfig: () => {
    // 先从 localStorage 快速加载（同步）
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const config = raw ? JSON.parse(raw) : null
      const lastPageId = localStorage.getItem(PAGE_KEY)
      set({ config, lastPageId })
    } catch {
      set({ config: null, lastPageId: null })
    }

    // 再从后端加载（权威源），覆盖 localStorage
    api.getConfig().then((serverConfig) => {
      if (serverConfig) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serverConfig))
        set({ config: serverConfig })
      }
    }).catch(() => {})
  },

  setConfig: (config) => {
    // 同步写入 localStorage 和后端
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    set({ config })
    // 异步同步到后端（不阻塞 UI）
    api.saveConfig(config).catch(() => {})
  },

  clearConfig: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ config: null, agents: initialAgents, scripts: initialScripts })
  },

  setLastPage: (pageId) => {
    localStorage.setItem(PAGE_KEY, pageId)
    set({ lastPageId: pageId })
  },

  setAgents: (s) => set({ agents: s }),

  refreshAgents: async (workspacePath?: string) => {
    const ws = workspacePath ?? get().config?.workspacePath
    if (!ws) {
      set({ agents: initialAgents })
      return
    }
    try {
      const r = await api.checkAgentsUpdate(ws)
      set({
        agents: {
          status: r.status,
          latestVersion: r.latestVersion,
          installedVersion: r.installedVersion,
          message: r.message,
        },
      })
    } catch {
      set({ agents: initialAgents })
    }
  },

  setScripts: (s) => set({ scripts: s }),

  refreshScripts: async (workspacePath?: string) => {
    const ws = workspacePath ?? get().config?.workspacePath
    if (!ws) {
      set({ scripts: initialScripts })
      return
    }
    try {
      const r = await api.checkScriptsUpdate(ws)
      set({
        scripts: {
          status: r.status,
          latestVersion: r.latestVersion,
          installedVersion: r.installedVersion,
          message: r.message,
        },
      })
    } catch {
      set({ scripts: initialScripts })
    }
  },
}))

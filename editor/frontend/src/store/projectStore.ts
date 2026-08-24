import { create } from 'zustand'
import { ProjectConfig } from '@/types/layout'
import { projectContext } from '@/fs/projectContext'
import * as api from '@/api/client'
import type { ExternalChange } from '@/lib/pageSync'

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

// 星火工程 src/DjuiRuntime 的就绪状态。
// 注意与 scripts（工作区脚本区）是两个对象：脚本区最新不代表星火 Runtime 已升级，
// 发布前置检查依赖这里，避免「启动不提醒、发布才拦截」。
export interface RuntimeState {
  status: 'ok' | 'outdated' | 'missing' | 'invalid' | 'unknown'
  installedVersion: string | null
  expectedVersion: string | null
  /** 星火工程已装版本比编辑器内置新（网页侧过旧），只能刷新网页解决，禁止引导覆盖安装 */
  installedNewer: boolean
  message: string | null
}

interface ProjectState {
  config: ProjectConfig | null
  handlesReady: boolean  // DirectoryHandle 权限是否已就绪
  lastPageId: string | null
  agents: AgentsState
  scripts: ScriptsState
  runtime: RuntimeState
  fontVersion: number  // 字体注册完成后 bump，触发画布重渲染用真实字体
  fonts: string[]  // 可用字体列表（来自工程 fontref.txt，主流程集中加载）
  fontInfos: api.FontInfo[]  // 字体分类信息（标准/系统/封装/缺失）
  fontManagerOpen: boolean  // 字体管理弹窗
  syncConflicts: ExternalChange[]  // 检测到但尚未裁决的页面外部修改冲突（驱动 TopBar 徽章）

  initFromHandles: (handles: { star: boolean; ws: boolean }) => void
  loadProjectFile: () => Promise<api.ProjectFileLoadResult>
  setConfig: (config: ProjectConfig) => Promise<void>
  clearConfig: () => void
  setLastPage: (pageId: string) => void
  refreshAgents: () => Promise<void>
  setAgents: (s: AgentsState) => void
  refreshScripts: () => Promise<void>
  setScripts: (s: ScriptsState) => void
  refreshRuntime: () => Promise<void>
  bumpFontVersion: () => void
  refreshFonts: () => Promise<void>
  setFontManagerOpen: (open: boolean) => void
  setSyncConflicts: (conflicts: ExternalChange[]) => void
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

const initialRuntime: RuntimeState = {
  status: 'unknown',
  installedVersion: null,
  expectedVersion: null,
  installedNewer: false,
  message: null,
}

export const useProjectStore = create<ProjectState>((set) => ({
  config: null,
  handlesReady: false,
  lastPageId: null,
  agents: initialAgents,
  scripts: initialScripts,
  runtime: initialRuntime,
  fontVersion: 0,
  fonts: [],
  fontInfos: [],
  fontManagerOpen: false,
  syncConflicts: [],

  initFromHandles: (handles) => {
    // 从 projectContext 恢复配置
    const stored = api.getStoredConfig()
    if (stored) {
      // 更新目录名（可能是不同目录）
      stored.starProjectPath = projectContext.starName || stored.starProjectPath
      stored.workspacePath = projectContext.wsName || stored.workspacePath
      api.saveStoredConfig(stored)
    }
    set({ config: stored, handlesReady: handles.star && handles.ws })
  },

  loadProjectFile: async () => {
    const result = await api.loadProjectFileV6()
    if (result.status === 'ok') {
      const config = api.projectConfigFromV6(result.project)
      api.saveStoredConfig(config)
      set({ config })
    }
    return result
  },

  setConfig: async (config) => {
    await api.saveProjectFileV6(api.createProjectFileV6(config))
    api.saveStoredConfig(config)
    set({ config, handlesReady: true })
  },

  clearConfig: () => {
    api.clearStoredConfig()
    projectContext.clear()
    set({ config: null, handlesReady: false, agents: initialAgents, scripts: initialScripts, runtime: initialRuntime, syncConflicts: [] })
  },

  setLastPage: (pageId) => {
    api.saveLastPageId(pageId)
    set({ lastPageId: pageId })
  },

  setAgents: (s) => set({ agents: s }),

  refreshAgents: async () => {
    try {
      const r = await api.checkAgentsUpdate('')
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

  refreshScripts: async () => {
    try {
      const r = await api.checkScriptsUpdate('')
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

  refreshRuntime: async () => {
    try {
      const r = await api.checkRuntime('')
      set({
        runtime: {
          status: r.status,
          installedVersion: r.installedVersion ?? null,
          expectedVersion: r.expectedVersion ?? null,
          installedNewer: !!r.installedNewer,
          message: r.message,
        },
      })
    } catch {
      set({ runtime: initialRuntime })
    }
  },

  bumpFontVersion: () => set((s) => ({ fontVersion: s.fontVersion + 1 })),

  refreshFonts: async () => {
    try {
      const list = await api.getFonts()
      let infos: api.FontInfo[] = []
      try { infos = await api.getFontInfos() } catch { /* 分类信息失败不阻塞列表 */ }
      set({ fonts: list, fontInfos: infos })
    } catch {
      set({ fonts: [], fontInfos: [] })
    }
  },

  setFontManagerOpen: (open) => set({ fontManagerOpen: open }),

  setSyncConflicts: (conflicts) => set({ syncConflicts: conflicts }),
}))

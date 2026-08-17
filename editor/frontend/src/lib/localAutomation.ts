import * as api from '@/api/client'
import { projectContext } from '@/fs/projectContext'

declare global {
  interface Window {
    __DJUI_AUTOMATION__?: {
      status: () => Promise<unknown>
      upgradeRuntime: () => Promise<unknown>
      publish: () => Promise<unknown>
    }
  }
}

export function installLocalAutomation(): void {
  if (!import.meta.env.DEV) return
  window.__DJUI_AUTOMATION__ = {
    status: async () => ({
      starProject: projectContext.starName,
      workspace: projectContext.wsName,
      runtime: await api.checkRuntime(''),
    }),
    upgradeRuntime: async () => api.initRuntime(''),
    publish: async () => api.publishAssets(),
  }
}

// 项目上下文：管理星火工程目录和 UI 工作区目录的 DirectoryHandle
// 这两个 handle 是所有文件操作的基础

import * as fs from './fsAccess'

const STAR_KEY = 'starProject'
const WS_KEY = 'workspace'

class ProjectContext {
  private starHandle: FileSystemDirectoryHandle | null = null
  private wsHandle: FileSystemDirectoryHandle | null = null

  get star(): FileSystemDirectoryHandle | null {
    return this.starHandle
  }

  get ws(): FileSystemDirectoryHandle | null {
    return this.wsHandle
  }

  get starName(): string {
    return this.starHandle?.name ?? ''
  }

  get wsName(): string {
    return this.wsHandle?.name ?? ''
  }

  // 从 IndexedDB 恢复 handle（需要用户再次授权）
  async restore(): Promise<{ star: boolean; ws: boolean }> {
    const [star, ws] = await Promise.all([
      fs.loadHandle(STAR_KEY),
      fs.loadHandle(WS_KEY),
    ])
    this.starHandle = star
    this.wsHandle = ws
    return {
      star: star !== null,
      ws: ws !== null,
    }
  }

  // 查询已恢复 handle 的权限（不弹窗，无用户手势时可调用）
  // 只检查权限是否已 granted，不主动 requestPermission（那需要用户手势）
  async checkPermissions(): Promise<{ star: boolean; ws: boolean }> {
    let starOk = false
    let wsOk = false
    if (this.starHandle) {
      starOk = await fs.queryPermission(this.starHandle)
    }
    if (this.wsHandle) {
      wsOk = await fs.queryPermission(this.wsHandle)
    }
    return { star: starOk, ws: wsOk }
  }

  // 请求权限（必须在用户手势中调用，如按钮点击）
  async requestPermissions(): Promise<{ star: boolean; ws: boolean }> {
    let starOk = false
    let wsOk = false
    if (this.starHandle) {
      starOk = await fs.requestPermission(this.starHandle)
    }
    if (this.wsHandle) {
      wsOk = await fs.requestPermission(this.wsHandle)
    }
    return { star: starOk, ws: wsOk }
  }

  // 用户选择星火工程目录
  async pickStarProject(): Promise<boolean> {
    try {
      const handle = await fs.pickDirectory()
      this.starHandle = handle
      await fs.saveHandle(STAR_KEY, handle)
      return true
    } catch {
      return false
    }
  }

  // 用户选择 UI 工作区目录
  async pickWorkspace(): Promise<boolean> {
    try {
      const handle = await fs.pickDirectory()
      this.wsHandle = handle
      await fs.saveHandle(WS_KEY, handle)
      return true
    } catch {
      return false
    }
  }

  // 清除
  async clear(): Promise<void> {
    this.starHandle = null
    this.wsHandle = null
    await fs.clearHandles()
  }
}

export const projectContext = new ProjectContext()

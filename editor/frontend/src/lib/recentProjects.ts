// 最近打开的工程记录(localStorage 持久化)。
// 供顶栏「最近工程」快捷切换:VS Code 风格,点击即切回曾打开过的工程。

export interface RecentProject {
  id: string            // 工程唯一标识(starName + '/' + wsName,去重用)
  starName: string      // 星火工程目录名
  wsName: string        // UI 工作区目录名
  lastOpenedAt: number  // 最近打开时间(ms)
}

const KEY = 'djui.recentProjects'
const MAX = 8

export function getRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as RecentProject[]
    if (!Array.isArray(list)) return []
    return list.filter(p => p && typeof p.id === 'string' && p.starName && p.wsName)
  } catch {
    return []
  }
}

// 记录一次打开(置顶去重,超限裁剪最旧的)
export function pushRecentProject(starName: string, wsName: string): void {
  if (!starName || !wsName) return
  const id = starName + '/' + wsName
  const list = getRecentProjects().filter(p => p.id !== id)
  list.unshift({ id, starName, wsName, lastOpenedAt: Date.now() })
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // 存储满等异常:静默,不影响主流程
  }
}

export function removeRecentProject(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecentProjects().filter(p => p.id !== id)))
  } catch {
    // 同上
  }
}
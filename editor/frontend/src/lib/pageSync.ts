// 页面外部修改检测与同步编排
// 编辑器所有页面常驻内存、纯手动保存；AI 或其它工具直接改写磁盘 JSON 时，
// 这里负责发现差异并按「内存是否干净」分层处理：
//   内存干净   → 自动按磁盘重载（upsertPage 保留撤销栈）
//   内存有未保存修改 → 上报冲突，由用户选择磁盘版 / 本地版（见 SyncConflictModal）
import * as api from '@/api/client'
import { useEditorStore } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'

export interface ExternalChange {
  pageId: string
  type: 'modified' | 'added' | 'deleted'
  /** 内存页与基线 canonical 不一致 = 存在未保存的本地修改 */
  hasLocalEdits: boolean
}

// 互斥锁：检测 / 保存 / 发布共享一条串行队列，避免检测读到编辑器自己写了一半的状态
let exclusiveQueue: Promise<unknown> = Promise.resolve()
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = exclusiveQueue.then(fn, fn)
  exclusiveQueue = run.catch(() => undefined)
  return run
}

function hasLocalEdits(pageId: string): boolean {
  const page = useEditorStore.getState().allPages[pageId]
  if (!page) return false
  const baseline = api.getPageBaseline(pageId)
  if (!baseline) return true // 无基线按有本地修改处理（保守）
  return api.canonicalizePage(page) !== baseline.canonical
}

/** 全量比对磁盘与基线：modified（外部改写）、added（外部新建）、deleted（外部删除） */
export async function detectExternalChanges(): Promise<ExternalChange[]> {
  const changes: ExternalChange[] = []
  // 自愈：清理内存页面表中已不存在的基线残留（refreshPages 全量重载后的兜底）
  api.pruneBaselines(Object.keys(useEditorStore.getState().allPages))

  const diskIds = await api.listPages()
  for (const pageId of api.getAllPageBaselineIds()) {
    const baseline = api.getPageBaseline(pageId)
    if (!baseline) continue
    const diskText = await api.readPageDiskText(pageId)
    if (diskText === null) {
      if (!baseline.deleteAccepted) {
        changes.push({ pageId, type: 'deleted', hasLocalEdits: hasLocalEdits(pageId) })
      }
      continue
    }
    if (diskText !== baseline.diskText) {
      changes.push({ pageId, type: 'modified', hasLocalEdits: hasLocalEdits(pageId) })
    }
  }
  for (const pageId of diskIds) {
    if (api.getPageBaseline(pageId)) continue
    // 磁盘新出现的页面（多为 AI 新建）；内存恰有同名未落盘页时按冲突处理
    if (useEditorStore.getState().allPages[pageId]) {
      changes.push({ pageId, type: 'modified', hasLocalEdits: true })
    } else {
      changes.push({ pageId, type: 'added', hasLocalEdits: false })
    }
  }
  return changes
}

/** 按磁盘版本应用一组变化（不区分是否冲突，调用方决定给哪些） */
export async function applyDiskVersions(changes: ExternalChange[]): Promise<void> {
  const config = useProjectStore.getState().config
  for (const change of changes) {
    if (change.type === 'deleted') {
      useEditorStore.getState().removePage(change.pageId)
      continue
    }
    // modified / added：按磁盘重载（loadPage 顺带刷新基线）
    let pageData
    try {
      pageData = await api.loadPage(change.pageId)
    } catch {
      continue // 外部写入尚未完成或内容非法：本轮跳过，下次检测再试
    }
    if (!pageData) continue
    if (config && pageData.nodeKind === 'window') {
      if (config.designWidth) pageData.designWidth = config.designWidth
      if (config.designHeight) pageData.designHeight = config.designHeight
    }
    const store = useEditorStore.getState()
    store.upsertPage(pageData)
    // upsertPage 只更新 allPages，当前页引用需要重取
    if (store.activePageId === change.pageId) {
      useEditorStore.getState().setActivePage(change.pageId)
    }
  }
}

export interface SyncResult {
  /** 内存有未保存修改、需要用户裁决的变化 */
  conflicts: ExternalChange[]
  /** 已自动按磁盘同步的变化 */
  synced: ExternalChange[]
}

/** 检测并自动同步内存干净的变化（focus 恢复 / 发布前共用），冲突留给调用方弹窗 */
export async function detectAndSyncClean(): Promise<SyncResult> {
  const changes = await detectExternalChanges()
  const conflicts = changes.filter(c => c.hasLocalEdits)
  const synced = changes.filter(c => !c.hasLocalEdits)
  if (synced.length > 0) await applyDiskVersions(synced)
  return { conflicts, synced }
}

/** 「保留我的版本」：把磁盘当前内容记为已知状态，后续检测不再上报；内存未保存修改保留 */
export async function keepLocalVersions(changes: ExternalChange[]): Promise<void> {
  for (const change of changes) {
    if (change.type === 'deleted') {
      api.acceptBaselineDeletion(change.pageId)
      continue
    }
    const diskText = await api.readPageDiskText(change.pageId)
    if (diskText === null) {
      api.acceptBaselineDeletion(change.pageId)
      continue
    }
    api.setBaselineDiskText(change.pageId, diskText, useEditorStore.getState().allPages[change.pageId])
  }
}

/** 保存前的轻量检查：当前页是否被外部修改（只做一次磁盘读，不扫全部页面） */
export async function checkCurrentPageExternalChange(): Promise<ExternalChange | null> {
  const page = useEditorStore.getState().page
  if (!page) return null
  const baseline = api.getPageBaseline(page.pageId)
  if (!baseline) return null
  const diskText = await api.readPageDiskText(page.pageId)
  if (diskText === null || diskText === baseline.diskText) return null
  return {
    pageId: page.pageId,
    type: 'modified',
    hasLocalEdits: api.canonicalizePage(page) !== baseline.canonical,
  }
}

export function describeChanges(changes: ExternalChange[]): string {
  return changes
    .map(c => `「${c.pageId}」${c.type === 'added' ? '新增' : c.type === 'deleted' ? '已删除' : '已更新'}`)
    .join('、')
}

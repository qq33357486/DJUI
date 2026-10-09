import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { UiNode, UiPage, COMPONENT_LIBRARY } from '@/types/layout'
import { solveLayout, Rect as LayoutRect, solveChildrenFlex } from '@/utils/layoutSolver'
import { getAnchorSide, DEFAULT_ANCHOR_SIDE } from '@/utils/anchorPresets'
import type { PageUnderlayMap } from '@/lib/pageUnderlays'

// 撤销/重做栈：整个 UI 工程共用一条历史，而不是按页面各自分段。
interface HistoryEntry {
  allPages: Record<string, UiPage>
  activePageId: string | null
  selectedIds: string[]
  selectionAnchor: string | null
}

interface EditorState {
  // 所有页面（pageId → UiPage）
  allPages: Record<string, UiPage>
  // 当前编辑的页面 ID
  activePageId: string | null
  // 当前编辑的页面（allPages[activePageId] 的引用，为兼容保留）
  page: UiPage | null

  /** 编辑器专用：前景页面 → 直接后景页面，不进入 Runtime 页面协议。 */
  pageUnderlays: PageUnderlayMap
  setPageUnderlays: (links: PageUnderlayMap) => void

  // 响应式编辑层
  responsiveVariant: 'base' | 'wide'
  setResponsiveVariant: (variant: 'base' | 'wide') => void
  clearResponsiveOverrides: (nodeId: string) => void

  // 选中
  selectedIds: string[]
  // 选择锚点（最近一次单选/范围选的起点节点 id，供 Shift 连续范围选择）
  selectionAnchor: string | null

  // 撤销重做
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  // 连续输入中的暂存快照；只有操作停下后才进入撤销栈。
  pendingHistory: HistoryEntry | null
  historyLock: boolean

  // 操作
  setAllPages: (pages: Record<string, UiPage>) => void
  upsertPage: (page: UiPage) => void
  removePage: (pageId: string) => void
  setActivePage: (pageId: string) => void
  setPage: (page: UiPage | null) => void
  updatePageMeta: (pageId: string, updates: Partial<UiPage>) => void
  selectNode: (id: string, modifier?: 'none' | 'ctrl' | 'shift') => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  moveSelection: (dx: number, dy: number) => void

  addNode: (parentId: string | null, node: UiNode) => void
  removeNode: (id: string) => void
  duplicateNode: (id: string) => void
  pasteNode: (targetId: string | null) => void
  moveNode: (dragId: string, targetId: string, position: 'before' | 'after' | 'inside') => void
  updateNode: (id: string, updates: Partial<UiNode>) => void
  updateNodeField: (id: string, path: string, value: unknown) => void
  setAllFonts: (font: string | null) => void
  applyFlexLayout: (parentId: string) => void
  batchUpdateNode: (id: string, updates: Record<string, unknown>) => void
  batchUpdateNodes: (updatesById: Record<string, Record<string, unknown>>, opts?: { queueHistory?: boolean }) => void

  pushHistory: () => void
  queueHistory: () => void
  commitHistory: () => void
  undo: () => void
  redo: () => void
}

function cloneNode(node: UiNode): UiNode {
  return JSON.parse(JSON.stringify(node))
}

function clonePages(pages: Record<string, UiPage>): Record<string, UiPage> {
  return JSON.parse(JSON.stringify(pages))
}

function setNodeFieldValue(node: UiNode, path: string, value: unknown) {
  const parts = path.split('.')
  let target: any = node
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {}
    target = target[parts[i]]
  }
  target[parts[parts.length - 1]] = value
}

const HISTORY_LIMIT = 100
const HISTORY_IDLE_COMMIT_MS = 450
let historyCommitTimer: ReturnType<typeof setTimeout> | null = null

function clearHistoryCommitTimer() {
  if (historyCommitTimer !== null) {
    clearTimeout(historyCommitTimer)
    historyCommitTimer = null
  }
}

function createHistoryEntry(state: Pick<EditorState, 'allPages' | 'activePageId' | 'selectedIds' | 'selectionAnchor'>): HistoryEntry {
  return {
    allPages: clonePages(state.allPages),
    activePageId: state.activePageId,
    selectedIds: [...state.selectedIds],
    selectionAnchor: state.selectionAnchor,
  }
}

// 递归算出某节点在画布上的绝对矩形（从 root 开始向下求解）
function solveAbsoluteRect(root: UiNode, targetId: string, canvasW: number, canvasH: number): LayoutRect | null {
  const path = findPath(root, targetId)
  if (!path) return null
  let parentRect: LayoutRect = { x: 0, y: 0, width: canvasW, height: canvasH }
  for (let i = 1; i < path.length; i++) {
    const solved = solveLayout(path[i], parentRect, canvasW, canvasH)
    parentRect = solved.rect
  }
  return parentRect
}

// 找到从 root 到 targetId 的路径（包含 root 和 target）
export function findPath(root: UiNode, targetId: string): UiNode[] | null {
  if (root.id === targetId) return [root]
  for (const child of root.children) {
    const sub = findPath(child, targetId)
    if (sub) return [root, ...sub]
  }
  return null
}

// 根据旧/新父节点矩形，换算 transform.x/y 使视觉位置不变
function recalcOffset(node: UiNode, oldParentRect: LayoutRect, newParentRect: LayoutRect, canvasW: number, canvasH: number) {
  const t = node.transform ?? {}
  const anchor = node.anchor ?? {}
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const anchorTarget = anchor.target ?? 'parent'
  const side = getAnchorSide(sideId)

  // screen 锚点不随父变，不需要换算
  if (anchorTarget === 'screen') return

  if (sideId === 'None' || !side) {
    // 无锚点：t.x/y 是相对父矩形左上角的绝对偏移
    // oldAbsolute = oldParentRect.x + t.x
    // newT.x = oldAbsolute - newParentRect.x
    t.x = Math.round((oldParentRect.x + (t.x ?? 0)) - newParentRect.x)
    t.y = Math.round((oldParentRect.y + (t.y ?? 0)) - newParentRect.y)
    return
  }

  // 有锚点：t.x/y 是锚点偏移
  // oldAbsolute = oldAnchorX + t.x - side.nx * w  (w 不变)
  // newT.x = oldAbsolute - newAnchorX + side.nx * w
  //        = oldAnchorX + t.x - newAnchorX
  const oldAnchorX = oldParentRect.x + side.nx * oldParentRect.width
  const oldAnchorY = oldParentRect.y + (1 - side.ny) * oldParentRect.height
  const newAnchorX = newParentRect.x + side.nx * newParentRect.width
  const newAnchorY = newParentRect.y + (1 - side.ny) * newParentRect.height

  t.x = Math.round((t.x ?? 0) + oldAnchorX - newAnchorX)
  t.y = Math.round((t.y ?? 0) + oldAnchorY - newAnchorY)
}

function findNode(root: UiNode, id: string): UiNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function findParent(root: UiNode, id: string): UiNode | null {
  for (const child of root.children) {
    if (child.id === id) return root
    const found = findParent(child, id)
    if (found) return found
  }
  return null
}

function removeFromParent(root: UiNode, id: string): boolean {
  const idx = root.children.findIndex(c => c.id === id)
  if (idx >= 0) {
    root.children.splice(idx, 1)
    return true
  }
  for (const child of root.children) {
    if (removeFromParent(child, id)) return true
  }
  return false
}

// ============================================================================
// 自动重排（决议 7）：容器开启排列模式（Vertical/Horizontal/Grid）且 autoRelayout!==false
// （null/缺省=默认 true）时，增删子项 / 层级拖动改顺序 / 撤销重做 自动把排列结果写回子控件 transform。
// 排列语义（Grid/padding/内容对齐/childOrder 排序）全部由 solveChildrenFlex→arrangeChildren 提供。
// 约定：本函数直接在 immer draft 上操作、绝不调 pushHistory——
// 调用点全部位于各 action 的「pushHistory → set」结构内 set 回调尾部，与触发操作合并为单步撤销；
// undo/redo 的兜底重排同样直接改 draft 不入栈（否则撤销永不到底，决议 7）。
// ============================================================================
function applyAutoRelayout(root: UiNode, containerId: string, canvasW: number, canvasH: number): void {
  const container = findNode(root, containerId)
  if (!container) return
  const flow = container.layout?.flowOrientation
  if (flow !== 'Vertical' && flow !== 'Horizontal' && flow !== 'Grid') return
  if (container.layout?.autoRelayout === false) return
  const containerRect = solveAbsoluteRect(root, containerId, canvasW, canvasH)
  if (!containerRect) return
  // 不可见子项不参与排列测量（与 applyFlexLayout/排列口径一致）
  const children = container.children.filter(c => c.basic?.visible !== false)
  if (children.length === 0) return
  const flexRects = solveChildrenFlex(containerRect, flow, container.layout, children, canvasW, canvasH)
  for (const child of children) {
    const rect = flexRects.get(child.id)
    if (!rect) continue
    // 写回 transform（容器局部坐标：flexRects 是画布绝对坐标，须减容器绝对位置——历史漂移坑，
    // 写法与 applyFlexLayout 逐字一致，绝不能写回画布绝对坐标）
    if (!child.transform) child.transform = {}
    child.transform.x = Math.round(rect.x - containerRect.x)
    child.transform.y = Math.round(rect.y - containerRect.y)
    child.transform.width = Math.round(rect.width)
    child.transform.height = Math.round(rect.height)
    // 设为无锚点（父容器局部绝对定位）
    if (!child.anchor) child.anchor = {}
    child.anchor.side = 'None'
  }
}

// 收集所有页面中开排列模式容器的「可见子项 id 序列」（undo/redo 兜底重排的条件判据）。
// 口径与排列一致过滤 basic.visible!==false：可见性切换使序列变化同样触发重排——
// 等效于排列口径的增删（隐藏项本就不参与排列），属预期行为推广而非缺陷。
function collectLayoutChildIds(allPages: Record<string, UiPage>): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const [pageId, page] of Object.entries(allPages ?? {})) {
    if (!page?.root) continue
    const walk = (n: UiNode) => {
      const flow = n.layout?.flowOrientation
      if (flow === 'Vertical' || flow === 'Horizontal' || flow === 'Grid') {
        map.set(`${pageId}::${n.id}`, (n.children ?? []).filter(c => c.basic?.visible !== false).map(c => c.id))
      }
      for (const c of (n.children ?? [])) walk(c)
    }
    walk(page.root)
  }
  return map
}

// undo/redo 兜底重排（决议 7）：比较换入快照前后各布局容器的可见子项 id 序列，
// 仅对序列变化的容器重排（树深度降序：先排内层容器，外层按内层排完的结果测量）。
// - 序列变化 = 被撤销/重做的操作属于增删/顺序/可见性类，携带重排（对自洽快照幂等无害）；
// - children 不变的纯 transform/参数撤销不触发重排：手动摆放位置被忠实还原；
//   「子项集合不变但容器参数被撤销穿越」同样不触发，属预期限制。
// 直接改 draft，不入撤销栈。
function relayoutChangedContainers(s: { allPages: Record<string, UiPage> }, before: Map<string, string[]>): void {
  const after = collectLayoutChildIds(s.allPages)
  const changed = new Set<string>()
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if ((before.get(key) ?? []).join('\u0000') !== (after.get(key) ?? []).join('\u0000')) changed.add(key)
  }
  if (changed.size === 0) return
  for (const [pageId, page] of Object.entries(s.allPages)) {
    if (!page?.root) continue
    const targets: Array<{ id: string; depth: number }> = []
    const walk = (n: UiNode, depth: number) => {
      if (changed.has(`${pageId}::${n.id}`)) targets.push({ id: n.id, depth })
      for (const c of (n.children ?? [])) walk(c, depth + 1)
    }
    walk(page.root, 0)
    if (targets.length === 0) continue
    targets.sort((a, b) => b.depth - a.depth)
    for (const t of targets) applyAutoRelayout(page.root, t.id, page.designWidth, page.designHeight)
  }
}

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    allPages: {},
    activePageId: null,
    page: null,
    pageUnderlays: {},
    setPageUnderlays: (links) => set((s) => { s.pageUnderlays = { ...links } }),
    responsiveVariant: 'base',
    setResponsiveVariant: (variant) => set((s) => { s.responsiveVariant = variant }),
    clearResponsiveOverrides: (nodeId) => {
      get().pushHistory()
      set((s) => {
        if (!s.page?.responsive?.wide.overrides) return
        delete s.page.responsive.wide.overrides[nodeId]
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },
    selectedIds: [],
    selectionAnchor: null,
    undoStack: [],
    redoStack: [],
    pendingHistory: null,
    historyLock: false,

    setAllPages: (pages) => {
      clearHistoryCommitTimer()
      set((s) => {
        // 跨页面允许相同节点 id：运行时按页面加载，选中态已按页面作用域隔离。
        // 不要在加载时改写 id——id 是业务代码按 ID 寻址控件的接线契约。
        s.allPages = pages
        // 自动选第一个
        const ids = Object.keys(pages)
        if (ids.length > 0) {
          s.activePageId = ids[0]
          s.page = pages[ids[0]]
        } else {
          s.activePageId = null
          s.page = null
        }
        s.selectedIds = []
        // 切换/重载工程时先清掉旧工程的编辑器侧车数据，随后 App 会载入新工程的关联。
        s.pageUnderlays = {}
        s.undoStack = []
        s.redoStack = []
        s.pendingHistory = null
      })
    },

    upsertPage: (page) => {
      set((s) => {
        s.allPages[page.pageId] = page
      })
    },

    removePage: (pageId) => {
      set((s) => {
        delete s.allPages[pageId]
        delete s.pageUnderlays[pageId]
        for (const [foregroundId, backgroundId] of Object.entries(s.pageUnderlays)) {
          if (backgroundId === pageId) delete s.pageUnderlays[foregroundId]
        }
        if (s.activePageId === pageId) {
          const ids = Object.keys(s.allPages)
          s.activePageId = ids.length > 0 ? ids[0] : null
          s.page = s.activePageId ? s.allPages[s.activePageId] : null
        }
        s.selectedIds = []
      })
    },

    setActivePage: (pageId) => {
      set((s) => {
        s.activePageId = pageId
        s.page = s.allPages[pageId] ?? null
        s.selectedIds = []
      })
    },

    setPage: (page) => {
      clearHistoryCommitTimer()
      set((s) => {
        if (page) {
          s.allPages[page.pageId] = page
          s.activePageId = page.pageId
          s.page = page
        } else {
          s.page = null
        }
        s.selectedIds = []
        s.undoStack = []
        s.redoStack = []
        s.pendingHistory = null
      })
    },

    updatePageMeta: (pageId, updates) => {
      if (!get().allPages[pageId]) return
      get().queueHistory()
      set((s) => {
        const p = s.allPages[pageId]
        if (p) Object.assign(p, updates)
        if (s.activePageId === pageId && s.page) {
          Object.assign(s.page, updates)
        }
      })
    },

    selectNode: (id, modifier = 'none') => {
      set((s) => {
        if (!s.page) { s.selectedIds = [id]; s.selectionAnchor = id; return }
        if (modifier === 'ctrl') {
          // Ctrl：单点 toggle（Excel 的"追加/取消单个"）
          if (s.selectedIds.includes(id)) {
            s.selectedIds = s.selectedIds.filter(x => x !== id)
          } else {
            // 同父容器约束：与已选不同父则重置为单选该节点
            const newParent = findParent(s.page.root, id)
            const sameParent = newParent && s.selectedIds.every(sid => {
              const p = findParent(s.page!.root, sid)
              return p && p.id === newParent.id
            })
            s.selectedIds = sameParent ? [...s.selectedIds, id] : [id]
          }
          // Ctrl 不更新锚点（保持锚点供下次 Shift 用）
          return
        }
        if (modifier === 'shift') {
          // Shift：从锚点到当前节点的连续范围（同父兄弟）
          const anchor = s.selectionAnchor
          if (!anchor) {
            // 无锚点 → 当作单选
            s.selectedIds = [id]
            s.selectionAnchor = id
            return
          }
          const anchorParent = findParent(s.page.root, anchor)
          const curParent = findParent(s.page.root, id)
          // 锚点与当前节点必须同父，否则重置锚点为当前节点并单选
          if (!anchorParent || !curParent || anchorParent.id !== curParent.id) {
            s.selectedIds = [id]
            s.selectionAnchor = id
            return
          }
          const siblings = anchorParent.children.map(c => c.id)
          const ai = siblings.indexOf(anchor)
          const ci = siblings.indexOf(id)
          if (ai < 0 || ci < 0) { s.selectedIds = [id]; s.selectionAnchor = id; return }
          const [lo, hi] = ai <= ci ? [ai, ci] : [ci, ai]
          s.selectedIds = siblings.slice(lo, hi + 1)
          // Shift 不更新锚点（保持锚点，可反复 Shift 到不同终点）
          return
        }
        // 无修饰：单选 + 设锚点
        s.selectedIds = [id]
        s.selectionAnchor = id
      })
    },

    setSelection: (ids) => {
      set((s) => {
        // 仅保留同父容器内的兄弟节点（多选约束）
        if (!s.page || ids.length <= 1) { s.selectedIds = ids; return }
        let commonParentId: string | null = null
        const kept: string[] = []
        for (const id of ids) {
          const p = findParent(s.page!.root, id)
          if (!p) continue
          if (commonParentId === null) { commonParentId = p.id; kept.push(id) }
          else if (p.id === commonParentId) { kept.push(id) }
          // 不同父的丢弃，保证 selectedIds 始终同父
        }
        s.selectedIds = kept
      })
    },

    clearSelection: () => {
      set((s) => { s.selectedIds = []; s.selectionAnchor = null })
    },

    moveSelection: (dx, dy) => {
      // 批量平移选中节点（整组同一偏移），单次历史记录
      if (dx === 0 && dy === 0) return
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        for (const id of s.selectedIds) {
          const node = findNode(s.page!.root, id)
          if (!node || !node.transform) continue
          // 对基准 x/y 加偏移（拉伸轴下 x/y 是基准值，改了不影响实际位置，但留着无害）
          node.transform.x = Math.round((node.transform.x ?? 0) + dx)
          node.transform.y = Math.round((node.transform.y ?? 0) + dy)
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    pushHistory: () => {
      // 离散操作（拖放、删除等）开始前，先结算正在进行的连续编辑。
      get().commitHistory()
      const state = get()
      if (state.historyLock || !state.page) return
      set((s) => {
        s.undoStack.push(createHistoryEntry(state))
        if (s.undoStack.length > HISTORY_LIMIT) s.undoStack.shift()
        s.redoStack = []
      })
    },

    // 属性输入/滑条等会在一次人工操作中连续触发 onChange：只保留开始前的快照，
    // 停止输入一小段时间后再作为一个撤销步骤提交。
    queueHistory: () => {
      const state = get()
      if (state.historyLock || !state.page) return
      if (!state.pendingHistory) {
        set((s) => { s.pendingHistory = createHistoryEntry(state) })
      }
      clearHistoryCommitTimer()
      historyCommitTimer = setTimeout(() => {
        historyCommitTimer = null
        get().commitHistory()
      }, HISTORY_IDLE_COMMIT_MS)
    },

    commitHistory: () => {
      clearHistoryCommitTimer()
      set((s) => {
        if (!s.pendingHistory) return
        s.undoStack.push(s.pendingHistory)
        if (s.undoStack.length > HISTORY_LIMIT) s.undoStack.shift()
        s.redoStack = []
        s.pendingHistory = null
      })
    },

    addNode: (parentId, node) => {
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        if (parentId === null) {
          s.page.root.children.push(node)
        } else {
          const parent = findNode(s.page.root, parentId)
          if (parent) parent.children.push(node)
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
        s.selectedIds = [node.id]
        // 自动重排：新增子控件后立即排列容器（set 回调尾部执行，与本次新增合并为单步撤销）
        if (parentId !== null) {
          applyAutoRelayout(s.page.root, parentId, s.page.designWidth, s.page.designHeight)
        }
      })
    },

    removeNode: (id) => {
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        // 先记原父（移除后找不到），删除后对其重排（与本次删除合并为单步撤销）
        const origParent = findParent(s.page.root, id)
        removeFromParent(s.page.root, id)
        if (s.activePageId) s.allPages[s.activePageId] = s.page
        s.selectedIds = s.selectedIds.filter(x => x !== id)
        if (origParent) {
          applyAutoRelayout(s.page.root, origParent.id, s.page.designWidth, s.page.designHeight)
        }
      })
    },

    moveNode: (dragId, targetId, position) => {
      // 不允许拖到自己
      if (dragId === targetId) return
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const root = s.page.root
        // 'root' 是 LeftPanel 拖到页面节点时传入的魔法值，统一映射为真实 root id
        const realTargetId = targetId === 'root' ? root.id : targetId
        // 不允许拖到 root 上方（root 是页面根，不可有兄弟）
        if (realTargetId === root.id && position === 'before') return
        // 循环检测：如果 target 是 drag 的子孙，禁止
        const dragNode = findNode(root, dragId)
        if (!dragNode) return
        if (dragId !== realTargetId) {
          const targetInDragSubtree = findNode(dragNode, realTargetId)
          if (targetInDragSubtree) return // 会造成循环
        }

        // === 坐标换算：保持视觉位置不变 ===
        const canvasW = s.page.designWidth
        const canvasH = s.page.designHeight

        // 记录 drag 的原父节点（在移除前判断，用于 inside 时区分「同父移动 vs 跨父移入」）
        const origParent = findParent(root, dragId)
        // 原父节点的绝对矩形（用于坐标换算；recalcOffset 的 oldParentRect 是父矩形而非节点自身矩形）
        const origParentRect = !origParent
          ? { x: 0, y: 0, width: canvasW, height: canvasH }
          : (solveAbsoluteRect(root, origParent.id, canvasW, canvasH)
            ?? { x: 0, y: 0, width: canvasW, height: canvasH })

        // ★ 深拷贝 dragNode（避免 immer draft 引用问题）
        const dragCopy: UiNode = JSON.parse(JSON.stringify(dragNode))

        // 从旧位置移除
        if (!removeFromParent(root, dragId)) return

        // 算出新父节点的绝对矩形（插入前算，因为插入不影响父节点位置）
        let newParentId: string
        if (position === 'inside') {
          newParentId = realTargetId
        } else {
          // before/after：target 的父节点就是新父节点
          const targetParent = findParent(root, realTargetId)
          newParentId = targetParent ? targetParent.id : root.id
        }
        const newParentRect = newParentId === root.id
          ? { x: 0, y: 0, width: canvasW, height: canvasH }
          : solveAbsoluteRect(root, newParentId, canvasW, canvasH)

        // 换算坐标（同父移动时 origParentRect === newParentRect，t.x/y 不变）
        if (newParentRect) {
          recalcOffset(dragCopy, origParentRect, newParentRect, canvasW, canvasH)
        }

        // 插入到新位置（使用拷贝，不是 draft）
        if (position === 'inside') {
          const target = findNode(root, realTargetId)
          if (target) {
            // 落点在父节点本体上时，区分两种语义：
            //   - 同父移动（drag 原本就是 target 的子节点）→ 插到子列表头（换位置）
            //   - 跨父移入（drag 来自别的父）→ 追加到末尾
            const sameParent = origParent?.id === target.id
            if (sameParent) target.children.unshift(dragCopy)
            else target.children.push(dragCopy)
          }
        } else {
          // before/after：找到 target 的父节点，在 children 里定位
          const parent = findParent(root, realTargetId)
          if (!parent) return
          const idx = parent.children.findIndex(c => c.id === realTargetId)
          if (idx < 0) return
          const insertAt = position === 'before' ? idx : idx + 1
          parent.children.splice(insertAt, 0, dragCopy)
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
        // 自动重排：层级拖动改顺序 / 跨容器移动后，对原父与新父各重排一次（同容器去重），
        // 深度降序（内层先排），与本次拖动合并为单步撤销
        const relayoutTargets = new Map<string, number>()
        for (const pid of [origParent?.id, newParentId]) {
          if (!pid) continue
          relayoutTargets.set(pid, (findPath(root, pid)?.length ?? 1) - 1)
        }
        ;[...relayoutTargets.entries()]
          .sort((a, b) => b[1] - a[1])
          .forEach(([pid]) => applyAutoRelayout(root, pid, canvasW, canvasH))
      })
    },

    updateNode: (id, updates) => {
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const node = findNode(s.page.root, id)
        if (node) Object.assign(node, updates)
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    updateNodeField: (id, path, value) => {
      get().queueHistory()
      set((s) => {
        if (!s.page) return
        const node = findNode(s.page.root, id)
        if (!node) return
        if (s.responsiveVariant === 'wide' && s.page.nodeKind === 'window') {
          const responsive = s.page.responsive ??= { wide: { overrides: {} } }
          const map = responsive.wide.overrides[id] ??= {}
          map[path] = value
        } else {
          setNodeFieldValue(node, path, value)
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    batchUpdateNode: (id, updates) => {
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const node = findNode(s.page.root, id)
        if (!node) return
        if (s.responsiveVariant === 'wide' && s.page.nodeKind === 'window') {
          const responsive = s.page.responsive ??= { wide: { overrides: {} } }
          const map = responsive.wide.overrides[id] ??= {}
          for (const [path, value] of Object.entries(updates)) map[path] = value
        } else {
          for (const [path, value] of Object.entries(updates)) {
            setNodeFieldValue(node, path, value)
          }
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    batchUpdateNodes: (updatesById, opts) => {
      if (Object.keys(updatesById).length === 0) return
      // queueHistory：属性面板拖动等连续操作，只留开始前快照，空闲后合并为一个撤销步骤
      if (opts?.queueHistory) get().queueHistory()
      else get().pushHistory()
      set((s) => {
        if (!s.page) return
        for (const [id, updates] of Object.entries(updatesById)) {
          const node = findNode(s.page.root, id)
          if (!node) continue
          if (s.responsiveVariant === 'wide' && s.page.nodeKind === 'window') {
            const responsive = s.page.responsive ??= { wide: { overrides: {} } }
            const map = responsive.wide.overrides[id] ??= {}
            for (const [path, value] of Object.entries(updates)) map[path] = value
          } else {
            for (const [path, value] of Object.entries(updates)) {
              setNodeFieldValue(node, path, value)
            }
          }
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    setAllFonts: (font) => {
      get().pushHistory()
      set((s) => {
        // 遍历所有页面的所有节点，设置 text.font
        for (const pageId of Object.keys(s.allPages)) {
          const pg = s.allPages[pageId]
          function walk(n: UiNode) {
            if (n.text) {
              n.text.font = font
            }
            n.children.forEach(walk)
          }
          walk(pg.root)
        }
        // 同步当前页面
        if (s.page && s.activePageId) {
          s.page = s.allPages[s.activePageId]
        }
      })
    },

    applyFlexLayout: (parentId) => {
      const s0 = get()
      if (!s0.page) return
      const parent = findNode(s0.page.root, parentId)
      if (!parent) return
      const flow = parent.layout?.flowOrientation
      if (flow !== 'Vertical' && flow !== 'Horizontal' && flow !== 'Grid') return

      const canvasW = s0.page.designWidth
      const canvasH = s0.page.designHeight
      // 先算出容器的绝对矩形
      const containerRect = solveAbsoluteRect(s0.page.root, parentId, canvasW, canvasH)
      if (!containerRect) return

      // 排列参数（Grid/padding/内容对齐/childOrder/spacing 二元组）全部从 layout 读取，
      // 语义在 solveChildrenFlex → arrangeChildren（JS/C# 双端唯一权威算法）
      // 不可见子项不参与 Flex 布局测量（对齐 Runtime 行为）
      const children = parent.children.filter(c => c.basic?.visible !== false)
      const flexRects = solveChildrenFlex(containerRect, flow, parent.layout, children, canvasW, canvasH)

      get().pushHistory()
      set((s) => {
        if (!s.page) return
        for (const child of children) {
          const rect = flexRects.get(child.id)
          if (!rect) continue
          const node = findNode(s.page!.root, child.id)
          if (!node) continue
          // 写回 transform（父容器局部坐标：side=None 语义是 ref.x + t.x，见 layoutSolver；
          // flexRects 是画布绝对坐标，须减去容器绝对位置，否则子控件整体多偏一个容器偏移）
          if (!node.transform) node.transform = {}
          node.transform.x = Math.round(rect.x - containerRect.x)
          node.transform.y = Math.round(rect.y - containerRect.y)
          node.transform.width = Math.round(rect.width)
          node.transform.height = Math.round(rect.height)
          // 设为无锚点（父容器局部绝对定位）
          if (!node.anchor) node.anchor = {}
          node.anchor.side = 'None'
        }
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    duplicateNode: (id) => {
      // ★ 在 immer 外获取节点并深拷贝（避免 draft 引用问题）
      const state = get()
      if (!state.page) return
      const orig = findNode(state.page.root, id)
      if (!orig) return
      const cloned = cloneWithNewIds(orig)
      // 偏移 +20,+20
      if (cloned.transform) {
        cloned.transform.x = (cloned.transform.x ?? 0) + 20
        cloned.transform.y = (cloned.transform.y ?? 0) + 20
      }
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const root = s.page.root
        // 插入到同级（原节点后面）
        const parent = findParent(root, id)
        if (parent) {
          const idx = parent.children.findIndex(c => c.id === id)
          parent.children.splice(idx + 1, 0, cloned)
        } else {
          root.children.push(cloned)
        }
        s.selectedIds = [cloned.id]
        if (s.activePageId) s.allPages[s.activePageId] = s.page
        // 自动重排：复制新增子控件后重排父容器（与本次复制合并为单步撤销）
        applyAutoRelayout(root, parent ? parent.id : root.id, s.page.designWidth, s.page.designHeight)
      })
    },

    pasteNode: (targetId) => {
      const clip = getClipboard()
      if (!clip) return
      const cloned = cloneWithNewIds(clip)
      // 偏移 +20,+20
      if (cloned.transform) {
        cloned.transform.x = (cloned.transform.x ?? 0) + 20
        cloned.transform.y = (cloned.transform.y ?? 0) + 20
      }
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const root = s.page.root
        if (targetId) {
          // 插入到 targetId 的同级后面
          const parent = findParent(root, targetId)
          if (parent) {
            const idx = parent.children.findIndex(c => c.id === targetId)
            parent.children.splice(idx + 1, 0, cloned)
          } else {
            root.children.push(cloned)
          }
        } else {
          // 没有选中，插入到 root
          root.children.push(cloned)
        }
        s.selectedIds = [cloned.id]
        if (s.activePageId) s.allPages[s.activePageId] = s.page
        // 自动重排：粘贴新增子控件后重排父容器（与本次粘贴合并为单步撤销）
        const relayoutParent = targetId ? (findParent(root, cloned.id)?.id ?? root.id) : root.id
        applyAutoRelayout(root, relayoutParent, s.page.designWidth, s.page.designHeight)
      })
    },

    undo: () => {
      get().commitHistory()
      set((s) => {
        if (s.undoStack.length === 0 || !s.page) return
        const entry = s.undoStack.pop()!
        // 兜底重排判据：换入快照前先取当前各布局容器的可见子项 id 序列
        // （redo 快照在重排发生前压入，不会被重排结果污染）
        const before = collectLayoutChildIds(s.allPages)
        s.redoStack.push({
          allPages: clonePages(s.allPages),
          activePageId: s.activePageId,
          selectedIds: [...s.selectedIds],
          selectionAnchor: s.selectionAnchor,
        })
        s.allPages = entry.allPages
        s.activePageId = entry.activePageId
        s.page = entry.activePageId ? entry.allPages[entry.activePageId] ?? null : null
        s.selectedIds = entry.selectedIds
        s.selectionAnchor = entry.selectionAnchor
        // 撤销后的兜底重排：仅子项序列变化的容器重排，直接改 draft 不入撤销栈（决议 7）
        relayoutChangedContainers(s, before)
      })
    },

    redo: () => {
      get().commitHistory()
      set((s) => {
        if (s.redoStack.length === 0 || !s.page) return
        const entry = s.redoStack.pop()!
        // 同 undo：换入前取判据，undo 快照在重排发生前压入
        const before = collectLayoutChildIds(s.allPages)
        s.undoStack.push({
          allPages: clonePages(s.allPages),
          activePageId: s.activePageId,
          selectedIds: [...s.selectedIds],
          selectionAnchor: s.selectionAnchor,
        })
        s.allPages = entry.allPages
        s.activePageId = entry.activePageId
        s.page = entry.activePageId ? entry.allPages[entry.activePageId] ?? null : null
        s.selectedIds = entry.selectedIds
        s.selectionAnchor = entry.selectionAnchor
        // 重做后的兜底重排：同 undo 口径，不入撤销栈
        relayoutChangedContainers(s, before)
      })
    },
  }))
)

// 辅助：创建新节点
let nodeCounter = 0
let defaultButtonSoundId: string | null = null
let defaultFontForNew: string | null = null  // 新建控件的预填字体（来自全局默认字体）

export function setDefaultButtonSoundId(id: string | null) {
  defaultButtonSoundId = id
}

export function setDefaultFontForNew(font: string | null) {
  defaultFontForNew = font
}

export function createNode(starType: string, label: string): UiNode {
  const def = COMPONENT_LIBRARY.find(c => c.label === label || c.starType === starType)
  const id = `${starType.toLowerCase()}_${Date.now()}_${++nodeCounter}`
  const node: UiNode = {
    id,
    name: label,
    children: [],
    ...JSON.parse(JSON.stringify(def?.defaultProps ?? { starType: starType as UiNode['starType'] })),
  }
  // 模板内子节点 id 为占位符时，递归重分配（保证多实例 id 唯一）
  const reassignChildIds = (n: UiNode) => {
    n.children.forEach(c => {
      nodeCounter++
      c.id = `${c.starType.toLowerCase()}_${Date.now()}_${nodeCounter}`
      reassignChildIds(c)
    })
  }
  reassignChildIds(node)
  if (node.starType === 'Button' && defaultButtonSoundId) {
    node.djui = { ...(node.djui ?? {}), clickSoundId: defaultButtonSoundId }
  }
  // 带文字的控件预填全局默认字体（这样导出的 JSON 每个控件都明确指向字体，引擎无需回退层）
  if (node.text && defaultFontForNew && !node.text.font) {
    node.text.font = defaultFontForNew
  }
  return node
}

export { findNode, findParent }

// === 剪贴板（模块级，不参与 React state）===
let clipboardNode: UiNode | null = null
export function getClipboard() { return clipboardNode }
export function setClipboard(node: UiNode | null) { clipboardNode = node }

// 递归克隆节点并为每个节点生成新 ID
let cloneCounter = 0
export function cloneWithNewIds(node: UiNode): UiNode {
  const cloned: UiNode = JSON.parse(JSON.stringify(node))
  const reassignIds = (n: UiNode) => {
    cloneCounter++
    n.id = `${n.starType.toLowerCase()}_${Date.now()}_${cloneCounter}`
    n.children.forEach(reassignIds)
  }
  reassignIds(cloned)
  return cloned
}

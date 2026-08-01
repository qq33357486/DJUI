import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { UiNode, UiPage, COMPONENT_LIBRARY } from '@/types/layout'
import { solveLayout, Rect as LayoutRect, solveChildrenFlex } from '@/utils/layoutSolver'
import { getAnchorSide, DEFAULT_ANCHOR_SIDE } from '@/utils/anchorPresets'

// 撤销/重做栈
interface HistoryEntry {
  root: UiNode
}

interface EditorState {
  // 所有页面（pageId → UiPage）
  allPages: Record<string, UiPage>
  // 当前编辑的页面 ID
  activePageId: string | null
  // 当前编辑的页面（allPages[activePageId] 的引用，为兼容保留）
  page: UiPage | null

  // 选中
  selectedIds: string[]
  // 选择锚点（最近一次单选/范围选的起点节点 id，供 Shift 连续范围选择）
  selectionAnchor: string | null

  // 撤销重做
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
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

  pushHistory: () => void
  undo: () => void
  redo: () => void
}

function cloneNode(node: UiNode): UiNode {
  return JSON.parse(JSON.stringify(node))
}

// 全局 id 去重：保证 allPages 内所有节点 id 跨页面唯一。
// 背景：磁盘 JSON 可能因复制文件/外部脚本产生重复 id，
// 而 selectedIds 是全局数组（按 id 匹配），重复 id 会导致
// 点击某个节点时其它页面同 id 节点也被误判为选中。
let dedupeCounter = 0
function dedupeNodeIdsAcrossPages(allPages: Record<string, UiPage>): void {
  const seen = new Set<string>()
  for (const page of Object.values(allPages)) {
    const reassign = (n: UiNode) => {
      if (seen.has(n.id)) {
        // 冲突：重新分配带 pageId 前缀的新 id，保证唯一
        dedupeCounter++
        n.id = `${page.pageId}_${n.id}_${dedupeCounter}`
        seen.add(n.id)
      } else {
        seen.add(n.id)
      }
      n.children.forEach(reassign)
    }
    reassign(page.root)
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

  if (sideId === 'None' || anchorTarget === 'none' || !side) {
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

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    allPages: {},
    activePageId: null,
    page: null,
    selectedIds: [],
    selectionAnchor: null,
    undoStack: [],
    redoStack: [],
    historyLock: false,

    setAllPages: (pages) => {
      set((s) => {
        // 数据卫生：保证加载进内存的节点 id 跨页面唯一（修复跨页面同 id 误选中）
        dedupeNodeIdsAcrossPages(pages)
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
        s.undoStack = []
        s.redoStack = []
      })
    },

    upsertPage: (page) => {
      set((s) => {
        // 与已有页面合并后去重，防止新加载页面与内存中其它页面 id 撞车
        const merged = { ...s.allPages, [page.pageId]: page }
        dedupeNodeIdsAcrossPages(merged)
        s.allPages[page.pageId] = merged[page.pageId]
      })
    },

    removePage: (pageId) => {
      set((s) => {
        delete s.allPages[pageId]
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
        s.undoStack = []
        s.redoStack = []
      })
    },

    setPage: (page) => {
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
      })
    },

    updatePageMeta: (pageId, updates) => {
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
      const state = get()
      if (state.historyLock || !state.page) return
      set((s) => {
        s.undoStack.push({ root: cloneNode(s.page!.root) })
        if (s.undoStack.length > 50) s.undoStack.shift()
        s.redoStack = []
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
      })
    },

    removeNode: (id) => {
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        removeFromParent(s.page.root, id)
        if (s.activePageId) s.allPages[s.activePageId] = s.page
        s.selectedIds = s.selectedIds.filter(x => x !== id)
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
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const node = findNode(s.page.root, id)
        if (!node) return
        const parts = path.split('.')
        let target: any = node
        for (let i = 0; i < parts.length - 1; i++) {
          if (!target[parts[i]]) target[parts[i]] = {}
          target = target[parts[i]]
        }
        target[parts[parts.length - 1]] = value
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    batchUpdateNode: (id, updates) => {
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const node = findNode(s.page.root, id)
        if (!node) return
        for (const [path, value] of Object.entries(updates)) {
          const parts = path.split('.')
          let target: any = node
          for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]]) target[parts[i]] = {}
            target = target[parts[i]]
          }
          target[parts[parts.length - 1]] = value
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
      if (flow !== 'Vertical' && flow !== 'Horizontal') return

      const canvasW = s0.page.designWidth
      const canvasH = s0.page.designHeight
      // 先算出容器的绝对矩形
      const containerRect = solveAbsoluteRect(s0.page.root, parentId, canvasW, canvasH)
      if (!containerRect) return

      const spacing = parent.layout?.spacing ?? 0
      const children = parent.children.filter(c => !c.editorHidden)
      const flexRects = solveChildrenFlex(containerRect, flow, spacing, children, canvasW, canvasH)

      get().pushHistory()
      set((s) => {
        if (!s.page) return
        for (const child of children) {
          const rect = flexRects.get(child.id)
          if (!rect) continue
          const node = findNode(s.page!.root, child.id)
          if (!node) continue
          // 写回 transform（绝对坐标）
          if (!node.transform) node.transform = {}
          node.transform.x = Math.round(rect.x)
          node.transform.y = Math.round(rect.y)
          node.transform.width = Math.round(rect.width)
          node.transform.height = Math.round(rect.height)
          // 设为无锚点（纯绝对定位）
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
      })
    },

    undo: () => {
      set((s) => {
        if (s.undoStack.length === 0 || !s.page) return
        const entry = s.undoStack.pop()!
        s.redoStack.push({ root: cloneNode(s.page.root) })
        s.page.root = entry.root
        if (s.activePageId) s.allPages[s.activePageId] = s.page
      })
    },

    redo: () => {
      set((s) => {
        if (s.redoStack.length === 0 || !s.page) return
        const entry = s.redoStack.pop()!
        s.undoStack.push({ root: cloneNode(s.page.root) })
        s.page.root = entry.root
        if (s.activePageId) s.allPages[s.activePageId] = s.page
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

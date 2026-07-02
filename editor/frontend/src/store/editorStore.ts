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
  selectNode: (id: string, additive?: boolean) => void
  clearSelection: () => void

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
function findPath(root: UiNode, targetId: string): UiNode[] | null {
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
    undoStack: [],
    redoStack: [],
    historyLock: false,

    setAllPages: (pages) => {
      set((s) => {
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
        s.allPages[page.pageId] = page
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

    selectNode: (id, additive = false) => {
      set((s) => {
        if (additive) {
          if (s.selectedIds.includes(id)) {
            s.selectedIds = s.selectedIds.filter(x => x !== id)
          } else {
            s.selectedIds.push(id)
          }
        } else {
          s.selectedIds = [id]
        }
      })
    },

    clearSelection: () => {
      set((s) => { s.selectedIds = [] })
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
      // 不允许拖到 root（root 不可移动）
      if (targetId === 'root' && position === 'before') return
      get().pushHistory()
      set((s) => {
        if (!s.page) return
        const root = s.page.root
        // 循环检测：如果 target 是 drag 的子孙，禁止
        const dragNode = findNode(root, dragId)
        if (!dragNode) return
        if (dragId !== targetId) {
          const targetInDragSubtree = findNode(dragNode, targetId)
          if (targetInDragSubtree) return // 会造成循环
        }

        // === 坐标换算：保持视觉位置不变 ===
        const canvasW = s.page.designWidth
        const canvasH = s.page.designHeight

        // 算出拖动节点的当前绝对矩形
        const dragAbsRect = solveAbsoluteRect(root, dragId, canvasW, canvasH)

        // ★ 深拷贝 dragNode（避免 immer draft 引用问题）
        const dragCopy: UiNode = JSON.parse(JSON.stringify(dragNode))

        // 从旧位置移除
        if (!removeFromParent(root, dragId)) return

        // 算出新父节点的绝对矩形（插入前算，因为插入不影响父节点位置）
        let newParentId: string
        if (position === 'inside') {
          newParentId = targetId
        } else {
          // before/after：target 的父节点就是新父节点
          const targetParent = findParent(root, targetId)
          newParentId = targetParent ? targetParent.id : 'root'
        }
        const newParentRect = newParentId === 'root'
          ? { x: 0, y: 0, width: canvasW, height: canvasH }
          : solveAbsoluteRect(root, newParentId, canvasW, canvasH)

        // 换算坐标
        if (dragAbsRect && newParentRect) {
          recalcOffset(dragCopy, dragAbsRect, newParentRect, canvasW, canvasH)
        }

        // 插入到新位置（使用拷贝，不是 draft）
        if (position === 'inside') {
          const target = findNode(root, targetId)
          if (target) target.children.push(dragCopy)
        } else {
          // before/after：找到 target 的父节点，在 children 里定位
          const parent = findParent(root, targetId)
          if (!parent) return
          const idx = parent.children.findIndex(c => c.id === targetId)
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

export function setDefaultButtonSoundId(id: string | null) {
  defaultButtonSoundId = id
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
  if (node.starType === 'Button' && defaultButtonSoundId) {
    node.djui = { ...(node.djui ?? {}), clickSoundId: defaultButtonSoundId }
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

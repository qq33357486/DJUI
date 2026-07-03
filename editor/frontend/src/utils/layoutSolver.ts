// 布局解析引擎（NGUI 风格：锚点管位置，拉伸管大小）
//
// anchor.side (9-way) → 决定控件位置基准
// stretch.style (None/H/V/Both) → 决定控件尺寸是否跟随父级
// aspectRatio → 比例约束（最后应用）
//
// 坐标约定：屏幕坐标，Y 朝下，原点在父矩形左上角。

import { UiNode } from '@/types/layout'
import { ANCHOR_SIDES, getAnchorSide, DEFAULT_ANCHOR_SIDE, DEFAULT_PIVOT } from '@/utils/anchorPresets'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SolvedLayout {
  rect: Rect
  pivotX: number
  pivotY: number
}

export interface AutoSizeAxes {
  width: boolean
  height: boolean
}

export interface AutoSizeConflict {
  nodeId: string
  nodeName?: string
  axis: 'width' | 'height'
  reason: string
}

interface SolveContext {
  measuring?: Set<string>
}

// 主入口：解析单个节点的最终布局
export function solveLayout(
  node: UiNode,
  parent: Rect,
  canvasWidth: number,
  canvasHeight: number,
  context: SolveContext = {}
): SolvedLayout {
  const t = node.transform ?? {}
  const anchor = node.anchor ?? {}
  const stretch = node.stretch ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const side = getAnchorSide(sideId) ?? ANCHOR_SIDES[0] // TopLeft
  const pivot = t.pivot ?? DEFAULT_PIVOT
  const stretchStyle = stretch.style ?? 'None'
  const margins = stretch.margins ?? { left: 0, right: 0, top: 0, bottom: 0 }

  // 1. 参考矩形
  const ref = target === 'screen'
    ? { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
    : parent

  // === 无锚点：纯绝对定位 ===
  if (sideId === 'None' || target === 'none') {
    let rect: Rect = {
      x: t.x ?? 0,
      y: t.y ?? 0,
      width: t.width ?? 100,
      height: t.height ?? 100,
    }
    // 拉伸仍生效（基于父矩形）
    const stretchStyle = stretch.style ?? 'None'
    const margins = stretch.margins ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const hStretch = stretchStyle === 'Horizontal' || stretchStyle === 'Both'
    const vStretch = stretchStyle === 'Vertical' || stretchStyle === 'Both'
    if (hStretch) {
      rect.width = Math.max(0, ref.width - margins.left - margins.right)
      rect.x = ref.x + margins.left
    }
    if (vStretch) {
      rect.height = Math.max(0, ref.height - margins.top - margins.bottom)
      rect.y = ref.y + margins.top
    }
    // AspectRatio
    const ar2 = node.aspectRatio
    rect = applyAspectRatio(rect, ar2?.mode, ar2?.ratio, ref, pivot)
    rect = applyAutoSize(node, rect, parent, canvasWidth, canvasHeight, {
      sideId,
      target,
      sideNx: side.nx,
      sideNy: side.ny,
      hStretch,
      vStretch,
    }, context)
    const pivotX = rect.x + pivot.x * rect.width
    const pivotY = rect.y + pivot.y * rect.height
    return { rect, pivotX, pivotY }
  }

  // 2. 计算锚点位置（屏幕坐标）
  // nx: 0=左 0.5=中 1=右 → 屏幕 X
  // ny: uGUI Y 朝上（0=底 1=顶）→ 屏幕 Y（翻转）
  const anchorX = ref.x + side.nx * ref.width
  const anchorY = ref.y + (1 - side.ny) * ref.height

  // 3. 按轴独立处理
  let x: number, y: number, w: number, h: number

  // --- 水平轴 ---
  const hStretch = stretchStyle === 'Horizontal' || stretchStyle === 'Both'
  if (hStretch) {
    w = Math.max(0, ref.width - margins.left - margins.right)
    x = ref.x + margins.left
  } else {
    w = t.width ?? 100
    // 锚点对齐：控件的对应点（由 side.nx 决定）贴到锚点位置 + 偏移
    x = anchorX + (t.x ?? 0) - side.nx * w
  }

  // --- 垂直轴 ---
  const vStretch = stretchStyle === 'Vertical' || stretchStyle === 'Both'
  if (vStretch) {
    h = Math.max(0, ref.height - margins.top - margins.bottom)
    y = ref.y + margins.top
  } else {
    h = t.height ?? 100
    y = anchorY + (t.y ?? 0) - (1 - side.ny) * h
  }

  let rect: Rect = { x, y, width: w, height: h }

  // 4. 应用 AspectRatio（保留原有逻辑）
  const ar2 = node.aspectRatio
  rect = applyAspectRatio(rect, ar2?.mode, ar2?.ratio, ref, pivot)
  rect = applyAutoSize(node, rect, parent, canvasWidth, canvasHeight, {
    sideId,
    target,
    sideNx: side.nx,
    sideNy: side.ny,
    hStretch,
    vStretch,
  }, context)

  // 5. Pivot 屏幕坐标
  const pivotX = rect.x + pivot.x * rect.width
  const pivotY = rect.y + pivot.y * rect.height

  return { rect, pivotX, pivotY }
}

// 应用 AspectRatio 到矩形（与之前相同）
function applyAspectRatio(
  rect: Rect,
  mode: string | undefined,
  ratio: number | undefined,
  parent: Rect,
  pivot: { x: number; y: number }
): Rect {
  if (!mode || mode === 'None' || !ratio || ratio <= 0) return rect

  const r = ratio

  if (mode === 'WidthControlsHeight') {
    const newH = rect.width / r
    const cy = rect.y + pivot.y * rect.height
    return { x: rect.x, y: cy - pivot.y * newH, width: rect.width, height: newH }
  }

  if (mode === 'HeightControlsWidth') {
    const newW = rect.height * r
    const cx = rect.x + pivot.x * rect.width
    return { x: cx - pivot.x * newW, y: rect.y, width: newW, height: rect.height }
  }

  if (mode === 'FitInParent') {
    const scaleW = parent.width / rect.width
    const scaleH = parent.height / rect.height
    const s = Math.min(scaleW, scaleH)
    const newW = rect.width * s
    const newH = rect.height * s
    const cx = parent.x + pivot.x * parent.width
    const cy = parent.y + pivot.y * parent.height
    return { x: cx - pivot.x * newW, y: cy - pivot.y * newH, width: newW, height: newH }
  }

  if (mode === 'EnvelopeParent') {
    const scaleW = parent.width / rect.width
    const scaleH = parent.height / rect.height
    const s = Math.max(scaleW, scaleH)
    const newW = rect.width * s
    const newH = rect.height * s
    const cx = parent.x + pivot.x * parent.width
    const cy = parent.y + pivot.y * parent.height
    return { x: cx - pivot.x * newW, y: cy - pivot.y * newH, width: newW, height: newH }
  }

  return rect
}

export function getAutoSizeAxes(node: UiNode): AutoSizeAxes {
  const mode = node.layout?.autoSize ?? 'None'
  return {
    width: mode === 'Width' || mode === 'Both',
    height: mode === 'Height' || mode === 'Both',
  }
}

export function collectAutoSizeConflicts(node: UiNode): AutoSizeConflict[] {
  const result: AutoSizeConflict[] = []
  collectAutoSizeConflictsInner(node, result)
  return result
}

function collectAutoSizeConflictsInner(node: UiNode, result: AutoSizeConflict[]) {
  const axes = getAutoSizeAxes(node)
  if (axes.width || axes.height) {
    const selfStretch = node.stretch?.style ?? 'None'
    if (axes.width && stretchUsesAxis(selfStretch, 'width')) {
      result.push({ nodeId: node.id, nodeName: node.name, axis: 'width', reason: '自身水平拉伸会覆盖自动宽' })
    }
    if (axes.height && stretchUsesAxis(selfStretch, 'height')) {
      result.push({ nodeId: node.id, nodeName: node.name, axis: 'height', reason: '自身垂直拉伸会覆盖自动高' })
    }

    for (const child of node.children) {
      if (!isNodeVisibleForLayout(child)) continue
      if (axes.width) {
        const reason = getChildAutoSizeConflict(child, 'width')
        if (reason) result.push({ nodeId: child.id, nodeName: child.name, axis: 'width', reason })
      }
      if (axes.height) {
        const reason = getChildAutoSizeConflict(child, 'height')
        if (reason) result.push({ nodeId: child.id, nodeName: child.name, axis: 'height', reason })
      }
    }
  }

  for (const child of node.children) collectAutoSizeConflictsInner(child, result)
}

function applyAutoSize(
  node: UiNode,
  baseRect: Rect,
  _parent: Rect,
  canvasWidth: number,
  canvasHeight: number,
  anchorInfo: { sideId: string; target: string; sideNx: number; sideNy: number; hStretch: boolean; vStretch: boolean },
  context: SolveContext,
): Rect {
  const axes = getAutoSizeAxes(node)
  if (!axes.width && !axes.height) return baseRect

  const measuring = context.measuring ?? new Set<string>()
  if (measuring.has(node.id)) return baseRect

  const blockedWidth = axes.width && (
    anchorInfo.hStretch ||
    node.children.some(child => isNodeVisibleForLayout(child) && !!getChildAutoSizeConflict(child, 'width'))
  )
  const blockedHeight = axes.height && (
    anchorInfo.vStretch ||
    node.children.some(child => isNodeVisibleForLayout(child) && !!getChildAutoSizeConflict(child, 'height'))
  )

  if ((axes.width && !blockedWidth) || (axes.height && !blockedHeight)) {
    measuring.add(node.id)
  } else {
    return baseRect
  }

  try {
    const measured = measureChildrenBounds(node, baseRect, canvasWidth, canvasHeight, { measuring })
    if (!measured) return baseRect

    let nextWidth = baseRect.width
    let nextHeight = baseRect.height

    if (axes.width && !blockedWidth) {
      nextWidth = Math.max(1, measured.width)
    }
    if (axes.height && !blockedHeight) {
      nextHeight = Math.max(1, measured.height)
    }

    if (nextWidth === baseRect.width && nextHeight === baseRect.height) return baseRect

    let nextX = baseRect.x
    let nextY = baseRect.y
    if (anchorInfo.sideId !== 'None' && anchorInfo.target !== 'none') {
      nextX -= anchorInfo.sideNx * (nextWidth - baseRect.width)
      nextY -= (1 - anchorInfo.sideNy) * (nextHeight - baseRect.height)
    }

    return { x: nextX, y: nextY, width: nextWidth, height: nextHeight }
  } finally {
    measuring.delete(node.id)
  }
}

function measureChildrenBounds(
  node: UiNode,
  containerRect: Rect,
  canvasWidth: number,
  canvasHeight: number,
  context: SolveContext,
): { width: number; height: number } | null {
  const visibleChildren = node.children.filter(isNodeVisibleForLayout)
  if (visibleChildren.length === 0) return null

  let hasBounds = false
  let maxRight = 0
  let maxBottom = 0

  for (const child of visibleChildren) {
    const childRect = solveLayout(child, containerRect, canvasWidth, canvasHeight, context).rect
    const localRight = childRect.x - containerRect.x + childRect.width
    const localBottom = childRect.y - containerRect.y + childRect.height
    if (Number.isFinite(localRight) && Number.isFinite(localBottom)) {
      maxRight = Math.max(maxRight, localRight)
      maxBottom = Math.max(maxBottom, localBottom)
      hasBounds = true
    }
  }

  if (!hasBounds) return null

  const padding = node.layout?.padding ?? [0, 0, 0, 0]
  const paddingRight = padding[2] ?? 0
  const paddingBottom = padding[3] ?? 0

  return {
    width: Math.ceil(Math.max(0, maxRight + paddingRight)),
    height: Math.ceil(Math.max(0, maxBottom + paddingBottom)),
  }
}

function getChildAutoSizeConflict(child: UiNode, axis: 'width' | 'height'): string | null {
  const anchor = child.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const stretchStyle = child.stretch?.style ?? 'None'

  if (target === 'screen') return '锚定到屏幕，尺寸不属于父容器内容流'
  if (stretchUsesAxis(stretchStyle, axis)) return axis === 'width' ? '水平拉伸依赖父宽' : '垂直拉伸依赖父高'
  if (sideId === 'None' || target === 'none') return null

  const side = getAnchorSide(sideId)
  if (!side) return null
  if (axis === 'width' && side.nx !== 0) return '水平中/右锚点依赖父宽'
  if (axis === 'height' && side.ny !== 1) return '垂直中/底锚点依赖父高'
  return null
}

function stretchUsesAxis(style: string | undefined, axis: 'width' | 'height') {
  if (axis === 'width') return style === 'Horizontal' || style === 'Both'
  return style === 'Vertical' || style === 'Both'
}

function isNodeVisibleForLayout(node: UiNode) {
  return !node.editorHidden && node.basic?.visible !== false
}

/**
 * 计算容器内所有子控件的 Flex 布局位置。
 * 当容器设置了 flowOrientation 时，子控件按堆叠方向自动排列。
 */
export function solveChildrenFlex(
  containerRect: Rect,
  flowOrientation: 'Vertical' | 'Horizontal',
  spacing: number,
  children: UiNode[],
  canvasW: number,
  canvasH: number
): Map<string, Rect> {
  const result = new Map<string, Rect>()
  if (!children || children.length === 0) return result

  // padding（从容器 layout 读取，简化为 0）
  const padX = 0
  const padY = 0
  const innerX = containerRect.x + padX
  const innerY = containerRect.y + padY
  const innerW = containerRect.width - padX * 2
  const innerH = containerRect.height - padY * 2

  if (flowOrientation === 'Vertical') {
    // 垂直堆叠：每个子控件先按自身尺寸算，剩余空间按 heightStretchRatio 分配
    const totalSpacing = spacing * (children.length - 1)
    let availH = innerH - totalSpacing

    // 第一遍：算出固定高度和需要 flex 的
    const heights: number[] = []
    let fixedH = 0
    let totalGrow = 0
    for (const child of children) {
      const grow = child.heightStretchRatio ?? 0
      const t = child.transform ?? {}
      if (grow > 0) {
        heights.push(-1) // 待定
        totalGrow += grow
      } else {
        const h = t.height ?? 50
        heights.push(h)
        fixedH += h
      }
    }

    // 分配 flex 空间
    const freeH = Math.max(0, availH - fixedH)
    for (let i = 0; i < children.length; i++) {
      if (heights[i] === -1) {
        const grow = children[i].heightStretchRatio ?? 0
        heights[i] = totalGrow > 0 ? (freeH * grow / totalGrow) : 0
      }
    }

    // 排列
    let curY = innerY
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const wGrow = child.widthStretchRatio ?? 0
      const w = wGrow > 0 ? innerW : (child.transform?.width ?? 100)
      result.set(child.id, { x: innerX, y: curY, width: w, height: heights[i] })
      curY += heights[i] + spacing
    }
  } else {
    // 水平堆叠
    const totalSpacing = spacing * (children.length - 1)
    let availW = innerW - totalSpacing

    const widths: number[] = []
    let fixedW = 0
    let totalGrow = 0
    for (const child of children) {
      const grow = child.widthStretchRatio ?? 0
      const t = child.transform ?? {}
      if (grow > 0) {
        widths.push(-1)
        totalGrow += grow
      } else {
        const w = t.width ?? 100
        widths.push(w)
        fixedW += w
      }
    }

    const freeW = Math.max(0, availW - fixedW)
    for (let i = 0; i < children.length; i++) {
      if (widths[i] === -1) {
        const grow = children[i].widthStretchRatio ?? 0
        widths[i] = totalGrow > 0 ? (freeW * grow / totalGrow) : 0
      }
    }

    let curX = innerX
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const hGrow = child.heightStretchRatio ?? 0
      const h = hGrow > 0 ? innerH : (child.transform?.height ?? 100)
      result.set(child.id, { x: curX, y: innerY, width: widths[i], height: h })
      curX += widths[i] + spacing
    }
  }

  return result
}

// 布局解析引擎（NGUI 风格：锚点管位置，拉伸管大小）
//
// anchor.side (9-way) → 决定控件位置基准
// stretch.style (None/H/V/Both) → 决定控件尺寸是否跟随父级
// aspectRatio → 比例约束（最后应用）
//
// 坐标约定：屏幕坐标，Y 朝下，原点在父矩形左上角。

import { UiNode, DjuiLayout } from '@/types/layout'
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
  safeRect?: Rect
  imageFrame?: Rect  // 背景图帧(cover 缩放后的完整图矩形),target='image' 时作参考系
}

// 当前页面级背景图帧(编辑器单例:CanvasArea 渲染前设置,solveLayout 未显式传 imageFrame 时读取)
let currentImageFrame: Rect | null = null
export function setCurrentImageFrame(rect: Rect | null): void { currentImageFrame = rect }
export function getCurrentImageFrame(): Rect | null { return currentImageFrame }

function selectSafeEdges(canvas: Rect, safe: Rect, edges?: Array<'left' | 'top' | 'right' | 'bottom'>): Rect {
  const selected = edges ?? ['left', 'top', 'right', 'bottom']
  const left = selected.includes('left') ? safe.x - canvas.x : 0
  const top = selected.includes('top') ? safe.y - canvas.y : 0
  const right = selected.includes('right') ? canvas.x + canvas.width - safe.x - safe.width : 0
  const bottom = selected.includes('bottom') ? canvas.y + canvas.height - safe.y - safe.height : 0
  return { x: canvas.x + left, y: canvas.y + top, width: Math.max(0, canvas.width - left - right), height: Math.max(0, canvas.height - top - bottom) }
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
  const canvasRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  const ref = target === 'screen'
    ? canvasRect
    : target === 'safe'
      ? selectSafeEdges(canvasRect, context.safeRect ?? canvasRect, anchor.safeEdges)
      : target === 'image'
        ? (context.imageFrame ?? currentImageFrame ?? canvasRect)
        : parent

  // === 无锚点：父容器局部绝对定位（与 Runtime SolveV6 对齐：ref.X + t.x）===
  if (sideId === 'None') {
    let rect: Rect = {
      x: ref.x + (t.x ?? 0),
      y: ref.y + (t.y ?? 0),
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
        const reason = getChildAutoSizeConflict(child, 'width', node.layout?.flowOrientation)
        if (reason) result.push({ nodeId: child.id, nodeName: child.name, axis: 'width', reason })
      }
      if (axes.height) {
        const reason = getChildAutoSizeConflict(child, 'height', node.layout?.flowOrientation)
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
    node.children.some(child => isNodeVisibleForLayout(child) && !!getChildAutoSizeConflict(child, 'width', node.layout?.flowOrientation))
  )
  const blockedHeight = axes.height && (
    anchorInfo.vStretch ||
    node.children.some(child => isNodeVisibleForLayout(child) && !!getChildAutoSizeConflict(child, 'height', node.layout?.flowOrientation))
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

  // 布局模式（Vertical/Horizontal/Grid）：autoSize 按排列后的内容边界计算（含 padding 与 spacing），
  // 不再逐子 solveLayout；测量时强制贴起点对齐（内容对齐偏移属于摆放策略，不应放大容器自然尺寸）
  const flow = node.layout?.flowOrientation
  if (flow === 'Vertical' || flow === 'Horizontal' || flow === 'Grid') {
    const params = buildArrangeParams(node.layout, flow, true)
    const items = visibleChildren.map(child => arrangeItemFromNode(child, flow))
    const arranged = arrangeChildren(containerRect.width, containerRect.height, params, items)
    if (arranged.length === 0) return null
    let maxRight = 0
    let maxBottom = 0
    for (const r of arranged) {
      const right = r.x + r.width
      const bottom = r.y + r.height
      if (Number.isFinite(right) && Number.isFinite(bottom)) {
        maxRight = Math.max(maxRight, right)
        maxBottom = Math.max(maxBottom, bottom)
      }
    }
    return {
      width: Math.ceil(Math.max(0, maxRight + params.padRight)),
      height: Math.ceil(Math.max(0, maxBottom + params.padBottom)),
    }
  }

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

function getChildAutoSizeConflict(child: UiNode, axis: 'width' | 'height', parentFlow?: string | null): string | null {
  const anchor = child.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const stretchStyle = child.stretch?.style ?? 'None'

  // 布局模式（排列容器）下的子项弹性比例依赖容器对应轴尺寸：autoSize 按排列后内容边界测量、
  // stretchRatio 分配又依赖容器尺寸，会互相追逐出震荡尺寸，必须判定冲突阻止（Grid 无 stretch 不检）
  if (parentFlow === 'Vertical' && axis === 'height' && (child.heightStretchRatio ?? 0) > 0) {
    return '流式子项弹性高度依赖容器高'
  }
  if (parentFlow === 'Horizontal' && axis === 'width' && (child.widthStretchRatio ?? 0) > 0) {
    return '流式子项弹性宽度依赖容器宽'
  }

  if (target === 'screen') return '锚定到屏幕，尺寸不属于父容器内容流'
  if (stretchUsesAxis(stretchStyle, axis)) return axis === 'width' ? '水平拉伸依赖父宽' : '垂直拉伸依赖父高'
  if (sideId === 'None') return null

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
  return node.basic?.visible !== false
}

// ============================================================================
// 排列算法（JS/C# 双端唯一权威）
// arrangeChildren 与 runtime/DjuiLayoutArranger.cs 的 Arrange 逐字对齐：
// 任何语义改动（clamp 顺序、取整时机、null 处理）都必须双端同步，并用 .tmp/layout-cases.json
// 对拍用例验证（容差 0.01），否则双端算法漂移。
// 坐标约定：输出为容器局部坐标（内容区 = 容器矩形减四边 padding，顺序 [left, top, right, bottom]），
// 两侧输出均不取整（取整只在烘焙写回 transform 时做）。
// ============================================================================

export type ArrangeFlow = 'Vertical' | 'Horizontal' | 'Grid'

export interface ArrangeItem {
  id: string
  /** 排序键：childOrder='ByName' 时按码点序参与比较；null/undefined 归一为空串（排最前） */
  name?: string | null
  width: number
  height: number
  /** 宽度弹性比例（= widthStretchRatio）：列表模式主轴分尺寸/交叉轴撑满用；Grid 不参与 */
  hGrow: number
  /** 高度弹性比例（= heightStretchRatio） */
  vGrow: number
}

export interface ArrangeParams {
  flow: ArrangeFlow
  spacingH: number
  spacingV: number
  padLeft: number
  padTop: number
  padRight: number
  padBottom: number
  hAlign: 'Left' | 'Center' | 'Right' | 'Stretch'
  vAlign: 'Top' | 'Center' | 'Bottom' | 'Stretch'
  gridFlow: 'Horizontal' | 'Vertical'
  gridCount: number
  childOrder: 'Default' | 'ByName'
}

export interface ArrangeResult {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * 纯排列算法：不依赖 UiNode 结构，输入容器尺寸 + 排列参数 + 子项尺寸，输出容器局部坐标矩形。
 * a) 排序：childOrder='ByName' 时按 name 码点升序稳定排序（无名项归一空串排最前，比较相等返回 0
 *    保持文档序；禁 localeCompare——须与 C# OrderBy(Ordinal) 稳定排序一致）；Default=文档序。
 *    排序只决定排列位置的计算顺序，禁止改动 children 数组顺序。
 * b) Vertical：间距 spacingV；vGrow>0 子项按比例分「内高-总间距-固定高」的剩余高，固定子项取自身高；
 *    交叉轴宽 hGrow>0 时撑满内宽。
 * c) Horizontal：与 b) 对称（spacingH 主轴、hGrow 分宽、vGrow>0 撑满内高）。
 * d) Grid：gridCount 兜底 Math.max(1, Math.floor(v))，严格按个数断行/断列（绝不按容器宽度自动换行）；
 *    水平优先=每行 N 个放满换行，行高=行内子项最大高、行内顶对齐；垂直优先对称（列宽=列内最大宽、
 *    列内左对齐）；格子尺寸=子项自身尺寸（不设统一格宽高，stretchRatio 不参与）。
 * e) 内容对齐：先按贴起点 (padLeft, padTop) 排出内容块包围盒（含 spacing），再整体偏移——
 *    Center=max(0, (内尺寸-内容尺寸)/2)、Right/Bottom=max(0, 内尺寸-内容尺寸)、Left/Top/Stretch=0；
 *    超出内容区时贴起点照排、绝不压缩（offset 钳 0）；Stretch=维持撑满行为，不额外偏移（与 Left/Top 等价，
 *    由对拍脚本等价断言锁定）。
 */
export function arrangeChildren(
  containerW: number,
  containerH: number,
  params: ArrangeParams,
  items: ArrangeItem[],
): ArrangeResult[] {
  if (!items || items.length === 0) return []

  // a) 排序（复制后排序，不改动调用方数组）
  let ordered: ArrangeItem[] = items
  if (params.childOrder === 'ByName') {
    ordered = [...items].sort((a, b) => {
      const an = a.name ?? ''
      const bn = b.name ?? ''
      if (an < bn) return -1
      if (an > bn) return 1
      return 0
    })
  }

  const padLeft = params.padLeft
  const padTop = params.padTop
  const innerW = containerW - padLeft - params.padRight
  const innerH = containerH - padTop - params.padBottom

  const rects: ArrangeResult[] = []

  if (params.flow === 'Vertical') {
    // b) 垂直堆叠
    const spacing = params.spacingV
    const totalSpacing = spacing * (ordered.length - 1)
    const availH = innerH - totalSpacing

    // 第一遍：算出固定高度和需要 flex 的
    const heights: number[] = []
    let fixedH = 0
    let totalGrow = 0
    for (const it of ordered) {
      if (it.vGrow > 0) {
        heights.push(-1) // 待定
        totalGrow += it.vGrow
      } else {
        heights.push(it.height)
        fixedH += it.height
      }
    }

    // 分配 flex 空间
    const freeH = Math.max(0, availH - fixedH)
    for (let i = 0; i < ordered.length; i++) {
      if (heights[i] === -1) {
        heights[i] = totalGrow > 0 ? (freeH * ordered[i].vGrow / totalGrow) : 0
      }
    }

    // 排列（贴起点）
    let curY = padTop
    for (let i = 0; i < ordered.length; i++) {
      const it = ordered[i]
      const w = it.hGrow > 0 ? innerW : it.width
      rects.push({ id: it.id, x: padLeft, y: curY, width: w, height: heights[i] })
      curY += heights[i] + spacing
    }
  } else if (params.flow === 'Horizontal') {
    // c) 水平堆叠（与垂直对称）
    const spacing = params.spacingH
    const totalSpacing = spacing * (ordered.length - 1)
    const availW = innerW - totalSpacing

    const widths: number[] = []
    let fixedW = 0
    let totalGrow = 0
    for (const it of ordered) {
      if (it.hGrow > 0) {
        widths.push(-1) // 待定
        totalGrow += it.hGrow
      } else {
        widths.push(it.width)
        fixedW += it.width
      }
    }

    const freeW = Math.max(0, availW - fixedW)
    for (let i = 0; i < ordered.length; i++) {
      if (widths[i] === -1) {
        widths[i] = totalGrow > 0 ? (freeW * ordered[i].hGrow / totalGrow) : 0
      }
    }

    let curX = padLeft
    for (let i = 0; i < ordered.length; i++) {
      const it = ordered[i]
      const h = it.vGrow > 0 ? innerH : it.height
      rects.push({ id: it.id, x: curX, y: padTop, width: widths[i], height: h })
      curX += widths[i] + spacing
    }
  } else {
    // d) 网格
    const count = Math.max(1, Math.floor(params.gridCount))
    if (params.gridFlow === 'Vertical') {
      // 垂直优先：每 count 个一列放满换列；列宽=列内子项最大宽，列内左对齐
      let colLeft = padLeft
      for (let start = 0; start < ordered.length; start += count) {
        const col = ordered.slice(start, start + count)
        let colW = 0
        for (const it of col) colW = Math.max(colW, it.width)
        let curY = padTop
        for (const it of col) {
          rects.push({ id: it.id, x: colLeft, y: curY, width: it.width, height: it.height })
          curY += it.height + params.spacingV
        }
        colLeft += colW + params.spacingH
      }
    } else {
      // 水平优先：每 count 个一行放满换行；行高=行内子项最大高，行内顶对齐
      let rowTop = padTop
      for (let start = 0; start < ordered.length; start += count) {
        const row = ordered.slice(start, start + count)
        let rowH = 0
        for (const it of row) rowH = Math.max(rowH, it.height)
        let curX = padLeft
        for (const it of row) {
          rects.push({ id: it.id, x: curX, y: rowTop, width: it.width, height: it.height })
          curX += it.width + params.spacingH
        }
        rowTop += rowH + params.spacingV
      }
    }
  }

  // e) 内容对齐：内容块包围盒（相对内容起点）→ 整体偏移
  let contentW = 0
  let contentH = 0
  for (const r of rects) {
    contentW = Math.max(contentW, r.x - padLeft + r.width)
    contentH = Math.max(contentH, r.y - padTop + r.height)
  }
  let offsetX = 0
  if (params.hAlign === 'Center') offsetX = Math.max(0, (innerW - contentW) / 2)
  else if (params.hAlign === 'Right') offsetX = Math.max(0, innerW - contentW)
  let offsetY = 0
  if (params.vAlign === 'Center') offsetY = Math.max(0, (innerH - contentH) / 2)
  else if (params.vAlign === 'Bottom') offsetY = Math.max(0, innerH - contentH)
  if (offsetX !== 0 || offsetY !== 0) {
    for (const r of rects) {
      r.x += offsetX
      r.y += offsetY
    }
  }

  return rects
}

// 从 DjuiLayout 构造排列参数（null/缺省兜底：spacing [0,0]、padding 四零、内容对齐贴左上、网格水平优先 1 个、文档序）。
// forMeasure=true 时强制贴起点对齐：autoSize 测自然内容边界，内容对齐偏移不应放大容器尺寸
function buildArrangeParams(layout: DjuiLayout | null | undefined, flow: ArrangeFlow, forMeasure = false): ArrangeParams {
  const sp = layout?.spacing
  const spacingH = Array.isArray(sp) && typeof sp[0] === 'number' ? sp[0] : 0
  const spacingV = Array.isArray(sp) && typeof sp[1] === 'number' ? sp[1] : 0
  const padding = layout?.padding ?? [0, 0, 0, 0]
  const gc = layout?.gridCount
  return {
    flow,
    spacingH,
    spacingV,
    padLeft: padding[0] ?? 0,
    padTop: padding[1] ?? 0,
    padRight: padding[2] ?? 0,
    padBottom: padding[3] ?? 0,
    hAlign: forMeasure ? 'Left' : (layout?.horizontalContentAlignment ?? 'Left'),
    vAlign: forMeasure ? 'Top' : (layout?.verticalContentAlignment ?? 'Top'),
    gridFlow: layout?.gridFlow ?? 'Horizontal',
    gridCount: typeof gc === 'number' && Number.isFinite(gc) ? gc : 1,
    childOrder: layout?.childOrder === 'ByName' ? 'ByName' : 'Default',
  }
}

// UiNode → ArrangeItem（尺寸默认与原实现一致：宽缺省 100；高缺省 Vertical/Grid 50、Horizontal 100）
function arrangeItemFromNode(child: UiNode, flow: ArrangeFlow): ArrangeItem {
  return {
    id: child.id,
    name: child.name,
    width: child.transform?.width ?? 100,
    height: child.transform?.height ?? (flow === 'Horizontal' ? 100 : 50),
    hGrow: child.widthStretchRatio ?? 0,
    vGrow: child.heightStretchRatio ?? 0,
  }
}

/**
 * 计算容器内所有子控件的排列位置（Vertical/Horizontal/Grid）。
 * 纯包装：排列语义全部在 arrangeChildren（双端对拍基准）。
 * 返回子 id → 画布绝对坐标矩形；编辑器烘焙写回 transform 时须减容器绝对位置（历史漂移坑，见 editorStore.applyFlexLayout）。
 */
export function solveChildrenFlex(
  containerRect: Rect,
  flow: 'Vertical' | 'Horizontal' | 'Grid',
  layout: DjuiLayout | null | undefined,
  children: UiNode[],
  canvasW: number,
  canvasH: number
): Map<string, Rect> {
  const result = new Map<string, Rect>()
  if (!children || children.length === 0) return result

  const params = buildArrangeParams(layout, flow)
  const items = children.map(child => arrangeItemFromNode(child, flow))
  const arranged = arrangeChildren(containerRect.width, containerRect.height, params, items)
  for (const r of arranged) {
    result.set(r.id, { x: containerRect.x + r.x, y: containerRect.y + r.y, width: r.width, height: r.height })
  }
  return result
}

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Group, Transformer, Line, Arrow, Image as KImage, Circle, Path } from 'react-konva'
import { useEditorStore, createNode, findNode, findParent, findPath, getClipboard, setClipboard } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'
import { engineFontToCss } from '@/lib/fontLoader'
import { UiNode, UiPage, ProjectConfig, DjuiAnchor } from '@/types/layout'
import * as api from '@/api/client'
import { useEngineImage, useWorkspaceImage } from '@/hooks/useImageUrl'
import { DEFAULT_ANCHOR_SIDE, DEFAULT_PIVOT, getAnchorSide } from '@/utils/anchorPresets'
import { solveLayout, setCurrentImageFrame, getCurrentImageFrame, Rect as LayoutRect } from '@/utils/layoutSolver'
import { computeImageFit } from '@/utils/imageFit'
import { createCanvasPlanV6 } from '@/utils/viewportV6'
import { devicePresetsForOrientationV6, findDevicePresetV6, type DevicePresetV6 } from '@/lib/devicePresetsV6'
import { auditPageAdaptation, computeImageFrameForAudit } from '@/utils/adaptationAudit'
import { getEditorOverlayVisible, getReferenceImageVisible, setEditorOverlayVisible, setReferenceImageVisible } from '@/lib/editorPreferences'
import type Konva from 'konva'

// === 自定义 useImage hook：从 URL 加载 HTMLImageElement ===
function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) { setImg(null); return }
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    let cancelled = false
    image.onload = () => { if (!cancelled) setImg(image) }
    image.onerror = () => { if (!cancelled) setImg(null) }
    // Blob URL（blob:...）不能追加 query string，否则 URL 失效
    // 只有 HTTP URL 才需要时间戳防缓存
    if (url.startsWith('blob:')) {
      image.src = url
    } else {
      const sep = url.includes('?') ? '&' : '?'
      image.src = `${url}${sep}_t=${Date.now()}`
    }
    return () => { cancelled = true }
  }, [url])
  return img
}

interface SliceEdges { left: number; top: number; right: number; bottom: number }
interface DragPreview { id: string; dx: number; dy: number }
interface Vec2 { x: number; y: number }

// 修饰键 → 选择 modifier（Shift 范围选择优先于 Ctrl 单点）
function pickModifier(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): 'none' | 'ctrl' | 'shift' {
  if (e.shiftKey) return 'shift'
  if (e.ctrlKey || e.metaKey) return 'ctrl'
  return 'none'
}

// === 选中/拖动交互阈值 ===
// 指针位移低于此值（屏幕像素）视为「点击」，在 mouseUp 时才改变选中；
// 超过则视为「拖动」，拖动 dragTarget（不触发对命中顶层节点的选中）。
const CLICK_THRESHOLD_PX = 4

// 一次按下→弹起期间的指针会话
interface PointerSession {
  mode: 'node' | 'blank'
  hitTopId: string | null      // 命中的最顶层节点 id（点击时选中它）
  dragTargetId: string | null  // 待拖动目标：hitTop 祖先链（含自身）中第一个已选中节点
  startScreen: Vec2            // 按下时的屏幕坐标
  modifier: 'none' | 'ctrl' | 'shift'   // 按下时的修饰键
  moved: boolean               // 是否已超过阈值
  activeDragId: string | null  // 一旦超过阈值，锁定的拖动节点 id
  isGroupDrag: boolean         // 拖动已选中的多选组，而不是只拖命中节点
  dragOrigin: Vec2             // activeDragId 拖动起点的画布坐标（solved.x/y）
}

function clampSlice(value: number, max: number) {
  return Math.max(0, Math.min(value, max))
}

function isTransparentColor(color?: string | null) {
  if (!color) return true

  const value = color.trim().toLowerCase()
  if (!value || value === 'transparent') return true
  if (value === '#00000000') return true
  if (/^#[0-9a-f]{8}$/i.test(value) && value.endsWith('00')) return true
  if (/^#[0-9a-f]{4}$/i.test(value) && value.endsWith('0')) return true
  return /^rgba?\([^,]+,[^,]+,[^,]+,\s*0\s*\)$/i.test(value)
}

function measureTextWidth(text: string, fontSize: number, fontFamily?: string, bold?: boolean) {
  if (typeof document === 'undefined') return text.length * fontSize * 0.6
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return text.length * fontSize * 0.6
  context.font = `${bold ? 'bold ' : ''}${fontSize}px ${fontFamily ?? 'sans-serif'}`
  return context.measureText(text).width
}

function textAlign(value?: string | null): 'left' | 'center' | 'right' {
  if (value === 'Left') return 'left'
  if (value === 'Right') return 'right'
  return 'center'
}

function verticalTextAlign(value?: string | null): 'top' | 'middle' | 'bottom' {
  if (value === 'Top') return 'top'
  if (value === 'Bottom') return 'bottom'
  return 'middle'
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function getTextPreview(node: UiNode, width: number, height: number, defaultFont?: string | null) {
  const text = node.text?.text ?? ''
  const baseFontSize = node.text?.fontSize ?? 16
  const font = node.text?.font ?? defaultFont
  // 引擎 family（如 ui/font/regular）→ 浏览器 CSS family（如 djui-regular）；未注册则回退
  const cssFont = font ? (engineFontToCss(font) ?? font) : undefined
  // 多 family 回退串(如系统字体映射)已含引号/逗号,直接使用;单个裸 family 名才包引号
  const fontFamily = cssFont ? (/[,"]/.test(cssFont) ? cssFont : `"${cssFont}"`) : undefined
  const bold = node.text?.bold ?? false
  const wrapEnabled = node.text?.textWrap ?? false
  const overflow = node.text?.textOverflow ?? 'Shrink'
  const align = textAlign(node.layout?.horizontalContentAlignment)
  const measuredWidth = Math.max(1, measureTextWidth(text, baseFontSize, fontFamily, bold))

  let fontSize = baseFontSize
  let renderWidth = width
  let renderHeight: number | undefined = height
  let xOffset = 0

  if (overflow === 'Shrink' && !wrapEnabled && width > 0) {
    const widthScale = Math.min(1, width / measuredWidth)
    const heightScale = height > 0 ? Math.min(1, height / Math.max(1, baseFontSize * 1.2)) : 1
    fontSize = Math.max(1, Math.floor(baseFontSize * Math.min(widthScale, heightScale)))
  } else if (overflow === 'Shrink' && wrapEnabled && width > 0 && height > 0) {
    // 引擎 TextWrap+Shrink 会缩字号直到文本装进宽高；预估行数后等比收缩
    const lines = Math.max(1, Math.ceil(measuredWidth / width))
    const requiredHeight = lines * baseFontSize * 1.25
    fontSize = Math.max(1, Math.floor(baseFontSize * Math.min(1, height / requiredHeight)))
  } else if (overflow === 'None') {
    renderHeight = undefined
    if (!wrapEnabled) {
      renderWidth = Math.max(width, measuredWidth)
      if (align === 'right') xOffset = width - renderWidth
      else if (align === 'center') xOffset = (width - renderWidth) / 2
    }
  }

  return {
    xOffset,
    width: renderWidth,
    height: renderHeight,
    fontSize,
    fontFamily,
    bold,
    align,
    verticalAlign: verticalTextAlign(node.layout?.verticalContentAlignment),
    // char 模式：中文无空格，word 模式整段不断行会横向溢出被裁；引擎也按字符断行
    wrap: wrapEnabled ? 'char' as const : 'none' as const,
    ellipsis: overflow === 'Ellipsis',
  }
}

type TemplateOverrides = Record<string, Record<string, unknown>>

function applyFieldPath(target: Record<string, any>, fieldPath: string, value: unknown) {
  const parts = fieldPath.split('.').filter(Boolean)
  if (parts.length === 0) return
  let obj = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (!obj[key] || typeof obj[key] !== 'object') obj[key] = {}
    obj = obj[key]
  }
  obj[parts[parts.length - 1]] = value
}

function cloneNodeWithOverrides(node: UiNode, overrides?: TemplateOverrides | null): UiNode {
  const cloned: UiNode = JSON.parse(JSON.stringify(node))
  const apply = (n: UiNode) => {
    if (n.name && overrides?.[n.name]) {
      for (const [fieldPath, value] of Object.entries(overrides[n.name])) {
        applyFieldPath(n as unknown as Record<string, any>, fieldPath, value)
      }
    }
    n.children.forEach(apply)
  }
  apply(cloned)
  return cloned
}

function cloneTreeWithResponsiveOverrides(root: UiNode, overrides?: Record<string, Record<string, unknown>>): UiNode {
  const cloned: UiNode = JSON.parse(JSON.stringify(root))
  const apply = (node: UiNode) => {
    for (const [path, value] of Object.entries(overrides?.[node.id] ?? {})) {
      applyFieldPath(node as unknown as Record<string, any>, path, value)
    }
    node.children.forEach(apply)
  }
  apply(cloned)
  return cloned
}

// 场景画板与锚定 image 的控件需要使用页面自身的背景图帧。后景页也必须独立计算，
// 不能复用当前编辑页的帧，否则不同背景素材的 cover 裁切会错位。
function computePageImageFrame(root: UiNode, canvasWidth: number, canvasHeight: number): LayoutRect | null {
  const sceneBackgroundId = (root.children ?? []).find(node => !!node.sceneFrame?.backgroundId)?.sceneFrame?.backgroundId
  const imageFrameHost = (root.children ?? []).find(node =>
    (node.stretch?.style ?? 'None') === 'Both' &&
    !!node.appearance?.image &&
    node.basic?.visible !== false &&
    (!sceneBackgroundId || node.id === sceneBackgroundId))
  if (!imageFrameHost) return null

  const appearance = imageFrameHost.appearance!
  const sourceWidth = appearance.sourceSize?.width ?? 0
  const sourceHeight = appearance.sourceSize?.height ?? 0
  if (sourceWidth <= 0 || sourceHeight <= 0 || (appearance.imageFit ?? 'cover') !== 'cover') return null

  const scale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
  const focalX = Math.max(0, Math.min(1, appearance.focalX ?? 0.5))
  const focalY = Math.max(0, Math.min(1, appearance.focalY ?? 0.5))
  return {
    x: (canvasWidth - sourceWidth * scale) * focalX,
    y: (canvasHeight - sourceHeight * scale) * focalY,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  }
}

function solvePreviewRect(node: UiNode, parentRect: LayoutRect, canvasWidth: number, canvasHeight: number, screenOrigin: { x: number; y: number }) {
  const { rect } = solveLayout(node, parentRect, canvasWidth, canvasHeight)
  if (node.anchor?.target === 'screen') {
    return { ...rect, x: rect.x + screenOrigin.x, y: rect.y + screenOrigin.y }
  }
  return rect
}

function NineSliceImage({ image, x, y, width, height, rotation, opacity, edges }: {
  image: HTMLImageElement
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  edges: SliceEdges
}) {
  const imgW = image.naturalWidth || image.width
  const imgH = image.naturalHeight || image.height
  if (imgW <= 0 || imgH <= 0) return null

  const srcLeft = clampSlice(edges.left, imgW - 1)
  const srcRight = clampSlice(edges.right, imgW - srcLeft - 1)
  const srcTop = clampSlice(edges.top, imgH - 1)
  const srcBottom = clampSlice(edges.bottom, imgH - srcTop - 1)
  const srcCenterW = Math.max(0, imgW - srcLeft - srcRight)
  const srcCenterH = Math.max(0, imgH - srcTop - srcBottom)

  const dstLeft = Math.min(srcLeft, width / 2)
  const dstRight = Math.min(srcRight, Math.max(0, width - dstLeft))
  const dstTop = Math.min(srcTop, height / 2)
  const dstBottom = Math.min(srcBottom, Math.max(0, height - dstTop))
  const dstCenterW = Math.max(0, width - dstLeft - dstRight)
  const dstCenterH = Math.max(0, height - dstTop - dstBottom)

  const cols = [
    { sx: 0, sw: srcLeft, dx: 0, dw: dstLeft },
    { sx: srcLeft, sw: srcCenterW, dx: dstLeft, dw: dstCenterW },
    { sx: imgW - srcRight, sw: srcRight, dx: width - dstRight, dw: dstRight },
  ]
  const rows = [
    { sy: 0, sh: srcTop, dy: 0, dh: dstTop },
    { sy: srcTop, sh: srcCenterH, dy: dstTop, dh: dstCenterH },
    { sy: imgH - srcBottom, sh: srcBottom, dy: height - dstBottom, dh: dstBottom },
  ]

  return (
    <Group x={x} y={y} rotation={rotation} opacity={opacity} listening={false}>
      {rows.flatMap((row, rowIndex) => cols.map((col, colIndex) => {
        if (col.sw <= 0 || row.sh <= 0 || col.dw <= 0 || row.dh <= 0) return null
        return (
          <KImage
            key={`${rowIndex}-${colIndex}`}
            image={image}
            x={col.dx}
            y={row.dy}
            width={col.dw}
            height={row.dh}
            crop={{ x: col.sx, y: row.sy, width: col.sw, height: row.sh }}
            listening={false}
          />
        )
      }))}
    </Group>
  )
}

type ProgressPreviewMode = 'LeftToRight' | 'RightToLeft' | 'TopToBottom' | 'BottomToTop' | 'Clockwise' | 'CounterClockwise'

function drawRoundedClipPath(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  const right = x + width
  const bottom = y + height
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(right - r, y)
  ctx.quadraticCurveTo(right, y, right, y + r)
  ctx.lineTo(right, bottom - r)
  ctx.quadraticCurveTo(right, bottom, right - r, bottom)
  ctx.lineTo(x + r, bottom)
  ctx.quadraticCurveTo(x, bottom, x, bottom - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function ProgressImagePreview({ image, x, y, width, height, rotation, opacity, value, mode, progressRotation, imagePath, imageFit, sourceSize, focalX, focalY, sliceEdges, cornerRadius }: {
  image: HTMLImageElement | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  value: number
  mode: ProgressPreviewMode
  progressRotation: number
  imagePath?: string | null
  imageFit: 'stretch' | 'contain' | 'cover'
  sourceSize?: { width: number; height: number } | null
  focalX: number
  focalY: number
  sliceEdges?: SliceEdges
  cornerRadius?: number
}) {
  const progress = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  if (progress <= 0 || width <= 0 || height <= 0) return null

  const isRadial = mode === 'Clockwise' || mode === 'CounterClockwise'
  const isHorizontal = mode === 'LeftToRight' || mode === 'RightToLeft'
  const clipWidth = isHorizontal ? width * progress : width
  const clipHeight = isHorizontal ? height : height * progress
  const clipX = mode === 'RightToLeft' ? width - clipWidth : 0
  const clipY = mode === 'BottomToTop' ? height - clipHeight : 0
  // 进度条默认按胶囊形裁剪；显式填写 cornerRadius=0 时允许使用方形。
  const radius = cornerRadius ?? Math.min(width, height) / 2

  const fit = computeImageFit(
    sourceSize?.width ?? image?.naturalWidth ?? image?.width ?? width,
    sourceSize?.height ?? image?.naturalHeight ?? image?.height ?? height,
    width,
    height,
    imageFit,
    focalX,
    focalY,
  )
  const useNineSlice = !!(image && imagePath && sliceEdges && (sliceEdges.left || sliceEdges.top || sliceEdges.right || sliceEdges.bottom))

  return (
    <Group
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      listening={false}
      clipFunc={(ctx) => {
        if (isRadial) {
          const centerX = width / 2
          const centerY = height / 2
          const radialRadius = Math.min(width, height) / 2
          const start = ((progressRotation - 90) * Math.PI) / 180
          const end = start + (mode === 'CounterClockwise' ? -1 : 1) * Math.PI * 2 * progress
          ctx.beginPath()
          ctx.moveTo(centerX, centerY)
          ctx.lineTo(centerX + Math.cos(start) * radialRadius, centerY + Math.sin(start) * radialRadius)
          ctx.arc(centerX, centerY, radialRadius, start, end, mode === 'CounterClockwise')
          ctx.closePath()
          return
        }
        drawRoundedClipPath(ctx, clipX, clipY, clipWidth, clipHeight, radius)
      }}
    >
      {useNineSlice && image && sliceEdges ? (
        <NineSliceImage
          image={image}
          x={0}
          y={0}
          width={width}
          height={height}
          rotation={0}
          opacity={1}
          edges={sliceEdges}
        />
      ) : image ? (
        <KImage
          image={image}
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
          cropX={fit.crop?.x}
          cropY={fit.crop?.y}
          cropWidth={fit.crop?.width}
          cropHeight={fit.crop?.height}
          listening={false}
        />
      ) : (
        <Rect
          x={clipX}
          y={clipY}
          width={clipWidth}
          height={clipHeight}
          fill="#5ab9ff"
          opacity={0.65}
          listening={false}
        />
      )}
    </Group>
  )
}

// === 辅助 ===
function findNodeById(root: UiNode, id: string): UiNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNodeById(child, id)
    if (found) return found
  }
  return null
}

function findNodePath(root: UiNode, id: string): UiNode[] | null {
  if (root.id === id) return [root]
  for (const child of root.children) {
    const found = findNodePath(child, id)
    if (found) return [root, ...found]
  }
  return null
}

// 确定拖动目标：取命中点本身（hitNode），前提是它未锁未隐。
// 说明：「拖已选父节点穿透更大子节点」的需求由 DragProxyLayer 捕获层解决（已选节点有
// 透明捕获层覆盖其几何范围，命中它即拖它），因此这里不需要沿命中链向上穿透找已选祖先——
// 命中普通节点 Rect（非捕获层）时，拖动目标就是该命中节点本身。
function pickDragTarget(chain: UiNode[] | null, _selectedIds: string[]): string | null {
  if (!chain || chain.length === 0) return null
  const hit = chain[chain.length - 1]
  return (!hit.editorLocked && !hit.editorHidden) ? hit.id : null
}

function solveParentRectForNode(root: UiNode, id: string, canvasWidth: number, canvasHeight: number, safeRect?: LayoutRect, imageFrame?: LayoutRect | null): LayoutRect {
  const path = findNodePath(root, id)
  let rect: LayoutRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  if (!path) return rect
  for (let i = 1; i < path.length - 1; i++) {
    const solved = solveLayout(path[i], rect, canvasWidth, canvasHeight, { safeRect, imageFrame: imageFrame ?? undefined }).rect
    const artboard = path[i].sceneFrame?.artboard
    // 场景画板的后代编辑的是 artboard 局部坐标，不是屏幕坐标。
    rect = artboard && artboard.width > 0 && artboard.height > 0
      ? { x: 0, y: 0, width: artboard.width, height: artboard.height }
      : solved
  }
  return rect
}

function getSafeLayoutRef(canvas: LayoutRect, safe: LayoutRect, edges?: Array<'left' | 'top' | 'right' | 'bottom'>): LayoutRect {
  const selected = edges ?? ['left', 'top', 'right', 'bottom']
  const left = selected.includes('left') ? safe.x - canvas.x : 0
  const top = selected.includes('top') ? safe.y - canvas.y : 0
  const right = selected.includes('right') ? canvas.x + canvas.width - safe.x - safe.width : 0
  const bottom = selected.includes('bottom') ? canvas.y + canvas.height - safe.y - safe.height : 0
  return { x: canvas.x + left, y: canvas.y + top, width: Math.max(0, canvas.width - left - right), height: Math.max(0, canvas.height - top - bottom) }
}

function getLayoutRef(node: UiNode, parentRect: LayoutRect, canvasWidth: number, canvasHeight: number, safeRect?: LayoutRect, imageFrame?: LayoutRect | null): LayoutRect {
  const target = node.anchor?.target ?? 'parent'
  const canvas = { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  if (target === 'screen') return canvas
  if (target === 'safe') return getSafeLayoutRef(canvas, safeRect ?? canvas, node.anchor?.safeEdges)
  if (target === 'image') return imageFrame ?? getCurrentImageFrame() ?? canvas
  return parentRect
}

function getStretchAxes(node: UiNode) {
  const style = node.stretch?.style ?? 'None'
  return {
    horizontal: style === 'Horizontal' || style === 'Both',
    vertical: style === 'Vertical' || style === 'Both',
  }
}

// 选中节点的拖动捕获层所需信息：当前屏幕矩形 + 拖动基准点
interface ProxyEntry {
  id: string
  rect: LayoutRect        // 当前显示矩形（已含 dragPreview 偏移）
  baseLayoutRect: LayoutRect // 节点所属布局空间中的原始矩形（场景画板内为 artboard 局部坐标）
  layoutScaleX: number    // 布局坐标 → 当前画布坐标的缩放
  layoutScaleY: number
  rotation: number
  baseDragX: number       // 无偏移时的 x（dragPreview 起点基准）
  baseDragY: number
}

// 递归遍历节点树，算出每个节点的显示矩形（复刻 NodeShape 的 solver + dragPreview 偏移逻辑），
// 返回所有节点信息供捕获层定位。仅收集，不参与渲染命中。
function collectProxyEntries(
  node: UiNode,
  parentRect: LayoutRect,
  canvasWidth: number,
  canvasHeight: number,
  inheritedDelta: Vec2,
  dragPreview: DragPreview | null,
  out: ProxyEntry[],
  sceneSpace?: { frame: LayoutRect; scaleX: number; scaleY: number },
): void {
  if (node.editorHidden) return
  const { rect: authored } = solveLayout(node, parentRect, canvasWidth, canvasHeight)
  const solved = sceneSpace
    ? {
        x: sceneSpace.frame.x + authored.x * sceneSpace.scaleX,
        y: sceneSpace.frame.y + authored.y * sceneSpace.scaleY,
        width: authored.width * sceneSpace.scaleX,
        height: authored.height * sceneSpace.scaleY,
      }
    : authored
  const ownDelta = dragPreview?.id === node.id ? { x: dragPreview.dx, y: dragPreview.dy } : { x: 0, y: 0 }
  const scaledOwnDelta = sceneSpace
    ? { x: ownDelta.x * sceneSpace.scaleX, y: ownDelta.y * sceneSpace.scaleY }
    : ownDelta
  const renderDelta = { x: inheritedDelta.x + scaledOwnDelta.x, y: inheritedDelta.y + scaledOwnDelta.y }
  const rotation = node.transform?.rotation ?? 0
  out.push({
    id: node.id,
    rect: { x: solved.x + renderDelta.x, y: solved.y + renderDelta.y, width: solved.width, height: solved.height },
    baseLayoutRect: authored,
    layoutScaleX: sceneSpace?.scaleX ?? 1,
    layoutScaleY: sceneSpace?.scaleY ?? 1,
    rotation,
    baseDragX: solved.x + inheritedDelta.x,
    baseDragY: solved.y + inheritedDelta.y,
  })
  const artboard = node.sceneFrame?.artboard
  if (artboard && artboard.width > 0 && artboard.height > 0) {
    const displayedFrame = {
      x: solved.x + renderDelta.x,
      y: solved.y + renderDelta.y,
      width: solved.width,
      height: solved.height,
    }
    const nextSceneSpace = {
      frame: displayedFrame,
      scaleX: displayedFrame.width / artboard.width,
      scaleY: displayedFrame.height / artboard.height,
    }
    const authoredRoot = { x: 0, y: 0, width: artboard.width, height: artboard.height }
    for (const child of (node.children ?? [])) {
      collectProxyEntries(child, authoredRoot, artboard.width, artboard.height, { x: 0, y: 0 }, dragPreview, out, nextSceneSpace)
    }
    return
  }
  const nextInherited = renderDelta
  for (const child of (node.children ?? [])) {
    collectProxyEntries(child, authored, canvasWidth, canvasHeight, nextInherited, dragPreview, out, sceneSpace)
  }
}

function computeLayoutPatchFromRect(
  node: UiNode,
  parentRect: LayoutRect,
  canvasWidth: number,
  canvasHeight: number,
  desiredRect: LayoutRect,
  safeRect?: LayoutRect,
  imageFrame?: LayoutRect | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const anchor = node.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const side = getAnchorSide(sideId)
  const ref = getLayoutRef(node, parentRect, canvasWidth, canvasHeight, safeRect, imageFrame)
  const stretchAxes = getStretchAxes(node)

  if (stretchAxes.horizontal || stretchAxes.vertical) {
    const current = node.stretch?.margins ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const margins = { ...current }
    if (stretchAxes.horizontal) {
      margins.left = Math.round(desiredRect.x - ref.x)
      margins.right = Math.round(ref.x + ref.width - desiredRect.x - desiredRect.width)
    }
    if (stretchAxes.vertical) {
      margins.top = Math.round(desiredRect.y - ref.y)
      margins.bottom = Math.round(ref.y + ref.height - desiredRect.y - desiredRect.height)
    }
    patch['stretch.margins'] = margins
  }

  if (!stretchAxes.horizontal) {
    if (sideId === 'None' || !side) {
      patch['transform.x'] = Math.round(desiredRect.x - ref.x)
    } else {
      const anchorX = ref.x + side.nx * ref.width
      patch['transform.x'] = Math.round(desiredRect.x - anchorX + side.nx * desiredRect.width)
    }
    patch['transform.width'] = Math.max(1, Math.round(desiredRect.width))
  }

  if (!stretchAxes.vertical) {
    if (sideId === 'None' || !side) {
      patch['transform.y'] = Math.round(desiredRect.y - ref.y)
    } else {
      const anchorY = ref.y + (1 - side.ny) * ref.height
      patch['transform.y'] = Math.round(desiredRect.y - anchorY + (1 - side.ny) * desiredRect.height)
    }
    patch['transform.height'] = Math.max(1, Math.round(desiredRect.height))
  }

  return patch
}

// === 参考效果图叠加层（穿透 + 半透明，渲染在最上层）===
function RefImageLayer({ refPath, visible, opacity, width, height }: {
  refPath: string | null
  visible: boolean
  opacity: number
  width: number
  height: number
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  // 异步获取参考图 Blob URL（pure-frontend FS API）
  const normalizedRefPath = refPath ? refPath.replace(/\\/g, '/') : null
  const url = useWorkspaceImage(normalizedRefPath)

  useEffect(() => {
    if (!url) { setImg(null); setStatus('idle'); return }
    setStatus('loading')
    const image = new window.Image()
    let cancelled = false
    image.onload = () => { if (!cancelled) { setImg(image); setStatus('loaded') } }
    image.onerror = () => { if (!cancelled) { setImg(null); setStatus('error') } }
    image.src = url
    return () => { cancelled = true }
  }, [url])

  // 没有图片或不显示：什么都不渲染
  if (!url || !visible) return null

  // 加载中/失败：在画布上显示调试文字（方便排查）
  if (!img) {
    return (
      <Text
        x={10} y={10}
        text={status === 'error' ? `参考图加载失败: ${refPath}` : '参考图加载中...'}
        fontSize={14}
        fill="#ff6b6b"
        listening={false}
      />
    )
  }

  return (
    <KImage
      image={img}
      x={0} y={0}
      width={width} height={height}
      opacity={opacity}
      listening={false}
    />
  )
}

// === 选中节点拖动捕获层（Proxy）===
// 为每个「已选中 + 未锁定 + 未隐藏」节点叠一个透明、可命中的 Rect，渲染在所有节点之上。
// 作用：当某个更大的子节点盖住已选中的父节点时，按下父节点区域命中本捕获层（因为它在最上层），
// 于是「按下」被识别为「命中已选中父节点」，拖动就拖父节点——即「按住已选父节点拖动」。
// 本层只负责「命中拦截」并通知 Stage，**不负责**实际拖动与选中：
//  - 拖动：由 Stage 的指针会话在超阈值后手动驱动 dragPreview（复用 NodeShape 的预览偏移）
//  - 选中：由 Stage 在 mouseUp（未拖动）时决定；点击已选节点不改变选中
function DragProxyLayer({ entries, onProxyDown }: {
  entries: ProxyEntry[]
  onProxyDown: (nodeId: string, modifier: 'none' | 'ctrl' | 'shift', clientX: number, clientY: number) => void
}) {
  if (entries.length === 0) return null
  return (
    <>
      {entries.map((e) => (
        <Rect
          key={`proxy-${e.id}`}
          x={e.rect.x}
          y={e.rect.y}
          width={e.rect.width}
          height={e.rect.height}
          rotation={e.rotation}
          // 几乎透明但非完全透明，保证命中（Konva 对 listening 形状均可命中，与 fill 无关）
          fill="rgba(0,0,0,0.001)"
          draggable={false}
          listening
          onMouseDown={(ke) => {
            const evt = ke.evt as MouseEvent
            // 仅左键参与选中/拖动会话；右键/中键交给 Stage 平移（不 cancelBubble，让其冒泡）
            if (evt.button !== 0) return
            // 阻止冒泡：独占本次按下，不被下层节点抢走，也不被 Stage 当作空白
            ke.cancelBubble = true
            onProxyDown(e.id, pickModifier(evt), evt.clientX, evt.clientY)
          }}
          // 触摸兜底：tap 命中已选中节点，保持选中不变（cancelBubble 防止下层重复处理）
          onTap={(ke) => { ke.cancelBubble = true }}
        />
      ))}
    </>
  )
}

function TemplatePreviewShape({ node, parentRect, canvasWidth, canvasHeight, screenOrigin, workspacePath, projectPath, defaultFont, showEditorOverlay, sliceMeta }: {
  node: UiNode
  parentRect: LayoutRect
  canvasWidth: number
  canvasHeight: number
  screenOrigin: { x: number; y: number }
  workspacePath: string
  projectPath: string
  defaultFont?: string | null
  showEditorOverlay: boolean
  sliceMeta: Record<string, { left: number; top: number; right: number; bottom: number }>
}) {
  const appPreview = node.appearance ?? {}
  // 异步获取引擎图片 URL（pure-frontend FS API）
  const imgUrl = useEngineImage(appPreview.image ?? null)
  const image = useImage(imgUrl)

  if (node.editorHidden) return null

  const t = node.transform ?? {}
  const app = node.appearance ?? {}
  // 隐藏节点不渲染（与引擎运行时一致）
  if (node.basic?.visible === false) return null
  const rect = solvePreviewRect(node, parentRect, canvasWidth, canvasHeight, screenOrigin)
  const x = rect.x
  const y = rect.y
  const width = rect.width
  const height = rect.height
  const rotation = t.rotation ?? 0
  const opacity = t.opacity ?? 1
  const bgColor = app.background
  const hasImage = !!image
  const isTransparent = isTransparentColor(bgColor)
  const fillColor = hasImage
    ? undefined
    : (!isTransparent ? (bgColor ?? undefined) : undefined)
  const sliceEdges = app.image ? sliceMeta[app.image] : undefined
  const useNineSlice = !!(image && sliceEdges && (sliceEdges.left || sliceEdges.top || sliceEdges.right || sliceEdges.bottom))
  const borderThickness = positiveNumber(app.borderThickness)
  return (
    <>
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        rotation={rotation}
        opacity={opacity}
        fill={fillColor}
        cornerRadius={app.cornerRadius ?? 0}
        listening={false}
      />
      {hasImage && image && useNineSlice && sliceEdges ? (
        <NineSliceImage
          image={image}
          x={x}
          y={y}
          width={width}
          height={height}
          rotation={rotation}
          opacity={opacity}
          edges={sliceEdges}
        />
      ) : hasImage && (
        <KImage
          image={image}
          x={x}
          y={y}
          width={width}
          height={height}
          rotation={rotation}
          opacity={opacity}
          listening={false}
        />
      )}
      {borderThickness > 0 && (
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          rotation={rotation}
          opacity={opacity}
          stroke={app.borderColor ?? '#FFFFFFFF'}
          strokeWidth={borderThickness}
          cornerRadius={app.cornerRadius ?? 0}
          listening={false}
        />
      )}
      {(node.text?.text || node.starType === 'Label') && (() => {
        const preview = getTextPreview(node, width, height, defaultFont)
        const strokeWidth = positiveNumber(node.text?.strokeSize)
        return (
          <Text
            x={x + preview.xOffset}
            y={y}
            width={preview.width}
            height={preview.height}
            text={node.text?.text ?? ''}
            fontSize={preview.fontSize}
            fontFamily={preview.fontFamily}
            fill={node.text?.textColor ?? '#FFFFFF'}
            stroke={strokeWidth > 0 ? (node.text?.strokeColor ?? '#000000FF') : undefined}
            strokeWidth={strokeWidth}
            fillAfterStrokeEnabled={strokeWidth > 0}
            fontStyle={preview.bold ? 'bold' : 'normal'}
            align={preview.align}
            verticalAlign={preview.verticalAlign}
            wrap={preview.wrap}
            ellipsis={preview.ellipsis}
            rotation={rotation}
            listening={false}
          />
        )
      })()}
      {(node.children ?? []).map(child => (
        <TemplatePreviewShape
          key={child.id}
          node={child}
          parentRect={rect}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          screenOrigin={screenOrigin}
          workspacePath={workspacePath}
          projectPath={projectPath}
          defaultFont={defaultFont}
          showEditorOverlay={showEditorOverlay}
          sliceMeta={sliceMeta}
        />
      ))}
    </>
  )
}

// === 单个控件渲染 ===
interface NodeShapeProps {
  node: UiNode
  isSelected: boolean
  selectedIds: string[]    // 全局选中列表，子节点用于独立选中
  onSelect: (id: string, modifier: 'none' | 'ctrl' | 'shift') => void
  onDragEnd: (id: string, rect: LayoutRect) => void
  onDragPreviewChange: (preview: DragPreview | null) => void
  onTransformEnd: (node: UiNode) => void
  registerRef: (id: string, ref: Konva.Node | null) => void
  workspacePath: string
  projectPath: string
  parentRect: LayoutRect       // 父节点矩形（屏幕坐标）
  canvasWidth: number          // 画布（设计/模拟）宽度
  canvasHeight: number
  safeRect: LayoutRect
  imageFrame?: LayoutRect | null
  showEditorOverlay: boolean   // 编辑器辅助渲染开关
  sliceMeta: Record<string, { left: number; top: number; right: number; bottom: number }>
  dragPreview: DragPreview | null
  inheritedDragDelta: Vec2
  /** 后景/审计等只读预览：保留渲染，但不参与画布命中、选中和变形。 */
  readOnly?: boolean
}

function NodeShape({ node, isSelected, selectedIds, onSelect, onDragEnd, onDragPreviewChange, onTransformEnd, registerRef, workspacePath, projectPath, parentRect, canvasWidth, canvasHeight, safeRect, imageFrame, showEditorOverlay, sliceMeta, dragPreview, inheritedDragDelta, readOnly = false }: NodeShapeProps) {
  const { config } = useProjectStore()
  const allPages = useEditorStore(s => s.allPages)
  const defaultFont = config?.defaultFont ?? null

  // ★ 所有 hooks 必须在任何 return null 之前调用
  const app_preview = node.appearance ?? {}
  // 异步获取引擎图片 URL（pure-frontend FS API）
  const imgUrl = useEngineImage(app_preview.image ?? null)
  const image = useImage(imgUrl)
  // 按钮禁用图：禁用中的按钮用它替代正常图渲染（无禁用图时走灰化兜底）
  const disabledImgUrl = useEngineImage(node.starType === 'Button' ? (node.button?.imageDisabled ?? null) : null)
  const disabledImage = useImage(disabledImgUrl)

  // 编辑器隐藏：不渲染（子节点也跟着隐藏）
  if (node.editorHidden) return null
  // basic.visible=false 与引擎运行时一致：节点（含子树）不渲染。
  // 曾因漏掉此判断，隐藏的宽屏背景节点照常绘制并盖住竖屏背景，造成编辑器与引擎画面不一致。
  if (node.basic?.visible === false) return null

  const t = node.transform ?? {}
  const opacity = t.opacity ?? 1
  const rotation = t.rotation ?? 0
  const app = node.appearance ?? {}
  const bgColor = app.background

  // ★ 用 solver 算出最终屏幕矩形（应用了 anchor + stretch + aspectRatio）
  const { rect: solved } = solveLayout(node, parentRect, canvasWidth, canvasHeight, { safeRect, imageFrame: imageFrame ?? undefined })
  const x = solved.x
  const y = solved.y
  const width = solved.width
  const height = solved.height
  const ownDragDelta = (dragPreview?.id === node.id || (isSelected && dragPreview?.id === '__group__'))
    ? { x: dragPreview.dx, y: dragPreview.dy }
    : { x: 0, y: 0 }
  const renderDelta = { x: inheritedDragDelta.x + ownDragDelta.x, y: inheritedDragDelta.y + ownDragDelta.y }
  const displayX = x + renderDelta.x
  const displayY = y + renderDelta.y
  const displaySolved = { ...solved, x: displayX, y: displayY }
  const baseDragX = x + inheritedDragDelta.x
  const baseDragY = y + inheritedDragDelta.y

  if (node.starType === 'TemplateInstance') {
    const templatePage = node.templateRef ? allPages[node.templateRef] : null
    const screenOrigin = { x: displayX, y: displayY }
    const previewChildren = (templatePage?.root.children ?? []).map(child => cloneNodeWithOverrides(child, node.templateOverrides))
    const templateLabel = node.templateRef ? `模板: ${node.templateRef}` : '未选择模板'

    return (
      <>
        {previewChildren.map(child => (
          <TemplatePreviewShape
            key={child.id}
            node={child}
            parentRect={displaySolved}
            canvasWidth={width}
            canvasHeight={height}
            screenOrigin={screenOrigin}
            workspacePath={workspacePath}
            projectPath={projectPath}
            defaultFont={defaultFont}
            showEditorOverlay={showEditorOverlay}
            sliceMeta={sliceMeta}
          />
        ))}
        {!templatePage && (
          <Text
            x={displayX + 8}
            y={displayY + 8}
            width={Math.max(1, width - 16)}
            height={height}
            text={templateLabel}
            fontSize={12}
            fill="#b37feb"
            listening={false}
          />
        )}
        <Rect
          id={node.id}
          ref={(el) => registerRef(node.id, el as unknown as Konva.Rect)}
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          opacity={opacity}
          fill="rgba(0,0,0,0.01)"
          stroke={isSelected ? '#b37feb' : (showEditorOverlay ? '#8a6fc0' : undefined)}
          strokeWidth={isSelected ? 2.5 : 1.5}
          dash={[6, 4]}
          draggable={isSelected && !node.editorLocked && !readOnly}
          listening={!node.editorLocked && !readOnly}
          // 选中/拖动统一交给上层：选中已选节点的「捕获层(Proxy)」在最上层优先命中；
          // 未被 proxy 覆盖时（节点本身未选中），命中落到这里。
          // 这里不再立即改选中状态——选中延迟到 Stage 的 mouseUp（按下→未拖→弹起才算选中），
          // 从而实现「按住已选父节点拖动」与「点击选中」互不干扰。
          onMouseDown={(e) => {
            const evt = e.evt as MouseEvent
            // 仅左键参与选中/拖动会话；右键/中键交给 Stage 平移
            if (evt.button !== 0) return
            // 不阻止冒泡：让 Stage 建立统一指针会话（按下→未拖→弹起 才选中）。
            // 命中判定靠 e.target.id()，Stage 不会把带 id 的节点误判为空白。
          }}
          // 触摸设备：Konva 的 tap 是等价 click，没有「拖动后再 click」语义，
          // 故触摸沿用「tap 即选中」的简单模型，保证可用性。
          onTap={(e) => {
            const evt = e.evt as MouseEvent
            e.cancelBubble = true
            onSelect(node.id, pickModifier(evt))
          }}
          onDragStart={() => onDragPreviewChange({ id: node.id, dx: 0, dy: 0 })}
          onDragMove={(e) => {
            onDragPreviewChange({
              id: node.id,
              dx: e.target.x() - baseDragX,
              dy: e.target.y() - baseDragY,
            })
          }}
          onDragEnd={(e) => {
            onDragEnd(node.id, {
              x: Math.round(e.target.x() - inheritedDragDelta.x),
              y: Math.round(e.target.y() - inheritedDragDelta.y),
              width,
              height,
            })
            onDragPreviewChange(null)
          }}
          onTransformEnd={() => onTransformEnd(node)}
        />
        {showEditorOverlay && (
          <Text
            x={displayX}
            y={displayY - 18}
            text={templateLabel}
            fontSize={11}
            fill="#b37feb"
            listening={false}
          />
        )}
      </>
    )
  }

  const hasImage = !!image
  const isProgress = node.starType === 'Progress'

  // 禁用中的按钮：配置了禁用图则直接替换正常图；否则灰化兜底（降透明 + 灰罩 + 角标）
  const isButtonDisabled = node.starType === 'Button' && node.basic?.disabled === true
  const showDisabledImage = isButtonDisabled && !!disabledImage
  const effectiveImage = showDisabledImage ? disabledImage : image
  const effectiveImagePath = showDisabledImage ? node.button?.imageDisabled : app.image
  const disabledFallback = isButtonDisabled && !showDisabledImage
  const renderOpacity = disabledFallback ? opacity * 0.55 : opacity

  // 背景色：如果有设背景就用；有图片时不画底色
  // 透明背景控件不画底色——仅用 stroke 边框标识（辅助线），避免实心填充盖住下层素材
  const isTransparent = isTransparentColor(bgColor)
  const fillColor = hasImage
    ? undefined
    : (!isTransparent ? (bgColor ?? undefined) : undefined)
  const sliceEdges = effectiveImagePath ? sliceMeta[effectiveImagePath] : undefined
  const useNineSlice = !!(effectiveImage && sliceEdges && (sliceEdges.left || sliceEdges.top || sliceEdges.right || sliceEdges.bottom))
  const borderThickness = positiveNumber(app.borderThickness)
  const sceneFrame = node.sceneFrame

  return (
    <>
      <Rect
        id={node.id}
        ref={(el) => registerRef(node.id, el as unknown as Konva.Rect)}
        x={displayX}
        y={displayY}
        width={width}
        height={height}
        rotation={rotation}
        opacity={opacity}
        fill={fillColor}
        stroke={showEditorOverlay ? (isSelected ? '#5ab9ff' : '#7a8aa8') : undefined}
        strokeWidth={isSelected ? 2.5 : 1.5}
        cornerRadius={app.cornerRadius ?? 0}
        dash={node.basic?.isStatic ? [5, 5] : undefined}
        draggable={isSelected && !node.editorLocked && !readOnly}
        listening={!node.editorLocked && !readOnly}
        onMouseDown={(e) => {
          const evt = e.evt as MouseEvent
          // 仅左键参与选中/拖动会话；右键和中键用于平移
          if (evt.button !== 0) return
          // 不阻止冒泡：让 Stage 建立统一指针会话（按下→未拖→弹起 才选中）。
          // 命中判定靠 e.target.id()，Stage 不会把带 id 的节点误判为空白。
        }}
        onTap={(e) => {
          const evt = e.evt as MouseEvent
          // 触摸设备兜底：tap 即选中（触摸无独立「拖动后再 click」语义）
          e.cancelBubble = true
          onSelect(node.id, pickModifier(evt))
        }}
        onDragStart={() => onDragPreviewChange({ id: node.id, dx: 0, dy: 0 })}
        onDragMove={(e) => {
          onDragPreviewChange({
            id: node.id,
            dx: e.target.x() - baseDragX,
            dy: e.target.y() - baseDragY,
          })
        }}
        onDragEnd={(e) => {
          onDragEnd(node.id, {
            x: Math.round(e.target.x() - inheritedDragDelta.x),
            y: Math.round(e.target.y() - inheritedDragDelta.y),
            width,
            height,
          })
          onDragPreviewChange(null)
        }}
        onTransformEnd={(e) => {
          onTransformEnd(node)
        }}
      />
      {/* 图片渲染：在 Rect 上层，铺满控件框；Progress 使用真实裁剪预览 */}
      {isProgress ? (
        <ProgressImagePreview
          image={effectiveImage}
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          opacity={renderOpacity}
          value={node.progress?.value ?? 0.5}
          mode={node.progress?.progressionMode ?? 'LeftToRight'}
          progressRotation={node.progress?.rotation ?? 0}
          imagePath={effectiveImagePath}
          imageFit={app.imageFit ?? 'stretch'}
          sourceSize={app.sourceSize}
          focalX={app.focalX ?? 0.5}
          focalY={app.focalY ?? 0.5}
          sliceEdges={sliceEdges}
          cornerRadius={app.cornerRadius}
        />
      ) : hasImage && effectiveImage && useNineSlice && sliceEdges ? (
        <NineSliceImage
          image={effectiveImage}
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          opacity={renderOpacity}
          edges={sliceEdges}
        />
      ) : hasImage && effectiveImage && (() => {
        const fit = computeImageFit(
          app.sourceSize?.width ?? effectiveImage.naturalWidth ?? effectiveImage.width,
          app.sourceSize?.height ?? effectiveImage.naturalHeight ?? effectiveImage.height,
          width,
          height,
          app.imageFit ?? 'stretch',
          app.focalX ?? 0.5,
          app.focalY ?? 0.5,
        )
        return (
          <KImage
            image={effectiveImage}
            x={displayX + fit.x}
            y={displayY + fit.y}
            width={fit.width}
            height={fit.height}
            cropX={fit.crop?.x}
            cropY={fit.crop?.y}
            cropWidth={fit.crop?.width}
            cropHeight={fit.crop?.height}
            rotation={rotation}
            opacity={renderOpacity}
            listening={false}
          />
        )
      })()}
      {borderThickness > 0 && (
        <Rect
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          opacity={renderOpacity}
          stroke={app.borderColor ?? '#FFFFFFFF'}
          strokeWidth={borderThickness}
          cornerRadius={app.cornerRadius ?? 0}
          listening={false}
        />
      )}
      {/* 九宫格切片预览（选中 + 图片有切片元数据时显示分割线） */}
      {isSelected && app.image && sliceMeta[app.image] && (() => {
        const se = sliceMeta[app.image]
        const lx = displayX + se.left
        const rx = displayX + width - se.right
        const ty = displayY + se.top
        const by = displayY + height - se.bottom
        return (
          <>
            <Line points={[lx, displayY, lx, displayY + height]} stroke="#5ab9ff" strokeWidth={1} dash={[4, 3]} listening={false} />
            <Line points={[rx, displayY, rx, displayY + height]} stroke="#5ab9ff" strokeWidth={1} dash={[4, 3]} listening={false} />
            <Line points={[displayX, ty, displayX + width, ty]} stroke="#5ab9ff" strokeWidth={1} dash={[4, 3]} listening={false} />
            <Line points={[displayX, by, displayX + width, by]} stroke="#5ab9ff" strokeWidth={1} dash={[4, 3]} listening={false} />
          </>
        )
      })()}
      {/* 文本渲染 */}
      {(node.text?.text || node.starType === 'Label') && (() => {
        const preview = getTextPreview(node, width, height, defaultFont)
        const strokeWidth = positiveNumber(node.text?.strokeSize)
        return (
          <Text
            x={displayX + preview.xOffset}
            y={displayY}
            width={preview.width}
            height={preview.height}
            text={node.text?.text ?? ''}
            fontSize={preview.fontSize}
            fontFamily={preview.fontFamily}
            fill={node.text?.textColor ?? '#FFFFFF'}
            stroke={strokeWidth > 0 ? (node.text?.strokeColor ?? '#000000FF') : undefined}
            strokeWidth={strokeWidth}
            fillAfterStrokeEnabled={strokeWidth > 0}
            fontStyle={preview.bold ? 'bold' : 'normal'}
            align={preview.align}
            verticalAlign={preview.verticalAlign}
            wrap={preview.wrap}
            ellipsis={preview.ellipsis}
            rotation={rotation}
            opacity={renderOpacity}
            listening={false}
          />
        )
      })()}
      {/* 禁用灰化兜底：未配置禁用图时叠加灰罩，模拟运行时的灰度+降透明 */}
      {disabledFallback && (
        <Rect
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          fill="rgba(128,128,128,0.4)"
          listening={false}
        />
      )}
      {/* 禁用角标：无论是否配置禁用图，禁用中的按钮都带「禁」标识 */}
      {isButtonDisabled && (
        <Group x={displayX} y={displayY} listening={false}>
          <Rect width={26} height={16} fill="#6b7280" cornerRadius={2} opacity={0.92} />
          <Text text="禁" fontSize={10} width={26} height={16} align="center" verticalAlign="middle" fill="#ffffff" />
        </Group>
      )}
      {/* 类型标签 */}
      {isSelected && (
        <Text
          x={displayX}
          y={displayY - 18}
          text={node.name || node.starType}
          fontSize={11}
          fill="#5ab9ff"
          listening={false}
        />
      )}
      {/* 子节点：场景画板内的坐标以 artboard 为准，再整体映射到背景完整图帧。 */}
      {sceneFrame?.artboard && sceneFrame.artboard.width > 0 && sceneFrame.artboard.height > 0 ? (
        <Group
          x={displayX}
          y={displayY}
          scaleX={width / sceneFrame.artboard.width}
          scaleY={height / sceneFrame.artboard.height}
          clipX={0}
          clipY={0}
          clipWidth={sceneFrame.artboard.width}
          clipHeight={sceneFrame.artboard.height}
        >
          {(node.children ?? []).map(child => (
            <NodeShape
              key={child.id}
              node={child}
              isSelected={selectedIds.includes(child.id)}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onDragEnd={onDragEnd}
              onDragPreviewChange={onDragPreviewChange}
              onTransformEnd={onTransformEnd}
              registerRef={registerRef}
              workspacePath={workspacePath}
              projectPath={projectPath}
              parentRect={{ x: 0, y: 0, width: sceneFrame.artboard.width, height: sceneFrame.artboard.height }}
              canvasWidth={sceneFrame.artboard.width}
              canvasHeight={sceneFrame.artboard.height}
              safeRect={{ x: 0, y: 0, width: sceneFrame.artboard.width, height: sceneFrame.artboard.height }}
              imageFrame={imageFrame}
              showEditorOverlay={showEditorOverlay}
              sliceMeta={sliceMeta}
              dragPreview={dragPreview}
              inheritedDragDelta={{ x: 0, y: 0 }}
              readOnly={readOnly}
            />
          ))}
        </Group>
      ) : (
        (node.children ?? []).map(child => (
          <NodeShape
            key={child.id}
            node={child}
            isSelected={selectedIds.includes(child.id)}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onDragEnd={onDragEnd}
            onDragPreviewChange={onDragPreviewChange}
            onTransformEnd={onTransformEnd}
            registerRef={registerRef}
            workspacePath={workspacePath}
            projectPath={projectPath}
            parentRect={solved}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            safeRect={safeRect}
            imageFrame={imageFrame}
            showEditorOverlay={showEditorOverlay}
            sliceMeta={sliceMeta}
            dragPreview={dragPreview}
            inheritedDragDelta={renderDelta}
            readOnly={readOnly}
          />
        ))
      )}
    </>
  )
}

/**
 * 审计页的只读设备窗口。它复用主画布的 NodeShape、图片裁切和 sceneFrame 求解，
 * 因而不是另一套缩略图算法；交互和编辑辅助线在这里被刻意关闭。
 */
export function StaticViewportPreview({
  root, config, device, workspacePath, projectPath, width, height,
}: {
  root: UiNode
  config: ProjectConfig
  device: DevicePresetV6
  workspacePath: string
  projectPath: string
  width: number
  height: number
}) {
  const project = api.createProjectFileV6(config)
  const plan = createCanvasPlanV6(device.widthPx, device.heightPx, device.safeInsetsPx, project)
  const canvas = plan.canvasRect
  const imageFrame = computeImageFrameForAudit(root, canvas, plan.safeRect)
  const scale = Math.min(width / canvas.width, height / canvas.height)
  const renderW = canvas.width * scale
  const renderH = canvas.height * scale
  const obstacleRects = [...(device.visualObstacles ?? []), ...(device.touchObstacles ?? [])].map(obstacle => ({
    ...obstacle,
    x: obstacle.x * canvas.width / device.widthPx,
    y: obstacle.y * canvas.height / device.heightPx,
    width: obstacle.width * canvas.width / device.widthPx,
    height: obstacle.height * canvas.height / device.heightPx,
  }))

  return (
    <Stage width={width} height={height} listening={false}>
      <Layer listening={false}>
        <Group x={(width - renderW) / 2} y={(height - renderH) / 2} scaleX={scale} scaleY={scale}
          clipX={0} clipY={0} clipWidth={canvas.width} clipHeight={canvas.height}>
          <Rect x={0} y={0} width={canvas.width} height={canvas.height} fill="#161a23" listening={false} />
          {(root.children ?? []).map(child => (
            <NodeShape
              key={child.id}
              node={child}
              isSelected={false}
              selectedIds={[]}
              onSelect={() => {}}
              onDragEnd={() => {}}
              onDragPreviewChange={() => {}}
              onTransformEnd={() => {}}
              registerRef={() => {}}
              workspacePath={workspacePath}
              projectPath={projectPath}
              parentRect={canvas}
              canvasWidth={canvas.width}
              canvasHeight={canvas.height}
              safeRect={plan.safeRect}
              imageFrame={imageFrame}
              showEditorOverlay={false}
              sliceMeta={{}}
              dragPreview={null}
              inheritedDragDelta={{ x: 0, y: 0 }}
            />
          ))}
          <Rect
            x={plan.safeRect.x} y={plan.safeRect.y}
            width={plan.safeRect.width} height={plan.safeRect.height}
            fill="rgba(42,190,150,0.05)" stroke="#2abe96" strokeWidth={Math.max(1 / scale, 1)} dash={[6 / scale, 4 / scale]}
            listening={false}
          />
          {obstacleRects.map(obstacle => (
            <Rect
              key={obstacle.kind + obstacle.label}
              x={obstacle.x} y={obstacle.y} width={obstacle.width} height={obstacle.height}
              fill={obstacle.kind === 'gesture' || obstacle.kind === 'waterfall' ? 'rgba(245,158,11,0.18)' : 'rgba(244,63,94,0.28)'}
              stroke={obstacle.kind === 'gesture' || obstacle.kind === 'waterfall' ? '#f59e0b' : '#f43f5e'}
              strokeWidth={Math.max(1 / scale, 1)}
              listening={false}
            />
          ))}
        </Group>
      </Layer>
    </Stage>
  )
}

// === 主画布组件 ===
export default function CanvasArea() {
  const { page, allPages, pageUnderlays, selectedIds, selectNode, clearSelection, addNode, responsiveVariant, setResponsiveVariant } = useEditorStore()
  const { config } = useProjectStore()
  // 订阅 fontVersion：字体注册完成后 bump，触发画布用真实字体重渲染
  const fontVersion = useProjectStore(s => s.fontVersion)
  void fontVersion
  const workspacePath = config?.workspacePath ?? ''
  const projectPath = config?.starProjectPath ?? ''
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())

  // 画布视口状态
  const [viewport, setViewport] = useState({ x: 40, y: 40, scale: 0.4 })
  const [isPanning, setIsPanning] = useState(false)
  // 渲染画布尺寸统一换算：预设物理像素 → Canvas 模式换算后的逻辑画布；无预设 = 设计画布
// zoomFit 与渲染共用，保证适配缩放按真实画布大小计算
function computeRenderDims(
  page: { nodeKind?: string; designWidth: number; designHeight: number },
  preset: DevicePresetV6 | null,
  config: ProjectConfig | null,
): { w: number; h: number } {
  const isTemplate = page.nodeKind === 'template'
  if (isTemplate) return { w: page.designWidth, h: page.designHeight }
  const plan = preset && config
    ? createCanvasPlanV6(preset.widthPx, preset.heightPx, preset.safeInsetsPx, api.createProjectFileV6(config))
    : null
  return {
    w: plan?.canvasRect.width ?? page.designWidth,
    h: plan?.canvasRect.height ?? page.designHeight,
  }
}

// 多分辨率预览：默认 = 设计分辨率
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null)
  const previewPreset = findDevicePresetV6(previewPresetId)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  // 当前按下→弹起的指针会话（统一管理「点击选中」与「拖动」）
  const pointerSession = useRef<PointerSession | null>(null)
  // 选中节点的拖动捕获层信息（每次渲染重新收集，供拖动定位用）
  const proxyEntriesRef = useRef<ProxyEntry[]>([])
  // 锚点编辑事件在页面尚未载入时也必须保持 Hook 顺序；实际画布参数由已渲染页面更新到此 ref。
  const reanchorContextRef = useRef<{ actualW: number; actualH: number; safeRect: LayoutRect; imageFrame: LayoutRect | null } | null>(null)

  // 注册节点引用
  const registerRef = useCallback((id: string, ref: Konva.Node | null) => {
    if (ref) {
      nodeRefs.current.set(id, ref)
    } else {
      nodeRefs.current.delete(id)
    }
  }, [])

  // === 核心：选中变化时，将 Transformer 绑定到 Konva 节点 ===
  useEffect(() => {
    if (!transformerRef.current || selectedIds.length === 0) {
      transformerRef.current?.nodes([])
      return
    }
    // 找到选中的 Konva 节点（过滤已脱离舞台的陈旧节点，防止卡死）
    const nodes: Konva.Node[] = []
    for (const id of selectedIds) {
      const ref = nodeRefs.current.get(id)
      // 安全检查：节点必须仍然挂载在舞台上
      if (ref && ref.getLayer()) nodes.push(ref)
    }
    transformerRef.current.nodes(nodes)
    // 初始 keepRatio：任一选中节点开启锁形 → 等比缩放
    const state = useEditorStore.getState()
    const curPage = state.page
    const anyLocked = state.selectedIds.some(id => {
      const n = curPage ? findNode(curPage.root, id) : null
      return n?.editorLockAspect === true
    })
    transformerRef.current.keepRatio(anyLocked)
    transformerRef.current.getLayer()?.batchDraw()
  }, [selectedIds, page])

  // === 视口缩放操作 ===
  const zoomBy = useCallback((factor: number) => {
    setViewport(prev => {
      const stage = stageRef.current
      if (!stage) return prev
      const newScale = Math.max(0.05, Math.min(5, prev.scale * factor))
      // 以画布中心为缩放原点
      const cx = stage.width() / 2
      const cy = stage.height() / 2
      const wx = (cx - prev.x) / prev.scale
      const wy = (cy - prev.y) / prev.scale
      return { scale: newScale, x: cx - wx * newScale, y: cy - wy * newScale }
    })
  }, [])

  const zoomFit = useCallback(() => {
    if (!page) return
    const stage = stageRef.current
    if (!stage) return
    const margin = 60
    const sw = stage.width()
    const sh = stage.height()
    // 与渲染处同源：预设物理像素需经 Canvas 模式换算成实际渲染画布尺寸，否则适配按错误大小计算导致画布溢出视口
    const dims = computeRenderDims(page, previewPreset, config)
    const dw = dims.w
    const dh = dims.h
    const scale = Math.max(0.05, Math.min(5, Math.min((sw - margin * 2) / dw, (sh - margin * 2) / dh)))
    setViewport({ scale, x: (sw - dw * scale) / 2, y: (sh - dh * scale) / 2 })
  }, [page, previewPreset, config])

  const zoomReset = useCallback(() => {
    setViewport({ x: 40, y: 40, scale: 0.4 })
  }, [])

  // 监听 TopBar 菜单缩放事件
  useEffect(() => {
    const onZoomIn = () => zoomBy(1.25)
    const onZoomOut = () => zoomBy(0.8)
    const onZoomReset = () => zoomReset()
    const onZoomFit = () => zoomFit()
    window.addEventListener('djui:zoomIn', onZoomIn)
    window.addEventListener('djui:zoomOut', onZoomOut)
    window.addEventListener('djui:zoomReset', onZoomReset)
    window.addEventListener('djui:zoomFit', onZoomFit)
    return () => {
      window.removeEventListener('djui:zoomIn', onZoomIn)
      window.removeEventListener('djui:zoomOut', onZoomOut)
      window.removeEventListener('djui:zoomReset', onZoomReset)
      window.removeEventListener('djui:zoomFit', onZoomFit)
    }
  }, [zoomBy, zoomFit, zoomReset])

  // 审计页可把某个设备画像带回画布复核；审计结果本身不再覆盖目录或画布。
  useEffect(() => {
    const onSelectDevicePreview = (event: Event) => {
      const detail = (event as CustomEvent<{ presetId: string; variant?: 'base' | 'wide' }>).detail
      if (!detail) return
      setPreviewPresetId(detail.presetId)
      if (detail.variant) setResponsiveVariant(detail.variant)
      window.setTimeout(() => zoomFit(), 0)
    }
    window.addEventListener('djui:selectDevicePreview', onSelectDevicePreview)
    return () => window.removeEventListener('djui:selectDevicePreview', onSelectDevicePreview)
  }, [zoomFit])

  // F 键聚焦选中控件
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (selectedIds.length === 0 || !page) return
        const node = findNodeById(page.root, selectedIds[0])
        if (!node) return
        const t = node.transform ?? {}
        const cx = (t.x ?? 0) + (t.width ?? 100) / 2
        const cy = (t.y ?? 0) + (t.height ?? 100) / 2

        const stage = stageRef.current
        if (!stage) return
        const stageW = stage.width()
        const stageH = stage.height()
        const targetScale = Math.min(
          (stageW * 0.4) / (t.width ?? 100),
          (stageH * 0.4) / (t.height ?? 100),
          2,
        )
        setViewport({
          scale: Math.max(0.1, targetScale),
          x: stageW / 2 - cx * targetScale,
          y: stageH / 2 - cy * targetScale,
        })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedIds, page])

  // Ctrl+C/V/D/X 复制粘贴克隆剪切
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const isCtrl = e.ctrlKey || e.metaKey
      if (!isCtrl) return
      const key = e.key.toLowerCase()

      // Ctrl+C → 复制
      if (key === 'c' && !e.shiftKey) {
        if (selectedIds.length === 0) return
        const store = useEditorStore.getState()
        if (!store.page) return
        const node = findNode(store.page.root, selectedIds[selectedIds.length - 1])
        if (node) {
          setClipboard(JSON.parse(JSON.stringify(node)))
          e.preventDefault()
        }
        return
      }

      // Ctrl+X → 剪切（复制+删除）
      if (key === 'x' && !e.shiftKey) {
        if (selectedIds.length === 0) return
        const store = useEditorStore.getState()
        if (!store.page) return
        const node = findNode(store.page.root, selectedIds[selectedIds.length - 1])
        if (node) {
          setClipboard(JSON.parse(JSON.stringify(node)))
          for (const id of [...selectedIds]) store.removeNode(id)
          e.preventDefault()
        }
        return
      }

      // Ctrl+V → 粘贴
      if (key === 'v' && !e.shiftKey) {
        if (!getClipboard()) return
        const store = useEditorStore.getState()
        const targetId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null
        store.pasteNode(targetId)
        e.preventDefault()
        return
      }

      // Ctrl+D → 同目录克隆
      if (key === 'd' && !e.shiftKey) {
        if (selectedIds.length === 0) return
        const store = useEditorStore.getState()
        store.duplicateNode(selectedIds[selectedIds.length - 1])
        e.preventDefault()
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedIds])

  // Delete 键删除选中
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 避免在输入框中触发
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        if (selectedIds.length === 0) return
        e.preventDefault()
        const store = useEditorStore.getState()
        for (const id of [...selectedIds]) {
          store.removeNode(id)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedIds])

  // Ctrl+L: 切换锁定 / Ctrl+Shift+L: 全部解锁 / Ctrl+H: 切换隐藏
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const isCtrl = e.ctrlKey || e.metaKey

      // Ctrl+Shift+L → 全部解锁
      if (isCtrl && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        const store = useEditorStore.getState()
        if (!store.page) return
        const unlockAll = (n: UiNode) => {
          if (n.editorLocked) store.updateNode(n.id, { editorLocked: false })
          n.children.forEach(unlockAll)
        }
        unlockAll(store.page.root)
        return
      }

      // Ctrl+L → 切换选中控件锁定
      if (isCtrl && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        if (selectedIds.length === 0) return
        const store = useEditorStore.getState()
        if (!store.page) return
        for (const id of selectedIds) {
          const node = findNode(store.page.root, id)
          if (node) store.updateNode(id, { editorLocked: !node.editorLocked })
        }
        return
      }

      // Ctrl+H → 切换选中控件隐藏
      if (isCtrl && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        if (selectedIds.length === 0) return
        const store = useEditorStore.getState()
        if (!store.page) return
        for (const id of selectedIds) {
          const node = findNode(store.page.root, id)
          if (node) store.updateNode(id, { editorHidden: !node.editorHidden })
        }
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedIds])

  // 编辑器辅助渲染开关
  const [showEditorOverlay, setShowEditorOverlay] = useState(getEditorOverlayVisible)
  const [sliceMeta, setSliceMeta] = useState<Record<string, { left: number; top: number; right: number; bottom: number }>>({})
  const reloadSliceMeta = useCallback(() => {
    if (config?.workspacePath) {
      api.getSliceMeta().then(setSliceMeta)
    }
  }, [config?.workspacePath])
  useEffect(() => { reloadSliceMeta() }, [reloadSliceMeta])
  useEffect(() => {
    const handler = () => reloadSliceMeta()
    window.addEventListener('djui:sliceMetaChanged', handler)
    return () => window.removeEventListener('djui:sliceMetaChanged', handler)
  }, [reloadSliceMeta])
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const isCtrl = e.ctrlKey || e.metaKey
      // Ctrl+Shift+H → 切换编辑器辅助渲染（不影响 editorHidden）
      if (isCtrl && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setShowEditorOverlay(prev => !prev)
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // 属性面板请求切换锚点时，先在当前画布求出旧的视觉矩形；再用新锚点反算偏移/边距。
  // 必须位于“没有页面”的提前 return 之前，保证首次载入页面时 Hook 顺序不变。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        ids: string[]
        side?: DjuiAnchor['side']
        target?: 'parent' | 'screen' | 'safe' | 'image'
        safeEdges?: Array<'left' | 'top' | 'right' | 'bottom'>
      }>).detail
      const layoutContext = reanchorContextRef.current
      if (!detail?.ids?.length || !layoutContext) return
      const store = useEditorStore.getState()
      const currentPage = store.page
      if (!currentPage) return
      const displayRoot = store.responsiveVariant === 'wide'
        ? cloneTreeWithResponsiveOverrides(currentPage.root, currentPage.responsive?.wide.overrides)
        : currentPage.root
      const updatesById: Record<string, Record<string, unknown>> = {}
      for (const id of detail.ids) {
        const currentNode = findNode(displayRoot, id)
        if (!currentNode) continue
        const nextNode: UiNode = JSON.parse(JSON.stringify(currentNode))
        nextNode.anchor = {
          ...nextNode.anchor,
          ...(detail.side !== undefined ? { side: detail.side } : {}),
          ...(detail.target !== undefined ? { target: detail.target } : {}),
          ...(detail.safeEdges !== undefined ? { safeEdges: detail.safeEdges } : {}),
        }
        const parentRect = solveParentRectForNode(displayRoot, id, layoutContext.actualW, layoutContext.actualH, layoutContext.safeRect, layoutContext.imageFrame)
        const oldRect = solveLayout(currentNode, parentRect, layoutContext.actualW, layoutContext.actualH, { safeRect: layoutContext.safeRect, imageFrame: layoutContext.imageFrame ?? undefined }).rect
        const layoutPatch = computeLayoutPatchFromRect(nextNode, parentRect, layoutContext.actualW, layoutContext.actualH, oldRect, layoutContext.safeRect, layoutContext.imageFrame)
        const anchorPatch: Record<string, unknown> = { ...layoutPatch }
        if (detail.side !== undefined) anchorPatch['anchor.side'] = detail.side
        if (detail.target !== undefined) anchorPatch['anchor.target'] = detail.target
        if (detail.safeEdges !== undefined) anchorPatch['anchor.safeEdges'] = detail.safeEdges
        updatesById[id] = anchorPatch
      }
      store.batchUpdateNodes(updatesById)
    }
    window.addEventListener('djui:reanchor', handler)
    return () => window.removeEventListener('djui:reanchor', handler)
  }, [])

  if (!page) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <div style={{ color: '#5b6378' }}>请创建或选择一个窗口</div>
      </div>
    )
  }

  const designW = page.designWidth
  const designH = page.designHeight
  const referenceVisible = page.referenceVisible ?? getReferenceImageVisible(config?.workspacePath, page.pageId)
  const isTemplate = page.nodeKind === 'template'
  // 设备预设保存物理像素；按项目 Canvas 模式换算为 Runtime 使用的逻辑可见区。
  const devicePreset = isTemplate ? null : previewPreset
  const previewPlan = devicePreset && config
    ? createCanvasPlanV6(
        devicePreset.widthPx,
        devicePreset.heightPx,
        devicePreset.safeInsetsPx,
        api.createProjectFileV6(config),
      )
    : null
  const renderDims = computeRenderDims(page, devicePreset, config)
  const actualW = renderDims.w
  const actualH = renderDims.h
  // 调试探针：暴露实际渲染画布尺寸（仅 dev，供 CDP 排查预览换算）
  if (import.meta.env.DEV) {
    ;(window as any).__DJUI_CANVAS_DEBUG__ = {
      previewPresetId, designW, designH, actualW, actualH,
      hasPlan: !!previewPlan,
      planCanvas: previewPlan ? { w: previewPlan.canvasRect.width, h: previewPlan.canvasRect.height } : null,
      config: config ? { mode: config.canvasMode, dw: config.designWidth, dh: config.designHeight } : null,
      viewport: { ...viewport },
    }
  }
  const referenceRect = previewPlan?.referenceRect ?? { x: 0, y: 0, width: designW, height: designH }
  const safeRect = previewPlan?.safeRect ?? { x: 0, y: 0, width: actualW, height: actualH }
  const effectiveRoot = responsiveVariant === 'wide'
    ? cloneTreeWithResponsiveOverrides(page.root, page.responsive?.wide.overrides)
    : page.root
  const pageImageFrame = computePageImageFrame(effectiveRoot, actualW, actualH)
  setCurrentImageFrame(pageImageFrame)
  reanchorContextRef.current = { actualW, actualH, safeRect, imageFrame: pageImageFrame }

  // 后景页由深到浅排列：A → B → C 时先绘制 C，再绘制 B，最后才绘制 A。
  // 运行时不认识这项编辑器专用关联；这里仅用已加载的窗口页做递归合成预览。
  const underlayPages: UiPage[] = []
  const visitedUnderlays = new Set<string>([page.pageId])
  const collectUnderlays = (foregroundId: string) => {
    const backgroundId = pageUnderlays[foregroundId]
    const background = backgroundId ? allPages[backgroundId] : null
    if (!background || background.nodeKind !== 'window' || visitedUnderlays.has(background.pageId)) return
    visitedUnderlays.add(background.pageId)
    collectUnderlays(background.pageId)
    underlayPages.push(background)
  }
  collectUnderlays(page.pageId)
  // 适配审计与实际预览使用同一份画布、安全区和布局求解结果；只在选择设备画像时启用。
  const adaptationAudit = !isTemplate && devicePreset
    ? auditPageAdaptation(
        effectiveRoot,
        { x: 0, y: 0, width: actualW, height: actualH },
        safeRect,
        devicePreset,
        pageImageFrame ?? undefined,
      )
    : null
  const stageW = window.innerWidth - 280 - 340
  const stageH = window.innerHeight - 32

  // === 事件处理 ===

  // 拖放新控件
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const label = e.dataTransfer.getData('text/plain')
    if (!label) return

    const stage = stageRef.current
    if (!stage) return
    const containerRect = stage.container().getBoundingClientRect()

    const screenX = e.clientX - (containerRect?.left ?? 0)
    const screenY = e.clientY - (containerRect?.top ?? 0)
    const canvasX = (screenX - viewport.x) / viewport.scale
    const canvasY = (screenY - viewport.y) / viewport.scale

    const node = createNode(label, label)
    // ★ 如果有选中节点，且是容器类型，新控件成为它的子节点
    const CONTAINER_TYPES = ['Panel', 'SpacingPanel', 'PanelScrollable']
    const sel = useEditorStore.getState().selectedIds
    let parentId: string | null = null
    if (sel.length > 0) {
      const selNode = findNode(page.root, sel[sel.length - 1])
      if (selNode && CONTAINER_TYPES.includes(selNode.starType)) {
        parentId = selNode.id
      }
    }
    // 子节点坐标：如果是成为子节点，坐标转为相对父节点左上角
    if (parentId) {
      const parent = findNode(page.root, parentId)
      if (parent) {
        const pt = parent.transform ?? {}
        node.transform = {
          ...node.transform,
          x: Math.round(canvasX - (pt.x ?? 0)),
          y: Math.round(canvasY - (pt.y ?? 0)),
        }
      }
    } else {
      node.transform = { ...node.transform, x: Math.round(canvasX), y: Math.round(canvasY) }
    }
    addNode(parentId, node)
  }

  // 滚轮缩放
  const handleWheel = (e: any) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const oldScale = viewport.scale
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    }

    const speed = e.evt.ctrlKey ? 1.02 : 1.1
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = Math.max(0.05, Math.min(5, direction > 0 ? oldScale * speed : oldScale / speed))

    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }

  // 鼠标按下：建立统一指针会话
  const handleMouseDown = (e: any) => {
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault()
      setIsPanning(true)
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY, vx: viewport.x, vy: viewport.y }
      return
    }
    if (e.evt.button !== 0) return

    // Transformer 手柄/边框：交给 Transformer 自身处理，不参与选中/拖动会话
    const target = e.target
    let p: any = target
    while (p) {
      if (p === transformerRef.current) return
      p = p.parent
    }

    const modifier = pickModifier(e.evt)
    const startScreen = { x: e.evt.clientX, y: e.evt.clientY }

    // 命中判定：target 带 id → 命中节点；否则（Stage/背景 Rect）→ 空白
    const hitTopId = (target.id && target.id()) || null

    if (hitTopId) {
      // 命中节点：确定拖动候选（已选祖先优先，否则命中点本身）
      const chain = findNodePath(page.root, hitTopId)
      const dragTargetId = pickDragTarget(chain, selectedIds)
      pointerSession.current = {
        mode: 'node',
        hitTopId,
        dragTargetId,
        startScreen,
        modifier,
        moved: false,
        activeDragId: null,
        isGroupDrag: false,
        dragOrigin: { x: 0, y: 0 },
      }
    } else {
      // 空白：暂不立即清空，延迟到 mouseUp（若未拖动才算「点击空白取消选中」）
      pointerSession.current = {
        mode: 'blank',
        hitTopId: null,
        dragTargetId: null,
        startScreen,
        modifier,
        moved: false,
        activeDragId: null,
        isGroupDrag: false,
        dragOrigin: { x: 0, y: 0 },
      }
    }
  }

  // 捕获层命中：命中了一个已选中节点（可能是被更大子节点遮挡的父节点）
  const handleProxyDown = (nodeId: string, modifier: 'none' | 'ctrl' | 'shift', clientX: number, clientY: number) => {
    pointerSession.current = {
      mode: 'node',
      hitTopId: nodeId,      // proxy 命中的就是已选中节点本身
      dragTargetId: nodeId,  // 它已选中，直接作为拖动目标
      startScreen: { x: clientX, y: clientY },
      modifier,
      moved: false,
      activeDragId: null,
      isGroupDrag: false,
      dragOrigin: { x: 0, y: 0 },
    }
  }

  const handleMouseMove = (e: any) => {
    // 中键/右键平移
    if (isPanning) {
      const dx = e.evt.clientX - panStart.current.x
      const dy = e.evt.clientY - panStart.current.y
      setViewport(prev => ({ ...prev, x: panStart.current.vx + dx, y: panStart.current.vy + dy }))
      return
    }

    const session = pointerSession.current
    if (!session) return

    // 计算屏幕位移
    const dx = e.evt.clientX - session.startScreen.x
    const dy = e.evt.clientY - session.startScreen.y
    if (!session.moved) {
      if (Math.abs(dx) < CLICK_THRESHOLD_PX && Math.abs(dy) < CLICK_THRESHOLD_PX) return
      // 首次超过阈值 → 锁定为拖动
      session.moved = true
      if (session.mode === 'node' && session.dragTargetId) {
        const targetId = session.dragTargetId
        // 锁定拖动目标，记录其拖动基准点（无偏移时的位置）
        const entry = proxyEntriesRef.current.find(en => en.id === targetId)
        session.activeDragId = targetId
        const currentSelection = useEditorStore.getState().selectedIds
        session.isGroupDrag = currentSelection.length > 1
          && currentSelection.includes(targetId)
        session.dragOrigin = entry
          ? { x: entry.baseDragX, y: entry.baseDragY }
          : { x: 0, y: 0 }
        // 若拖动的是未选中节点（非多选模式），立即选中它（符合「拖谁选谁」）
        if (!useEditorStore.getState().selectedIds.includes(targetId) && session.modifier === 'none') {
          selectNode(targetId, 'none')
        }
        // 开启 dragPreview（视觉偏移由 NodeShape 渲染树自动跟随）
        setDragPreview({ id: session.isGroupDrag ? '__group__' : targetId, dx: 0, dy: 0 })
      }
    }

    // 已锁定拖动：更新 dragPreview（屏幕位移 → 画布位移）
    if (session.moved && session.activeDragId) {
      const inv = 1 / viewport.scale
      setDragPreview({
        id: session.activeDragId,
        dx: dx * inv,
        dy: dy * inv,
      })
    }
  }

  const handleMouseUp = (e: any) => {
    const wasPanning = isPanning
    setIsPanning(false)
    if (wasPanning) { pointerSession.current = null; return }

    const session = pointerSession.current
    pointerSession.current = null
    if (!session) return

    if (!session.moved) {
      // 未拖动 → 视为点击
      if (session.mode === 'blank') {
        clearSelection()
      } else if (session.hitTopId) {
        // 点击节点：按 modifier 语义选中（none 单选 / ctrl 单点 toggle / shift 范围）
        selectNode(session.hitTopId, session.modifier)
      }
      return
    }

    // 已拖动
    if (session.mode === 'blank') {
      // 空白处拖动（暂无框选）：取消选中，与原「点空白即清空」行为一致
      clearSelection()
      return
    }

    // 已拖动 → 提交位移到 transform（手动驱动模式）
    if (session.activeDragId) {
      const dx = e.evt ? (e.evt.clientX - session.startScreen.x) : 0
      const dy = e.evt ? (e.evt.clientY - session.startScreen.y) : 0
      const inv = 1 / viewport.scale
      const entry = proxyEntriesRef.current.find(en => en.id === session.activeDragId)
      if (session.isGroupDrag) {
        handleSelectedNodesDragEnd(dx * inv, dy * inv)
      } else {
        handleNodeDragEnd(session.activeDragId, {
          x: Math.round((entry?.baseLayoutRect.x ?? session.dragOrigin.x) + dx * inv / (entry?.layoutScaleX ?? 1)),
          y: Math.round((entry?.baseLayoutRect.y ?? session.dragOrigin.y) + dy * inv / (entry?.layoutScaleY ?? 1)),
          width: entry?.baseLayoutRect.width ?? 0,
          height: entry?.baseLayoutRect.height ?? 0,
        })
      }
      setDragPreview(null)
    }
  }
  const handleContextMenu = (e: any) => { e.evt.preventDefault(); e.evt.stopPropagation() }

  // 拖拽结束：按 stretch 轴写 margins，非 stretch 轴写 transform。
  const handleNodeDragEnd = (id: string, desiredRect: LayoutRect) => {
    const store = useEditorStore.getState()
    const currentPage = store.page
    if (!currentPage) return
    const node = findNode(currentPage.root, id)
    if (!node) return
    const parentRect = solveParentRectForNode(currentPage.root, id, actualW, actualH, safeRect, pageImageFrame)
    const patch = computeLayoutPatchFromRect(node, parentRect, actualW, actualH, desiredRect, safeRect, pageImageFrame)
    store.batchUpdateNode(id, patch)
  }

  // 多选整体平移：为每个节点分别按锚点/stretch 语义反算布局，最终作为一个历史步骤提交。
  // 不能直接加 transform.x/y：拉伸轴的位置由 margins 决定，之前因此会出现“只移动部分”的现象。
  const handleSelectedNodesDragEnd = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return
    const store = useEditorStore.getState()
    const currentPage = store.page
    if (!currentPage) return
    const updatesById: Record<string, Record<string, unknown>> = {}
    for (const id of store.selectedIds) {
      const node = findNode(currentPage.root, id)
      const entry = proxyEntriesRef.current.find(item => item.id === id)
      if (!node || !entry || node.editorLocked || node.editorHidden) continue
      const parentRect = solveParentRectForNode(currentPage.root, id, actualW, actualH, safeRect, pageImageFrame)
      updatesById[id] = computeLayoutPatchFromRect(node, parentRect, actualW, actualH, {
        x: entry.baseLayoutRect.x + dx / entry.layoutScaleX,
        y: entry.baseLayoutRect.y + dy / entry.layoutScaleY,
        width: entry.baseLayoutRect.width,
        height: entry.baseLayoutRect.height,
      }, safeRect, pageImageFrame)
    }
    store.batchUpdateNodes(updatesById)
  }

  // 缩放/旋转结束：写回 x/y/width/height/rotation（单次批量更新）
  const handleNodeTransformEnd = (node: UiNode) => {
    const konvaNode = nodeRefs.current.get(node.id)
    if (!konvaNode) return

    const konvaX = konvaNode.x()
    const konvaY = konvaNode.y()
    const scaleX = konvaNode.scaleX()
    const scaleY = konvaNode.scaleY()
    const rotation = Math.round(konvaNode.rotation())

    // 使用 Konva 实际渲染尺寸（避免 stale store 值）
    const renderedW = konvaNode.width() || (node.transform?.width ?? 100)
    const renderedH = konvaNode.height() || (node.transform?.height ?? 100)
    const newWidth = Math.max(1, Math.round(renderedW * scaleX))
    const newHeight = Math.max(1, Math.round(renderedH * scaleY))

    const page = useEditorStore.getState().page
    const currentNode = page ? (findNode(page.root, node.id) ?? node) : node
    const parentRect = page
      ? solveParentRectForNode(page.root, node.id, actualW, actualH, safeRect, pageImageFrame)
      : { x: 0, y: 0, width: actualW, height: actualH }
    const layoutPatch = computeLayoutPatchFromRect(currentNode, parentRect, actualW, actualH, {
      x: konvaX,
      y: konvaY,
      width: newWidth,
      height: newHeight,
    }, safeRect, pageImageFrame)

    // 先重置 Konva scale（已烘焙到 width/height）
    konvaNode.scaleX(1)
    konvaNode.scaleY(1)

    // 单次批量写回 store（一次 pushHistory，一次 set）
    useEditorStore.getState().batchUpdateNode(node.id, {
      ...layoutPatch,
      'transform.rotation': rotation,
    })
  }

  // 选中回调
  const handleSelect = (id: string, modifier: 'none' | 'ctrl' | 'shift') => {
    selectNode(id, modifier)
  }

  const invScale = 1 / viewport.scale

  // 收集所有节点的显示信息：已选节点用于渲染捕获层，全部节点用于拖动基准点查询
  const allEntries: ProxyEntry[] = []
  for (const child of page.root.children) {
    collectProxyEntries(child, { x: 0, y: 0, width: actualW, height: actualH }, actualW, actualH, { x: 0, y: 0 }, dragPreview, allEntries)
  }
  // 已选中 + 未锁 + 未隐 的节点 → 渲染捕获层
  const selectedSet = new Set(selectedIds)
  const proxyEntries: ProxyEntry[] = allEntries.filter(en => {
    if (!selectedSet.has(en.id)) return false
    const node = findNode(page.root, en.id)
    return !!node && !node.editorLocked && !node.editorHidden
  })
  // 同步到 ref 供事件处理时查询拖动基准点（含未选中节点，支持拖动未选中节点）
  proxyEntriesRef.current = allEntries

  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#0d0f15', cursor: isPanning ? 'grabbing' : 'default' }}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onContextMenu={e => e.preventDefault()}
    >
      <Stage
        ref={stageRef as any}
        width={stageW}
        height={stageH}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
      >
        {/* === 主图层（可缩放平移） === */}
        <Layer>
          {/* 背景（不拦截事件，让点击穿透到 Stage 触发取消选中） */}
          <Rect x={0} y={0} width={stageW} height={stageH} fill="#0d0f15" listening={false} />

          <Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale} clipX={0} clipY={0} clipWidth={actualW} clipHeight={actualH}>
            {/* 实际预览分辨率区域 */}
            <Rect
              x={0} y={0} width={actualW} height={actualH}
              fill="#161a23"
              stroke="#2a5a8a"
              strokeWidth={2 * invScale}
              dash={[10 * invScale, 5 * invScale]}
              listening={false}
            />
            {!isTemplate && devicePreset && (
              <Rect
                x={referenceRect.x} y={referenceRect.y}
                width={referenceRect.width} height={referenceRect.height}
                fill="none" stroke="#7c89a8"
                strokeWidth={1 * invScale}
                dash={[6 * invScale, 4 * invScale]}
                listening={false}
              />
            )}
            <Text
              text={`${actualW} x ${actualH}${isTemplate ? ' (模板)' : (devicePreset ? ' (预览)' : ' (设计)')}`}
              x={4} y={-20 * invScale}
              fontSize={12 * invScale}
              fill={isTemplate ? '#b37feb' : (devicePreset ? '#ffaa44' : '#5b6378')}
              listening={false}
            />
            {previewPlan && (
              <>
                <Rect
                  x={safeRect.x}
                  y={safeRect.y}
                  width={safeRect.width}
                  height={safeRect.height}
                  fill="rgba(42, 190, 150, 0.05)"
                  stroke="#2abe96"
                  strokeWidth={2 * invScale}
                  dash={[7 * invScale, 4 * invScale]}
                  listening={false}
                />
                <Text
                  text="Safe Area"
                  x={safeRect.x + 4 * invScale}
                  y={safeRect.y + 4 * invScale}
                  fontSize={11 * invScale}
                  fill="#2abe96"
                  listening={false}
                />
              </>
            )}

            {/* 后景关联：递归页已按由深到浅排序，只读且不接收任何命中事件。 */}
            {underlayPages.map(underlay => {
              const underlayRoot = responsiveVariant === 'wide'
                ? cloneTreeWithResponsiveOverrides(underlay.root, underlay.responsive?.wide.overrides)
                : underlay.root
              const underlayImageFrame = computePageImageFrame(underlayRoot, actualW, actualH)
              return underlayRoot.children.map(child => (
                <NodeShape
                  key={`underlay-${underlay.pageId}-${child.id}`}
                  node={child}
                  isSelected={false}
                  selectedIds={[]}
                  onSelect={() => {}}
                  onDragEnd={() => {}}
                  onDragPreviewChange={() => {}}
                  onTransformEnd={() => {}}
                  registerRef={() => {}}
                  workspacePath={workspacePath}
                  projectPath={projectPath}
                  parentRect={{ x: 0, y: 0, width: actualW, height: actualH }}
                  canvasWidth={actualW}
                  canvasHeight={actualH}
                  safeRect={safeRect}
                  imageFrame={underlayImageFrame}
                  showEditorOverlay={false}
                  sliceMeta={sliceMeta}
                  dragPreview={null}
                  inheritedDragDelta={{ x: 0, y: 0 }}
                  readOnly
                />
              ))
            })}

            {/* 所有控件（root 的子节点，父矩形=实际预览分辨率） */}
            {effectiveRoot.children.map(child => (
              <NodeShape
                key={child.id}
                node={child}
                isSelected={selectedIds.includes(child.id)}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onDragEnd={handleNodeDragEnd}
                onDragPreviewChange={setDragPreview}
                onTransformEnd={handleNodeTransformEnd}
                registerRef={registerRef}
                workspacePath={workspacePath}
                projectPath={projectPath}
                parentRect={{ x: 0, y: 0, width: actualW, height: actualH }}
                canvasWidth={actualW}
                canvasHeight={actualH}
                safeRect={safeRect}
                imageFrame={pageImageFrame}
                showEditorOverlay={showEditorOverlay}
                sliceMeta={sliceMeta}
                dragPreview={dragPreview}
                inheritedDragDelta={{ x: 0, y: 0 }}
              />
            ))}

            {/* ★ 选中节点拖动捕获层：渲染在所有节点之上。
                作用：更大的子节点盖住已选父节点时，按下父节点区域命中本层 → 拖父节点。
                未选中节点无此层，点击/拖动仍落到节点本身（由上面的指针会话处理）。 */}
            <DragProxyLayer
              entries={proxyEntries}
              onProxyDown={handleProxyDown}
            />

            {/* ★ 参考效果图（半透明、穿透、铺满设计区，渲染在最上层） */}
            <RefImageLayer
              refPath={page.referenceImage ?? null}
              visible={referenceVisible}
              opacity={page.referenceOpacity ?? 0.5}
              width={actualW}
              height={actualH}
            />
            {/* 设备画像的局部障碍：背景可穿过；文字、交互控件由适配审计单独报告。 */}
            {adaptationAudit?.visualObstacles.map((obstacle, index) => (
              <Rect
                key={'visual-obstacle-' + index}
                x={obstacle.x} y={obstacle.y} width={obstacle.width} height={obstacle.height}
                fill="rgba(244, 180, 0, 0.34)" stroke="#f4b400"
                strokeWidth={2 * invScale} listening={false}
              />
            ))}
            {adaptationAudit?.touchObstacles.map((obstacle, index) => (
              <Rect
                key={'touch-obstacle-' + index}
                x={obstacle.x} y={obstacle.y} width={obstacle.width} height={obstacle.height}
                fill="rgba(255, 77, 79, 0.16)" stroke="#ff7875"
                strokeWidth={1 * invScale} dash={[5 * invScale, 3 * invScale]} listening={false}
              />
            ))}

            {/* 锚点/Pivot 可视化（仅选中单个控件 + overlay 开启时显示） */}
            {showEditorOverlay && selectedIds.length === 1 && (() => {
              const selNode = findNode(page.root, selectedIds[0])
              if (!selNode) return null
              // 场景画板内使用局部坐标后再整体缩放；普通锚点辅助线没有该映射语义，
              // 为避免画出错误参考线，此处暂不显示（节点本体仍可直接编辑）。
              const selectedPath = findNodePath(page.root, selectedIds[0])
              if (selectedPath?.slice(0, -1).some(item => !!item.sceneFrame)) return null
              // 父节点矩形：从画布矩形出发沿路径逐级求解（跳过 root——root 无 transform，
              // 进 solver 会被解成 100×100 兜底矩形，导致锚点标记整体错位）。
              // 这与 NodeShape 渲染链的 parentRect 递归完全一致。
              let parentRect = { x: 0, y: 0, width: actualW, height: actualH }
              for (let i = 1; i < (selectedPath?.length ?? 1) - 1; i++) {
                parentRect = solveLayout(selectedPath![i], parentRect, actualW, actualH).rect
              }
              return (
                <AnchorOverlay
                  node={selNode}
                  parentRect={parentRect}
                  safeRect={safeRect}
                  designW={actualW}
                  designH={actualH}
                  invScale={invScale}
                />
              )
            })()}
            {/* 多选移动 Gizmo（Unity 风格 XY 轴箭头，≥2 个同父选中节点时显示）。
                放在 viewport Group 内，坐标随画布缩放/平移，与节点一致。 */}
            {(() => {
              if (!page || selectedIds.length < 2) return null
              // 场景画板内的移动量是 artboard 局部坐标；多选 Gizmo 当前只处理画布坐标，
              // 先不对场景子项显示，避免把屏幕像素误写成素材坐标。
              if (selectedIds.some(id => findNodePath(page.root, id)?.slice(0, -1).some(item => !!item.sceneFrame))) return null
              // 算选中组的包围盒中心（画布坐标）
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
              let count = 0
              for (const id of selectedIds) {
                const path = findPath(page.root, id)
                if (!path) continue
                let parentRect: LayoutRect = { x: 0, y: 0, width: actualW, height: actualH }
                for (let i = 1; i < path.length; i++) {
                  const solved = solveLayout(path[i], parentRect, actualW, actualH)
                  if (i === path.length - 1) {
                    const r = solved.rect
                    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y)
                    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height)
                    count++
                  }
                  parentRect = solved.rect
                }
              }
              if (count < 2) return null
              const cx = (minX + maxX) / 2
              const cy = (minY + maxY) / 2
              return (
                <MoveGizmo
                  centerX={cx} centerY={cy} scale={viewport.scale}
                  onDragStart={() => setDragPreview({ id: '__group__', dx: 0, dy: 0 })}
                  onDrag={(dx, dy) => setDragPreview({ id: '__group__', dx, dy })}
                  onDragEnd={(dx, dy) => {
                    setDragPreview(null)
                    handleSelectedNodesDragEnd(dx, dy)
                  }}
                />
              )
            })()}
          </Group>
        </Layer>

        {/* === Transformer 图层（在上方，不受缩放影响） === */}
        <Layer>
          <Transformer
            ref={transformerRef as any}
            rotateEnabled={true}
            borderStroke="#5ab9ff"
            borderStrokeWidth={1.5}
            anchorStroke="#5ab9ff"
            anchorFill="#ffffff"
            anchorSize={8}
            anchorCornerRadius={1}
            rotateAnchorOffset={24}
            rotateAnchorCornerRadius={4}
            padding={1}
            ignoreStroke={true}
            flipEnabled={false}
            keepRatio={false}
            onTransform={() => {
              const tr = transformerRef.current
              if (!tr) return
              // 任一选中节点开启锁形 → 等比；否则沿用 Shift 临时等比（PS 风格）
              const state = useEditorStore.getState()
              const curPage = state.page
              const anyLocked = state.selectedIds.some(id => {
                const n = curPage ? findNode(curPage.root, id) : null
                return n?.editorLockAspect === true
              })
              const shift = (window.event as KeyboardEvent)?.shiftKey
              tr.keepRatio(anyLocked || !!shift)
            }}
            boundBoxFunc={(oldBox, newBox) => {
              if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) return oldBox
              return newBox
            }}
          />
        </Layer>
      </Stage>

      {/* 缩放显示 + 设备切换 */}
      <div style={{
        position: 'absolute', bottom: 16, right: 356,
        background: '#1a1d28', border: '1px solid #2a3142', borderRadius: 6,
        padding: '4px 12px', fontSize: 12, color: '#9aa3b4', zIndex: 100,
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        {!isTemplate && (
          <select
            value={responsiveVariant}
            onChange={e => setResponsiveVariant(e.target.value as 'base' | 'wide')}
            style={{
              background: responsiveVariant === 'wide' ? '#2a1f0f' : '#0f1117',
              color: responsiveVariant === 'wide' ? '#ffaa44' : '#5ab9ff',
              border: '1px solid #2a3142', borderRadius: 4, padding: '2px 6px', fontSize: 11,
            }}
            title="选择正在编辑的响应式层"
          >
            <option value="base">基础层</option>
            <option value="wide">宽屏层</option>
          </select>
        )}
        {/* 设备切换 */}
        {isTemplate ? (
          <span style={{ color: '#b37feb', fontSize: 11 }}>模板 ({designW}×{designH})</span>
        ) : (
          <select
            value={previewPresetId ?? 'design'}
            onChange={e => {
              const v = e.target.value
              setPreviewPresetId(v === 'design' ? null : v)
              setTimeout(() => zoomFit(), 0)
            }}
            style={{
              background: '#0f1117', color: previewPresetId ? '#ffaa44' : '#9aa3b4',
              border: '1px solid #2a3142', borderRadius: 4, padding: '2px 6px', fontSize: 11,
              cursor: 'pointer',
            }}
            title="切换预览分辨率"
          >
            <option value="design">设计 ({designW}×{designH})</option>
            {config && devicePresetsForOrientationV6(config.orientation).map(device => (
              <option key={device.id} value={device.id}>{device.label}</option>
            ))}
          </select>
        )}
        <span
          style={{ cursor: 'pointer', color: '#5ab9ff' }}
          onClick={() => zoomFit()}
          title="适配到窗口"
        >
          {Math.round(viewport.scale * 100)}%
        </span>
        <span style={{ color: '#3a4258' }}>|</span>
        <span style={{ fontSize: 10 }}>
          中键/右键平移 · 滚轮缩放 · F聚焦 · Del删除
        </span>
        <span style={{ color: '#3a4258' }}>|</span>
        <span
          style={{ fontSize: 10, cursor: 'pointer', color: showEditorOverlay ? '#5ab9ff' : '#5b6378' }}
          onClick={() => {
            const next = !showEditorOverlay
            setEditorOverlayVisible(next)
            setShowEditorOverlay(next)
          }}
          title="Ctrl+Shift+H 切换辅助渲染"
        >
          {showEditorOverlay ? '◉ 辅助线' : '○ 辅助线'}
        </span>
        <span
          style={{ fontSize: 10, cursor: 'pointer', color: referenceVisible ? '#5ab9ff' : '#5b6378' }}
          onClick={() => {
            const next = !referenceVisible
            useEditorStore.getState().updatePageMeta(page.pageId, { referenceVisible: next })
            setReferenceImageVisible(config?.workspacePath, page.pageId, next)
          }}
          title="切换效果图显示"
        >
          {referenceVisible ? '◉ 效果图' : '○ 效果图'}
        </span>
      </div>
    </div>
  )
}

// === 锚点/拉伸/Pivot 可视化叠加层 ===
// 在主 Group 内绘制（受视口缩放影响）：
// 1. 参考线：经过锚点、贯穿参考物的水平/垂直虚线（不再画整框）
// 2. 锚点十字 + 「锚点」文字标签（标签避让到控件外）
// 3. 外延线：锚点 → pivot 的横纵两条分量线
// 4. 拉伸边距线、Pivot 十字标
// side=None 且无拉伸时不画任何参考元素，最大限度减少干扰。
interface AnchorOverlayProps {
  node: UiNode
  parentRect: { x: number; y: number; width: number; height: number }
  safeRect: { x: number; y: number; width: number; height: number } | null
  designW: number
  designH: number
  invScale: number
}

function AnchorOverlay({ node, parentRect, safeRect, designW, designH, invScale }: AnchorOverlayProps) {
  const anchor = node.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const side = getAnchorSide(sideId)
  const stretch = node.stretch ?? {}
  const stretchStyle = stretch.style ?? 'None'

  // 拉伸轴判断
  const hStretch = stretchStyle === 'Horizontal' || stretchStyle === 'Both'
  const vStretch = stretchStyle === 'Vertical' || stretchStyle === 'Both'
  const margins = stretch.margins ?? { left: 0, right: 0, top: 0, bottom: 0 }

  // 无锚定且无拉伸：什么都不画，只保留选中框与 pivot 标（选中框由节点本体绘制）
  const anchored = sideId !== 'None'
  if (!anchored && !hStretch && !vStretch) return null

  // 参考矩形（屏幕坐标，左上 + 尺寸）：锚定参考线/锚点定位的基准
  const ref = target === 'screen'
    ? { x: 0, y: 0, width: designW, height: designH }
    : target === 'safe' && safeRect
      ? safeRect
      : parentRect

  // 锚点位置（屏幕坐标）
  // nx: 0=左 0.5=中 1=右 → 屏幕 X
  // ny: uGUI Y 朝上(0=底 1=顶) → 屏幕 Y（翻转）
  const anchorX = side ? ref.x + side.nx * ref.width : ref.x
  const anchorY = side ? ref.y + (1 - side.ny) * ref.height : ref.y

  // 控件矩形（屏幕坐标，用 layoutSolver 算）
  const solved = solveLayout(node, parentRect, designW, designH)
  const nx = solved.rect.x
  const ny = solved.rect.y
  const nw = solved.rect.width
  const nh = solved.rect.height

  // pivot 屏幕位置
  const pivotX = solved.pivotX
  const pivotY = solved.pivotY

  const dotColor = '#ffaa44'
  const lineColor = '#5ab9ff'
  const pivotColor = '#ff4d8f'
  // 外延线分色：横向与纵向分量一眼可分
  const extHColor = '#64d2ff'
  const extVColor = '#ffb15e'

  // 「锚点」标签避让控件：默认在十字右下，若落入控件矩形则推到控件外的上/下侧
  const labelFontSize = 11 * invScale
  const labelW = 26 * invScale
  const labelH = labelFontSize + 2 * invScale
  let labelX = anchorX + 8 * invScale
  let labelY = anchorY + 6 * invScale
  const insideNode = labelX > nx - labelW && labelX < nx + nw && labelY > ny - labelH && labelY < ny + nh
  if (insideNode) {
    if (anchorY < ny + nh / 2) labelY = ny - labelH - 3 * invScale
    else labelY = ny + nh + 3 * invScale
    labelX = Math.min(Math.max(anchorX - labelW / 2, nx), nx + nw - labelW)
  }

  return (
    <>
      {/* target=safe：安全区在画布上没有其他可视化，选中锚定安全区的控件时画出安全区框 */}
      {target === 'safe' && safeRect && (
        <Rect
          x={safeRect.x} y={safeRect.y} width={safeRect.width} height={safeRect.height}
          fill="none" stroke={lineColor} strokeWidth={1 * invScale}
          dash={[4 * invScale, 4 * invScale]} opacity={0.3} listening={false}
        />
      )}

      {/* 参考线：经过锚点、贯穿参考物的水平/垂直虚线（不画整框）。
          与控件矩形重叠的段落断开跳过——辅助线不遮素材本身的效果预览。 */}
      {anchored && (() => {
        const lineStyle: Pick<Konva.LineConfig, 'stroke' | 'strokeWidth' | 'opacity' | 'dash' | 'listening'> = { stroke: lineColor, strokeWidth: 1 * invScale, opacity: 0.3, dash: [5 * invScale, 4 * invScale], listening: false }
        const refTop = ref.y, refBottom = ref.y + ref.height, refLeft = ref.x, refRight = ref.x + ref.width
        const segs: Array<{ key: string; pts: number[] }> = []
        const push = (key: string, x1: number, y1: number, x2: number, y2: number) => {
          if (Math.abs(x2 - x1) < 0.5 && Math.abs(y2 - y1) < 0.5) return
          segs.push({ key, pts: [x1, y1, x2, y2] })
        }
        if (anchorX >= nx && anchorX <= nx + nw) {
          // 锚点 X 穿过控件：竖线只画控件上方与下方两段
          push('ref-v-top', anchorX, refTop, anchorX, ny)
          push('ref-v-bottom', anchorX, ny + nh, anchorX, refBottom)
        } else {
          push('ref-v', anchorX, refTop, anchorX, refBottom)
        }
        if (anchorY >= ny && anchorY <= ny + nh) {
          // 锚点 Y 穿过控件：横线只画控件左侧与右侧两段
          push('ref-h-left', refLeft, anchorY, nx, anchorY)
          push('ref-h-right', nx + nw, anchorY, refRight, anchorY)
        } else {
          push('ref-h', refLeft, anchorY, refRight, anchorY)
        }
        return (
          <>
            {segs.map(s => <Line key={s.key} points={s.pts} {...lineStyle} />)}
          </>
        )
      })()}

      {/* 拉伸指示：拉伸轴用箭头线 */}
      {hStretch && (
        <>
          {/* 左边距线 */}
          <Line
            points={[ref.x + margins.left, ref.y, ref.x + margins.left, ref.y + ref.height]}
            stroke={lineColor} strokeWidth={1 * invScale} opacity={0.4} dash={[3 * invScale, 3 * invScale]} listening={false}
          />
          {/* 右边距线 */}
          <Line
            points={[ref.x + ref.width - margins.right, ref.y, ref.x + ref.width - margins.right, ref.y + ref.height]}
            stroke={lineColor} strokeWidth={1 * invScale} opacity={0.4} dash={[3 * invScale, 3 * invScale]} listening={false}
          />
        </>
      )}
      {vStretch && (
        <>
          {/* 顶边距线 */}
          <Line
            points={[ref.x, ref.y + margins.top, ref.x + ref.width, ref.y + margins.top]}
            stroke={lineColor} strokeWidth={1 * invScale} opacity={0.4} dash={[3 * invScale, 3 * invScale]} listening={false}
          />
          {/* 底边距线 */}
          <Line
            points={[ref.x, ref.y + ref.height - margins.bottom, ref.x + ref.width, ref.y + ref.height - margins.bottom]}
            stroke={lineColor} strokeWidth={1 * invScale} opacity={0.4} dash={[3 * invScale, 3 * invScale]} listening={false}
          />
        </>
      )}

      {/* 锚点标记（十字 + 圆点）+ 「锚点」文字标签（控件外） */}
      {anchored && (
        <Group listening={false}>
          <Group x={anchorX} y={anchorY}>
            <Line
              points={[-6 * invScale, 0, 6 * invScale, 0]}
              stroke={dotColor} strokeWidth={1.2 * invScale}
            />
            <Line
              points={[0, -6 * invScale, 0, 6 * invScale]}
              stroke={dotColor} strokeWidth={1.2 * invScale}
            />
            <Circle
              radius={3 * invScale}
              fill={dotColor}
              stroke="#000"
              strokeWidth={0.5 * invScale}
            />
          </Group>
          <Text
            x={labelX} y={labelY} text="锚点" fontSize={labelFontSize}
            fill={dotColor} listening={false}
          />
        </Group>
      )}

      {/* 外延线：锚点 → 控件边框的 L 形路径（先纵后横），全程贴素材外沿、不进内部。
          纵向段从锚点下到控件近端边所在高度，横向段再连到控件近端边框。 */}
      {anchored && (() => {
        const lineProps = { strokeWidth: 1.4 * invScale, opacity: 0.85, listening: false } as const
        // 纵段终点：锚点落到控件近端边的 Y（锚点在控件行内则该段为零）
        const joinY = anchorY < ny ? ny : anchorY > ny + nh ? ny + nh : anchorY
        // 横段终点：控件近端边的 X（锚点在控件列内则该段为零）
        const joinX = anchorX < nx ? nx : anchorX > nx + nw ? nx + nw : anchorX
        return (
          <>
            {Math.abs(joinY - anchorY) > 0.5 && (
              <Line points={[anchorX, anchorY, anchorX, joinY]} stroke={extVColor} {...lineProps} />
            )}
            {Math.abs(joinX - anchorX) > 0.5 && (
              <Line points={[anchorX, joinY, joinX, joinY]} stroke={extHColor} {...lineProps} />
            )}
          </>
        )
      })()}

      {/* Pivot 十字标（控件中心点） */}
      <Group x={pivotX} y={pivotY} listening={false}>
        <Line
          points={[-8 * invScale, 0, 8 * invScale, 0]}
          stroke={pivotColor} strokeWidth={1.2 * invScale}
        />
        <Line
          points={[0, -8 * invScale, 0, 8 * invScale]}
          stroke={pivotColor} strokeWidth={1.2 * invScale}
        />
        <Circle
          radius={3 * invScale}
          fill={pivotColor}
          stroke="#000"
          strokeWidth={0.5 * invScale}
        />
      </Group>
    </>
  )
}

// === 多选移动 Gizmo（Unity 风格 XY 轴箭头）===
// 仅多选时渲染于选中组中心；拖 X 轴改 x、Y 轴改 y、中心原点改 x+y。
interface MoveGizmoProps {
  centerX: number          // 选中组包围盒中心（画布坐标）
  centerY: number
  scale: number            // 视口缩放（用于恒定屏幕像素尺寸）
  onDragStart: () => void  // 开始拖动（设 dragPreview = __group__）
  onDrag: (dx: number, dy: number) => void   // 拖动中（dx/dy 为画布位移）
  onDragEnd: (dx: number, dy: number) => void // 结束拖动（提交 moveSelection）
}

function MoveGizmo({ centerX, centerY, scale, onDragStart, onDrag, onDragEnd }: MoveGizmoProps) {
  const invScale = 1 / scale
  const arrowLen = 36 * invScale       // 箭头长度（屏幕 36px）
  const pointerLen = 8 * invScale      // 箭头头长
  const pointerWidth = 8 * invScale    // 箭头头宽
  const axisStroke = 2 * invScale      // 轴线粗细
  const handleRadius = 5 * invScale    // 中心原点半径

  // 拖动状态：哪个轴 + 起始屏幕坐标 + 累计画布位移
  const dragRef = useRef<{ axis: 'x' | 'y' | 'center'; startClientX: number; startClientY: number; cur: { dx: number; dy: number } } | null>(null)

  const beginDrag = (e: any, axis: 'x' | 'y' | 'center') => {
    // 必须用 cancelBubble 阻止 Konva 事件冒泡到 Stage（否则 Stage 会创建 pointerSession 干扰）
    e.cancelBubble = true
    const cx = e.evt.clientX
    const cy = e.evt.clientY
    dragRef.current = { axis, startClientX: cx, startClientY: cy, cur: { dx: 0, dy: 0 } }
    onDragStart()
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const ddx = (ev.clientX - dragRef.current.startClientX) / scale
      const ddy = (ev.clientY - dragRef.current.startClientY) / scale
      // 按轴约束：x 轴只 dx、y 轴只 dy、center 都要
      const ndx = dragRef.current.axis === 'y' ? 0 : ddx
      const ndy = dragRef.current.axis === 'x' ? 0 : ddy
      dragRef.current.cur = { dx: ndx, dy: ndy }
      onDrag(ndx, ndy)
    }
    const onUp = () => {
      if (dragRef.current) {
        onDragEnd(dragRef.current.cur.dx, dragRef.current.cur.dy)
        dragRef.current = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <Group x={centerX} y={centerY}>
      {/* X 轴（红，水平向右）*/}
      <Arrow
        points={[0, 0, arrowLen, 0]}
        pointerLength={pointerLen} pointerWidth={pointerWidth}
        stroke="#ff5a5a" fill="#ff5a5a" strokeWidth={axisStroke}
        hitStrokeWidth={12 * invScale}
        onMouseDown={(e) => beginDrag(e, 'x')}
        style={{ cursor: 'ew-resize' }}
      />
      {/* Y 轴（绿，垂直向上，Konva Y 向下为正，故箭头指 -y）*/}
      <Arrow
        points={[0, 0, 0, -arrowLen]}
        pointerLength={pointerLen} pointerWidth={pointerWidth}
        stroke="#5aff7a" fill="#5aff7a" strokeWidth={axisStroke}
        hitStrokeWidth={12 * invScale}
        onMouseDown={(e) => beginDrag(e, 'y')}
        style={{ cursor: 'ns-resize' }}
      />
      {/* 中心原点（同时改 x+y）*/}
      <Circle
        radius={handleRadius}
        fill="#5ab9ff" stroke="#000" strokeWidth={0.5 * invScale}
        onMouseDown={(e) => beginDrag(e, 'center')}
        style={{ cursor: 'move' }}
      />
    </Group>
  )
}

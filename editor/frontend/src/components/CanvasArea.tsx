import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Group, Transformer, Line, Image as KImage, Circle, Path } from 'react-konva'
import { useEditorStore, createNode, findNode, findParent, getClipboard, setClipboard } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'
import { UiNode } from '@/types/layout'
import * as api from '@/api/client'
import { useEngineImage, useWorkspaceImage } from '@/hooks/useImageUrl'
import { DEFAULT_ANCHOR_SIDE, DEFAULT_PIVOT, getAnchorSide } from '@/utils/anchorPresets'
import { solveLayout, Rect as LayoutRect } from '@/utils/layoutSolver'
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
  const fontFamily = font ? `"${font}"` : undefined
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
    wrap: wrapEnabled ? 'word' as const : 'none' as const,
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

function solveParentRectForNode(root: UiNode, id: string, canvasWidth: number, canvasHeight: number): LayoutRect {
  const path = findNodePath(root, id)
  let rect: LayoutRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  if (!path) return rect
  for (let i = 1; i < path.length - 1; i++) {
    rect = solveLayout(path[i], rect, canvasWidth, canvasHeight).rect
  }
  return rect
}

function getLayoutRef(node: UiNode, parentRect: LayoutRect, canvasWidth: number, canvasHeight: number): LayoutRect {
  const target = node.anchor?.target ?? 'parent'
  return target === 'screen'
    ? { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
    : parentRect
}

function getStretchAxes(node: UiNode) {
  const style = node.stretch?.style ?? 'None'
  return {
    horizontal: style === 'Horizontal' || style === 'Both',
    vertical: style === 'Vertical' || style === 'Both',
  }
}

function computeLayoutPatchFromRect(
  node: UiNode,
  parentRect: LayoutRect,
  canvasWidth: number,
  canvasHeight: number,
  desiredRect: LayoutRect,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const anchor = node.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const side = getAnchorSide(sideId)
  const ref = getLayoutRef(node, parentRect, canvasWidth, canvasHeight)
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
    if (sideId === 'None' || target === 'none' || !side) {
      patch['transform.x'] = Math.round(desiredRect.x)
    } else {
      const anchorX = ref.x + side.nx * ref.width
      patch['transform.x'] = Math.round(desiredRect.x - anchorX + side.nx * desiredRect.width)
    }
    patch['transform.width'] = Math.max(1, Math.round(desiredRect.width))
  }

  if (!stretchAxes.vertical) {
    if (sideId === 'None' || target === 'none' || !side) {
      patch['transform.y'] = Math.round(desiredRect.y)
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
    : (!isTransparent ? (bgColor ?? undefined) : (showEditorOverlay ? '#1e2a3a' : undefined))
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
  onSelect: (id: string, additive: boolean) => void
  onDragEnd: (id: string, rect: LayoutRect) => void
  onDragPreviewChange: (preview: DragPreview | null) => void
  onTransformEnd: (node: UiNode) => void
  registerRef: (id: string, ref: Konva.Node | null) => void
  workspacePath: string
  projectPath: string
  parentRect: LayoutRect       // 父节点矩形（屏幕坐标）
  canvasWidth: number          // 画布（设计/模拟）宽度
  canvasHeight: number
  showEditorOverlay: boolean   // 编辑器辅助渲染开关
  sliceMeta: Record<string, { left: number; top: number; right: number; bottom: number }>
  dragPreview: DragPreview | null
  inheritedDragDelta: Vec2
}

function NodeShape({ node, isSelected, selectedIds, onSelect, onDragEnd, onDragPreviewChange, onTransformEnd, registerRef, workspacePath, projectPath, parentRect, canvasWidth, canvasHeight, showEditorOverlay, sliceMeta, dragPreview, inheritedDragDelta }: NodeShapeProps) {
  const { config } = useProjectStore()
  const allPages = useEditorStore(s => s.allPages)
  const defaultFont = config?.defaultFont ?? null

  // ★ 所有 hooks 必须在任何 return null 之前调用
  const app_preview = node.appearance ?? {}
  // 异步获取引擎图片 URL（pure-frontend FS API）
  const imgUrl = useEngineImage(app_preview.image ?? null)
  const image = useImage(imgUrl)

  // 编辑器隐藏：不渲染（子节点也跟着隐藏）
  if (node.editorHidden) return null

  const t = node.transform ?? {}
  const opacity = t.opacity ?? 1
  const rotation = t.rotation ?? 0
  const app = node.appearance ?? {}
  const bgColor = app.background

  // ★ 用 solver 算出最终屏幕矩形（应用了 anchor + stretch + aspectRatio）
  const { rect: solved } = solveLayout(node, parentRect, canvasWidth, canvasHeight)
  const x = solved.x
  const y = solved.y
  const width = solved.width
  const height = solved.height
  const ownDragDelta = dragPreview?.id === node.id ? { x: dragPreview.dx, y: dragPreview.dy } : { x: 0, y: 0 }
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
          stroke={isSelected ? '#b37feb' : (showEditorOverlay ? '#6f4aa8' : undefined)}
          strokeWidth={isSelected ? 2 : 1}
          dash={[6, 4]}
          draggable={isSelected && !node.editorLocked}
          listening={!node.editorLocked}
          onMouseDown={(e) => {
            const evt = e.evt as MouseEvent
            if (evt.button !== 0) return
            e.cancelBubble = true
            onSelect(node.id, evt.shiftKey || evt.ctrlKey || evt.metaKey)
          }}
          onTap={(e) => {
            const evt = e.evt as MouseEvent
            e.cancelBubble = true
            onSelect(node.id, evt.shiftKey || evt.ctrlKey || evt.metaKey)
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

  // 背景色：如果有设背景就用；有图片时不画底色
  // 编辑器辅助底色：空控件显示的半透明色（可被 overlay 开关关闭）
  const isTransparent = isTransparentColor(bgColor)
  const fillColor = hasImage
    ? undefined
    : (!isTransparent ? (bgColor ?? undefined) : (showEditorOverlay ? '#1e2a3a' : undefined))
  const sliceEdges = app.image ? sliceMeta[app.image] : undefined
  const useNineSlice = !!(image && sliceEdges && (sliceEdges.left || sliceEdges.top || sliceEdges.right || sliceEdges.bottom))
  const borderThickness = positiveNumber(app.borderThickness)

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
        stroke={showEditorOverlay ? (isSelected ? '#5ab9ff' : '#3a4258') : undefined}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={app.cornerRadius ?? 0}
        dash={node.basic?.isStatic ? [5, 5] : undefined}
        draggable={isSelected && !node.editorLocked}
        listening={!node.editorLocked}
        onMouseDown={(e) => {
          const evt = e.evt as MouseEvent
          // 仅左键触发选中，右键和中键用于平移，不选中
          if (evt.button !== 0) return
          e.cancelBubble = true
          onSelect(node.id, evt.shiftKey || evt.ctrlKey || evt.metaKey)
        }}
        onTap={(e) => {
          const evt = e.evt as MouseEvent
          e.cancelBubble = true
          onSelect(node.id, evt.shiftKey || evt.ctrlKey || evt.metaKey)
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
      {/* 图片渲染：在 Rect 上层，铺满控件框 */}
      {hasImage && image && useNineSlice && sliceEdges ? (
        <NineSliceImage
          image={image}
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          opacity={opacity}
          edges={sliceEdges}
        />
      ) : hasImage && (
        <KImage
          image={image}
          x={displayX}
          y={displayY}
          width={width}
          height={height}
          rotation={rotation}
          opacity={opacity}
          listening={false}
        />
      )}
      {borderThickness > 0 && (
        <Rect
          x={displayX}
          y={displayY}
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
      {/* 进度条预览（Progress 类型）*/}
      {node.starType === 'Progress' && (() => {
        const prog = node.progress ?? {}
        const value = prog.value ?? 0.5
        const mode = prog.progressionMode ?? 'LeftToRight'
        // 计算进度遮罩区域
        let clipX = displayX, clipY = displayY, clipW = width, clipH = height
        if (mode === 'LeftToRight') { clipW = width * value }
        else if (mode === 'RightToLeft') { clipX = displayX + width * (1 - value); clipW = width * value }
        else if (mode === 'TopToBottom') { clipH = height * value }
        else if (mode === 'BottomToTop') { clipY = displayY + height * (1 - value); clipH = height * value }
        // Clockwise/CounterClockwise 暂用线性近似（后续可用 Arc 实现）
        else if (mode === 'Clockwise' || mode === 'CounterClockwise') { clipW = width * value }
        // 用半透明绿色遮罩表示进度区域
        return (
          <Rect
            x={clipX} y={clipY} width={clipW} height={clipH}
            fill={hasImage ? 'rgba(90,185,255,0.25)' : 'rgba(90,255,128,0.15)'}
            listening={false}
          />
        )
      })()}
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
      {/* 子节点 */}
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
            parentRect={solved}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            showEditorOverlay={showEditorOverlay}
            sliceMeta={sliceMeta}
            dragPreview={dragPreview}
            inheritedDragDelta={renderDelta}
          />
        ))}
    </>
  )
}

// === 主画布组件 ===
export default function CanvasArea() {
  const { page, selectedIds, selectNode, clearSelection, addNode } = useEditorStore()
  const { config } = useProjectStore()
  const workspacePath = config?.workspacePath ?? ''
  const projectPath = config?.starProjectPath ?? ''
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())

  // 画布视口状态
  const [viewport, setViewport] = useState({ x: 40, y: 40, scale: 0.4 })
  const [isPanning, setIsPanning] = useState(false)
  // 多分辨率预览：默认 = 设计分辨率
  const [previewW, setPreviewW] = useState<number | null>(null)
  const [previewH, setPreviewH] = useState<number | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 })

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
    const isTemplate = page.nodeKind === 'template'
    const dw = isTemplate ? page.designWidth : (previewW ?? page.designWidth)
    const dh = isTemplate ? page.designHeight : (previewH ?? page.designHeight)
    const scale = Math.max(0.05, Math.min(5, Math.min((sw - margin * 2) / dw, (sh - margin * 2) / dh)))
    setViewport({ scale, x: (sw - dw * scale) / 2, y: (sh - dh * scale) / 2 })
  }, [page, previewW, previewH])

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
  const [showEditorOverlay, setShowEditorOverlay] = useState(true)
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

  if (!page) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <div style={{ color: '#5b6378' }}>请创建或选择一个窗口</div>
      </div>
    )
  }

  const designW = page.designWidth
  const designH = page.designHeight
  const isTemplate = page.nodeKind === 'template'
  // 实际预览宽高（未选设备时 = 设计分辨率）
  const actualW = isTemplate ? designW : (previewW ?? designW)
  const actualH = isTemplate ? designH : (previewH ?? designH)
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

  // 鼠标按下
  const handleMouseDown = (e: any) => {
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault()
      setIsPanning(true)
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY, vx: viewport.x, vy: viewport.y }
      return
    }
    // 左键点击空白区域取消选中
    // 判定：target 是 Stage 本身，或 target 没有 id 属性（背景/设计区 Rect）
    // 排除：Transformer 手柄/边框（向上查找父链是否包含 Transformer）
    if (e.evt.button === 0) {
      const target = e.target
      // 沿父链查找 Transformer，命中则不取消选中
      let p: any = target
      while (p) {
        if (p === transformerRef.current) return
        p = p.parent
      }
      const isStage = target === target.getStage()
      const hasNoId = !target.id || !target.id()
      if (isStage || hasNoId) {
        clearSelection()
      }
    }
  }

  const handleMouseMove = (e: any) => {
    if (!isPanning) return
    const dx = e.evt.clientX - panStart.current.x
    const dy = e.evt.clientY - panStart.current.y
    setViewport(prev => ({ ...prev, x: panStart.current.vx + dx, y: panStart.current.vy + dy }))
  }

  const handleMouseUp = () => setIsPanning(false)
  const handleContextMenu = (e: any) => { e.evt.preventDefault(); e.evt.stopPropagation() }

  // 拖拽结束：按 stretch 轴写 margins，非 stretch 轴写 transform。
  const handleNodeDragEnd = (id: string, desiredRect: LayoutRect) => {
    const store = useEditorStore.getState()
    const currentPage = store.page
    if (!currentPage) return
    const node = findNode(currentPage.root, id)
    if (!node) return
    const parentRect = solveParentRectForNode(currentPage.root, id, actualW, actualH)
    const patch = computeLayoutPatchFromRect(node, parentRect, actualW, actualH, desiredRect)
    store.batchUpdateNode(id, patch)
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
      ? solveParentRectForNode(page.root, node.id, actualW, actualH)
      : { x: 0, y: 0, width: actualW, height: actualH }
    const layoutPatch = computeLayoutPatchFromRect(currentNode, parentRect, actualW, actualH, {
      x: konvaX,
      y: konvaY,
      width: newWidth,
      height: newHeight,
    })

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
  const handleSelect = (id: string, additive: boolean) => {
    selectNode(id, additive)
  }

  const invScale = 1 / viewport.scale

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

          <Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
            {/* 设计分辨率参考框（仅在预览分辨率 ≠ 设计分辨率时显示） */}
            {!isTemplate && previewW !== null && (
              <Rect
                x={0} y={0} width={designW} height={designH}
                fill="none"
                stroke="#3a4258"
                strokeWidth={1 * invScale}
                dash={[6 * invScale, 4 * invScale]}
                listening={false}
              />
            )}
            {/* 实际预览分辨率区域 */}
            <Rect
              x={0} y={0} width={actualW} height={actualH}
              fill="#161a23"
              stroke="#2a5a8a"
              strokeWidth={2 * invScale}
              dash={[10 * invScale, 5 * invScale]}
              listening={false}
            />
            <Text
              text={`${actualW} x ${actualH}${isTemplate ? ' (模板)' : (previewW !== null ? ' (预览)' : ' (设计)')}`}
              x={4} y={-20 * invScale}
              fontSize={12 * invScale}
              fill={isTemplate ? '#b37feb' : (previewW !== null ? '#ffaa44' : '#5b6378')}
              listening={false}
            />

            {/* 所有控件（root 的子节点，父矩形=实际预览分辨率） */}
            {page.root.children.map(child => (
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
                showEditorOverlay={showEditorOverlay}
                sliceMeta={sliceMeta}
                dragPreview={dragPreview}
                inheritedDragDelta={{ x: 0, y: 0 }}
              />
            ))}

            {/* ★ 参考效果图（半透明、穿透、铺满设计区，渲染在最上层） */}
            <RefImageLayer
              refPath={page.referenceImage ?? null}
              visible={page.referenceVisible ?? true}
              opacity={page.referenceOpacity ?? 0.5}
              width={actualW}
              height={actualH}
            />

            {/* 锚点/Pivot 可视化（仅选中单个控件 + overlay 开启时显示） */}
            {showEditorOverlay && selectedIds.length === 1 && (() => {
              const selNode = findNode(page.root, selectedIds[0])
              if (!selNode) return null
              // 父节点矩形（root 的子节点 → 实际预览分辨率；深层 → 用 solver 算父节点矩形）
              const parent = findParent(page.root, selectedIds[0])
              let parentRect
              if (parent && parent.id !== page.root.id) {
                // 深层节点：用 solver 算父节点矩形
                const grandparent = findParent(page.root, parent.id)
                const gpRect = grandparent
                  ? solveLayout(grandparent,
                      grandparent.id === page.root.id
                        ? { x: 0, y: 0, width: actualW, height: actualH }
                        : { x: 0, y: 0, width: actualW, height: actualH },
                      actualW, actualH).rect
                  : { x: 0, y: 0, width: actualW, height: actualH }
                parentRect = solveLayout(parent, gpRect, actualW, actualH).rect
              } else {
                parentRect = { x: 0, y: 0, width: actualW, height: actualH }
              }
              return (
                <AnchorOverlay
                  node={selNode}
                  parentRect={parentRect}
                  designW={actualW}
                  designH={actualH}
                  invScale={invScale}
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
              // Shift 按下时等比例，否则自由变换（PS 风格）
              const shift = (window.event as KeyboardEvent)?.shiftKey
              tr.keepRatio(!!shift)
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
        {/* 设备切换 */}
        {isTemplate ? (
          <span style={{ color: '#b37feb', fontSize: 11 }}>模板 ({designW}×{designH})</span>
        ) : (
          <select
            value={previewW ? `${previewW}x${previewH}` : 'design'}
            onChange={e => {
              const v = e.target.value
              if (v === 'design') { setPreviewW(null); setPreviewH(null) }
              else {
                const [w, h] = v.split('x').map(Number)
                setPreviewW(w); setPreviewH(h)
              }
              setTimeout(() => zoomFit(), 0)
            }}
            style={{
              background: '#0f1117', color: previewW ? '#ffaa44' : '#9aa3b4',
              border: '1px solid #2a3142', borderRadius: 4, padding: '2px 6px', fontSize: 11,
              cursor: 'pointer',
            }}
            title="切换预览分辨率"
          >
            <option value="design">设计 ({designW}×{designH})</option>
            <option value="1080x1920">1080×1920 (9:16)</option>
            <option value="1170x2532">1170×2532 (iPhone 15)</option>
            <option value="1284x2778">1284×2778 (iPhone 14 Plus)</option>
            <option value="1440x2560">1440×2560 (2K 安卓)</option>
            <option value="1080x2400">1080×2400 (20:9 安卓)</option>
            <option value="888x1920">888×1920 (折叠屏内屏)</option>
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
          onClick={() => setShowEditorOverlay(v => !v)}
          title="Ctrl+Shift+H 切换辅助渲染"
        >
          {showEditorOverlay ? '◉ 辅助线' : '○ 辅助线'}
        </span>
        <span
          style={{ fontSize: 10, cursor: 'pointer', color: (page.referenceVisible ?? true) ? '#5ab9ff' : '#5b6378' }}
          onClick={() => useEditorStore.getState().updatePageMeta(page.pageId, { referenceVisible: !(page.referenceVisible ?? true) })}
          title="切换效果图显示"
        >
          {(page.referenceVisible ?? true) ? '◉ 效果图' : '○ 效果图'}
        </span>
      </div>
    </div>
  )
}

// === 锚点/拉伸/Pivot 可视化叠加层 ===
// 在主 Group 内绘制（受视口缩放影响）：
// 1. 参考矩形（屏幕或父节点）虚线框
// 2. 锚点位置标记（4 个小圆点）
// 3. 拉伸连线（拉伸模式下从锚定边到控件）
// 4. Pivot 十字标
interface AnchorOverlayProps {
  node: UiNode
  parentRect: { x: number; y: number; width: number; height: number }
  designW: number
  designH: number
  invScale: number
}

function AnchorOverlay({ node, parentRect, designW, designH, invScale }: AnchorOverlayProps) {
  const anchor = node.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const sideId = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const side = getAnchorSide(sideId)
  const stretch = node.stretch ?? {}
  const stretchStyle = stretch.style ?? 'None'

  // 参考矩形（屏幕坐标，左上 + 尺寸）
  const ref = target === 'screen'
    ? { x: 0, y: 0, width: designW, height: designH }
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
  const pivot = node.transform?.pivot ?? DEFAULT_PIVOT
  const pivotX = solved.pivotX
  const pivotY = solved.pivotY

  const dotColor = '#ffaa44'
  const lineColor = '#5ab9ff'
  const pivotColor = '#ff4d8f'

  // 拉伸轴判断
  const hStretch = stretchStyle === 'Horizontal' || stretchStyle === 'Both'
  const vStretch = stretchStyle === 'Vertical' || stretchStyle === 'Both'
  const margins = stretch.margins ?? { left: 0, right: 0, top: 0, bottom: 0 }

  return (
    <>
      {/* 参考矩形 */}
      {target === 'parent' && (
        <Rect
          x={ref.x} y={ref.y} width={ref.width} height={ref.height}
          fill="none" stroke={lineColor} strokeWidth={1 * invScale}
          dash={[4 * invScale, 4 * invScale]} opacity={0.3} listening={false}
        />
      )}

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

      {/* 锚点标记（十字 + 圆点，仅非拉伸时显示位置锚点） */}
      {!hStretch && !vStretch && (
        <Group x={anchorX} y={anchorY} listening={false}>
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
      )}

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

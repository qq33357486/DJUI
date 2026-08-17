import type { CanvasModeV6, ImageFitV6, ProjectFileV6, SafeEdgeV6 } from '@/types/protocolV6'

export interface RectV6 { x: number; y: number; width: number; height: number }
export interface InsetsV6 { left: number; top: number; right: number; bottom: number }

export interface CanvasPlanV6 {
  scale: number
  canvasRect: RectV6
  referenceRect: RectV6
  safeRect: RectV6
  wide: boolean
}

export function createCanvasPlanV6(
  viewportWidth: number,
  viewportHeight: number,
  safeInsets: InsetsV6,
  project: ProjectFileV6,
): CanvasPlanV6 {
  const vw = Math.max(1, viewportWidth)
  const vh = Math.max(1, viewportHeight)
  const rw = project.canvas.referenceWidth
  const rh = project.canvas.referenceHeight
  const scale = canvasScale(project.canvas.mode, vw, vh, rw, rh)
  const width = vw / scale
  const height = vh / scale
  const canvasRect = { x: 0, y: 0, width, height }
  const referenceRect = { x: (width - rw) / 2, y: (height - rh) / 2, width: rw, height: rh }
  const safeRect = insetRect(canvasRect, {
    left: safeInsets.left / scale,
    top: safeInsets.top / scale,
    right: safeInsets.right / scale,
    bottom: safeInsets.bottom / scale,
  })
  // 宽屏档判定方向感知：只有物理宽 > 高 且比值达阈值才算 wide，与 Runtime DjuiCanvasV6 保持一致
  const wide = vw / vh >= project.responsive.wideRatio
  return { scale, canvasRect, referenceRect, safeRect, wide }
}

export function canvasScale(mode: CanvasModeV6, vw: number, vh: number, rw: number, rh: number): number {
  if (mode === 'MatchWidth') return vw / rw
  if (mode === 'MatchHeight') return vh / rh
  return Math.min(vw / rw, vh / rh)
}

export function insetRect(rect: RectV6, insets: InsetsV6): RectV6 {
  const left = Math.max(0, insets.left)
  const top = Math.max(0, insets.top)
  const right = Math.max(0, insets.right)
  const bottom = Math.max(0, insets.bottom)
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  }
}

export function safeReferenceRect(canvas: RectV6, safe: RectV6, edges: SafeEdgeV6[] = ['left', 'top', 'right', 'bottom']): RectV6 {
  const selected = new Set(edges)
  const left = selected.has('left') ? safe.x - canvas.x : 0
  const top = selected.has('top') ? safe.y - canvas.y : 0
  const right = selected.has('right') ? canvas.x + canvas.width - safe.x - safe.width : 0
  const bottom = selected.has('bottom') ? canvas.y + canvas.height - safe.y - safe.height : 0
  return insetRect(canvas, { left, top, right, bottom })
}

export function computeImageFitV6(sourceWidth: number, sourceHeight: number, target: RectV6, fit: ImageFitV6, focalX = 0.5, focalY = 0.5): RectV6 {
  if (fit === 'stretch' || sourceWidth <= 0 || sourceHeight <= 0) return { ...target }
  const scale = fit === 'contain'
    ? Math.min(target.width / sourceWidth, target.height / sourceHeight)
    : Math.max(target.width / sourceWidth, target.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return {
    x: target.x + (target.width - width) * Math.min(1, Math.max(0, focalX)),
    y: target.y + (target.height - height) * Math.min(1, Math.max(0, focalY)),
    width,
    height,
  }
}

import type { UiNode } from '@/types/layout'
import type { DeviceObstacleV6, DevicePresetV6 } from '@/lib/devicePresetsV6'
import { solveLayout, type Rect } from '@/utils/layoutSolver'

export type AdaptationIssueLevel = 'error' | 'warning' | 'info'

export interface AdaptationIssue {
  level: AdaptationIssueLevel
  nodeId: string
  nodeName: string
  message: string
}

export interface AdaptationAuditResult {
  issues: AdaptationIssue[]
  visualObstacles: Rect[]
  touchObstacles: Rect[]
}

export function computeImageFrameForAudit(root: UiNode, canvas: Rect, safeRect: Rect): Rect | undefined {
  const backgroundId = (root.children ?? []).find(node => !!node.sceneFrame?.backgroundId)?.sceneFrame?.backgroundId
  const host = (root.children ?? []).find(node =>
    (node.stretch?.style ?? 'None') === 'Both' &&
    !!node.appearance?.image &&
    node.basic?.visible !== false &&
    (!backgroundId || node.id === backgroundId),
  )
  if (!host) return undefined
  const source = host.appearance?.sourceSize
  if (!source || source.width <= 0 || source.height <= 0 || (host.appearance?.imageFit ?? 'cover') !== 'cover') return undefined
  const hostRect = solveLayout(host, canvas, canvas.width, canvas.height, { safeRect }).rect
  const scale = Math.max(hostRect.width / source.width, hostRect.height / source.height)
  const focalX = Math.max(0, Math.min(1, host.appearance?.focalX ?? 0.5))
  const focalY = Math.max(0, Math.min(1, host.appearance?.focalY ?? 0.5))
  const width = source.width * scale
  const height = source.height * scale
  return {
    x: hostRect.x + (hostRect.width - width) * focalX,
    y: hostRect.y + (hostRect.height - height) * focalY,
    width,
    height,
  }
}

function toLogicalRect(obstacle: DeviceObstacleV6, device: DevicePresetV6, canvas: Rect): Rect {
  const scaleX = canvas.width / device.widthPx
  const scaleY = canvas.height / device.heightPx
  return {
    x: obstacle.x * scaleX,
    y: obstacle.y * scaleY,
    width: obstacle.width * scaleX,
    height: obstacle.height * scaleY,
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

function isInteractive(node: UiNode): boolean {
  return node.starType === 'Button' || node.starType === 'Input' || !!node.interaction?.routedEvents || !!node.interaction?.behaviors?.length
}

interface SceneSpace {
  frame: Rect
  scaleX: number
  scaleY: number
}

function mapSceneRect(rect: Rect, scene: SceneSpace): Rect {
  return {
    x: scene.frame.x + rect.x * scene.scaleX,
    y: scene.frame.y + rect.y * scene.scaleY,
    width: rect.width * scene.scaleX,
    height: rect.height * scene.scaleY,
  }
}

/**
 * 对当前预览画像做纯布局审计。它只报告确定的几何风险；美术构图和业务优先级
 * 仍应由场景画板验收补充，避免把普通背景节点误报为安全区错误。
 */
export function auditPageAdaptation(
  root: UiNode,
  canvas: Rect,
  safeRect: Rect,
  device: DevicePresetV6,
  imageFrame?: Rect,
): AdaptationAuditResult {
  const visualObstacles = (device.visualObstacles ?? []).map(item => toLogicalRect(item, device, canvas))
  const touchObstacles = (device.touchObstacles ?? []).map(item => toLogicalRect(item, device, canvas))
  const issues: AdaptationIssue[] = []

  const visit = (node: UiNode, parent: Rect, scene?: SceneSpace, sceneParent?: Rect) => {
    if (node.basic?.visible === false) return
    const authoredRect = scene
      ? solveLayout(node, sceneParent ?? parent, canvas.width, canvas.height, { safeRect, imageFrame }).rect
      : undefined
    const rect = scene
      ? mapSceneRect(authoredRect!, scene)
      : solveLayout(node, parent, canvas.width, canvas.height, { safeRect, imageFrame }).rect
    const name = node.name || node.id
    const interactive = isInteractive(node)
    const textLike = node.starType === 'Label' || node.starType === 'Input'

    if (interactive) {
      if (!intersects(rect, canvas)) {
        issues.push({ level: 'error', nodeId: node.id, nodeName: name, message: '交互节点完全落在设备画面外' })
      } else if (!contains(canvas, rect)) {
        issues.push({ level: 'warning', nodeId: node.id, nodeName: name, message: '交互节点有部分超出设备画面' })
      }
      if (!contains(safeRect, rect)) {
        issues.push({ level: 'warning', nodeId: node.id, nodeName: name, message: '交互节点未完全位于系统安全区内' })
      }
      for (const obstacle of touchObstacles) {
        if (intersects(rect, obstacle)) {
          issues.push({ level: 'error', nodeId: node.id, nodeName: name, message: '交互节点与手势或曲面触控禁区重叠' })
          break
        }
      }
      const physicalW = rect.width * device.widthPx / canvas.width
      const physicalH = rect.height * device.heightPx / canvas.height
      const minTouch = device.minTouchSizePx ?? 0
      if (minTouch > 0 && (physicalW < minTouch || physicalH < minTouch)) {
        issues.push({ level: 'warning', nodeId: node.id, nodeName: name, message: '点击尺寸小于建议值 ' + minTouch + 'px' })
      }
    }

    if (textLike) {
      for (const obstacle of visualObstacles) {
        if (intersects(rect, obstacle)) {
          issues.push({ level: 'warning', nodeId: node.id, nodeName: name, message: '文字或输入框与摄像孔/灵动岛重叠' })
          break
        }
      }
    }

    const artboard = node.sceneFrame?.artboard
    if (artboard && artboard.width > 0 && artboard.height > 0) {
      const nextScene: SceneSpace = {
        frame: rect,
        scaleX: rect.width / artboard.width,
        scaleY: rect.height / artboard.height,
      }
      const artboardRect = { x: 0, y: 0, width: artboard.width, height: artboard.height }
      for (const child of node.children ?? []) visit(child, rect, nextScene, artboardRect)
      return
    }
    for (const child of node.children ?? []) visit(child, rect, scene, scene ? authoredRect : undefined)
  }

  for (const child of root.children ?? []) visit(child, canvas)
  return { issues, visualObstacles, touchObstacles }
}

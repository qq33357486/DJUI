// NGUI 风格锚点/拉伸预设
//
// 锚点 (Anchor) = 只管位置（9-way）
// 拉伸 (Stretch) = 只管大小（None/Horizontal/Vertical/Both）
// 参考：NGUI UIAnchor + UIStretch

// ============ 9-way 锚点 ============

export type AnchorSideId = 'None' | 'TopLeft' | 'Top' | 'TopRight' | 'Left' | 'Center' | 'Right' | 'BottomLeft' | 'Bottom' | 'BottomRight'

export interface AnchorSide {
  id: AnchorSideId
  label: string
  // 网格位置（3×3，row 0=顶 1=中 2=底，col 0=左 1=中 2=右）
  row: number
  col: number
  // 归一化锚点坐标（uGUI Y 朝上：0=底 1=顶）
  nx: number  // 0=左 0.5=中 1=右
  ny: number  // 0=底 0.5=中 1=顶
}

export const ANCHOR_SIDES: AnchorSide[] = [
  { id: 'TopLeft',     label: '左上', row: 0, col: 0, nx: 0,   ny: 1   },
  { id: 'Top',         label: '上中', row: 0, col: 1, nx: 0.5, ny: 1   },
  { id: 'TopRight',    label: '右上', row: 0, col: 2, nx: 1,   ny: 1   },
  { id: 'Left',        label: '左中', row: 1, col: 0, nx: 0,   ny: 0.5 },
  { id: 'Center',      label: '正中', row: 1, col: 1, nx: 0.5, ny: 0.5 },
  { id: 'Right',       label: '右中', row: 1, col: 2, nx: 1,   ny: 0.5 },
  { id: 'BottomLeft',  label: '左下', row: 2, col: 0, nx: 0,   ny: 0   },
  { id: 'Bottom',      label: '下中', row: 2, col: 1, nx: 0.5, ny: 0   },
  { id: 'BottomRight', label: '右下', row: 2, col: 2, nx: 1,   ny: 0   },
]

export function getAnchorSide(id: string): AnchorSide | undefined {
  if (id === 'None') return { id: 'None', label: '无锚点', row: -1, col: -1, nx: 0, ny: 0 }
  return ANCHOR_SIDES.find(s => s.id === id)
}

// DjuiAnchor.side 的合法类型
export type AnchorSideValue = AnchorSideId

export const DEFAULT_ANCHOR_SIDE = 'TopLeft'

// ============ 拉伸风格 ============

export interface StretchStyle {
  id: 'None' | 'Horizontal' | 'Vertical' | 'Both'
  label: string
}

export const STRETCH_STYLES: StretchStyle[] = [
  { id: 'None',       label: '禁用' },
  { id: 'Horizontal', label: '水平拉伸' },
  { id: 'Vertical',   label: '垂直拉伸' },
  { id: 'Both',       label: '全拉伸' },
]

// ============ 旧数据迁移 ============

// 从旧的 anchorMin/anchorMax 模型迁移到 9-way side + stretch.style
export function migrateOldAnchor(anchor: {
  anchorMin?: { x: number; y: number }
  anchorMax?: { x: number; y: number }
  side?: string
  left?: number; right?: number; top?: number; bottom?: number
}): { side: string; stretchStyle: 'None' | 'Horizontal' | 'Vertical' | 'Both' } {
  // 如果已经有 side，直接用
  if (anchor.side && getAnchorSide(anchor.side)) {
    return { side: anchor.side, stretchStyle: 'None' }
  }

  const min = anchor.anchorMin
  const max = anchor.anchorMax

  if (!min || !max) {
    return { side: DEFAULT_ANCHOR_SIDE, stretchStyle: 'None' }
  }

  // 判断拉伸轴
  const hStretch = Math.abs(max.x - min.x) > 0.001
  const vStretch = Math.abs(max.y - min.y) > 0.001

  // 确定 9-way 位置（用 min 点的坐标）
  const nx = min.x
  const ny = min.y

  const hSide = nx < 0.25 ? 'Left' : nx > 0.75 ? 'Right' : 'Center'
  const vSide = ny < 0.25 ? 'Bottom' : ny > 0.75 ? 'Top' : 'Middle' // 注意 uGUI Y 朝上

  // 组合成 9-way id
  let side: string
  if (hStretch && vStretch) {
    // 全拉伸：用 Center
    side = 'Center'
  } else if (hStretch) {
    // 水平拉伸：取垂直方向的 side（Top/Middle/Bottom）
    side = vSide === 'Middle' ? 'Center' : vSide
  } else if (vStretch) {
    // 垂直拉伸：取水平方向的 side（Left/Center/Right）
    side = hSide
  } else {
    // 点锚定：组合
    if (vSide === 'Middle' && hSide === 'Center') side = 'Center'
    else if (vSide === 'Middle') side = hSide // Left/Right
    else if (hSide === 'Center') side = vSide // Top/Bottom
    else side = vSide + hSide // TopLeft/TopRight/BottomLeft/BottomRight
  }

  const stretchStyle: 'None' | 'Horizontal' | 'Vertical' | 'Both' =
    hStretch && vStretch ? 'Both' : hStretch ? 'Horizontal' : vStretch ? 'Vertical' : 'None'

  return { side, stretchStyle }
}

// ============ 中心点 ============

export const DEFAULT_PIVOT = { x: 0.5, y: 0.5 }

// ============ Y 轴转换（uGUI Y 朝上 vs 屏幕 Y 朝下）============

export function uguiYToScreen(uguiY: number, designHeight: number): number {
  return (1 - uguiY) * designHeight
}
export function screenYToUgui(screenY: number, designHeight: number): number {
  return 1 - screenY / designHeight
}

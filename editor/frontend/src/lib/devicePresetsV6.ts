import type { InsetsV6 } from '@/utils/viewportV6'

export type DeviceOrientationV6 = 'portrait' | 'landscape'

export interface DevicePresetV6 {
  /** 稳定身份；预览、审计和回跳都只以它识别设备，不再拿宽高猜设备。 */
  id: string
  orientation: DeviceOrientationV6
  /** 统一格式：设备类别 · 硬件特征 · 比例（宽×高） */
  label: string
  /** 仅用于显示、筛选和同一比例的归一化验收。 */
  ratio: string
  widthPx: number
  heightPx: number
  safeInsetsPx: InsetsV6
  /** 背景可延伸到这些区域；文字和关键信息应避开。 */
  visualObstacles?: DeviceObstacleV6[]
  /** 不适合放置精细点击目标的区域。 */
  touchObstacles?: DeviceObstacleV6[]
  /** 最小建议点击尺寸，单位为物理像素。 */
  minTouchSizePx?: number
}

export interface DeviceObstacleV6 {
  kind: 'cutout' | 'dynamic-island' | 'punch-hole' | 'gesture' | 'waterfall'
  label: string
  x: number
  y: number
  width: number
  height: number
}

export const DEVICE_PRESETS_V6: DevicePresetV6[] = [
  {
    id: 'phone-standard-9x16', orientation: 'portrait', ratio: '9:16',
    label: '手机 · 标准 · 9:16（1080×1920）', widthPx: 1080, heightPx: 1920,
    safeInsetsPx: { left: 0, top: 0, right: 0, bottom: 0 }, minTouchSizePx: 88,
  },
  {
    id: 'phone-standard-9x20', orientation: 'portrait', ratio: '9:20',
    label: '手机 · 基准 · 9:20（1080×2400）', widthPx: 1080, heightPx: 2400,
    safeInsetsPx: { left: 0, top: 0, right: 0, bottom: 0 }, minTouchSizePx: 88,
  },
  {
    id: 'phone-dynamic-island-9x19-5', orientation: 'portrait', ratio: '9:19.5',
    label: '手机 · 灵动岛 · 9:19.5（1179×2556）', widthPx: 1179, heightPx: 2556,
    safeInsetsPx: { left: 0, top: 177, right: 0, bottom: 102 }, minTouchSizePx: 88,
    visualObstacles: [{ kind: 'dynamic-island', label: '灵动岛', x: 401, y: 0, width: 377, height: 111 }],
    touchObstacles: [{ kind: 'gesture', label: '底部 Home 手势区', x: 0, y: 2454, width: 1179, height: 102 }],
  },
  {
    id: 'phone-punch-hole-9x20', orientation: 'portrait', ratio: '9:20',
    label: '手机 · 挖孔 · 9:20（1080×2400）', widthPx: 1080, heightPx: 2400,
    safeInsetsPx: { left: 0, top: 96, right: 0, bottom: 72 }, minTouchSizePx: 88,
    visualObstacles: [{ kind: 'punch-hole', label: '摄像孔', x: 500, y: 16, width: 80, height: 80 }],
    touchObstacles: [{ kind: 'gesture', label: '底部手势区', x: 0, y: 2328, width: 1080, height: 72 }],
  },
  {
    id: 'phone-waterfall-9x20', orientation: 'portrait', ratio: '9:20',
    label: '手机 · 曲面屏 · 9:20（1080×2400）', widthPx: 1080, heightPx: 2400,
    safeInsetsPx: { left: 24, top: 80, right: 24, bottom: 72 }, minTouchSizePx: 88,
    touchObstacles: [
      { kind: 'waterfall', label: '左侧曲面触控边缘', x: 0, y: 0, width: 24, height: 2400 },
      { kind: 'waterfall', label: '右侧曲面触控边缘', x: 1056, y: 0, width: 24, height: 2400 },
      { kind: 'gesture', label: '底部手势区', x: 0, y: 2328, width: 1080, height: 72 },
    ],
  },
  {
    id: 'fold-inner-4x5', orientation: 'portrait', ratio: '4:5',
    label: '折叠屏 · 内屏 · 4:5（1768×2208）', widthPx: 1768, heightPx: 2208,
    safeInsetsPx: { left: 0, top: 48, right: 0, bottom: 48 }, minTouchSizePx: 96,
  },
  {
    id: 'tablet-standard-3x4', orientation: 'portrait', ratio: '3:4',
    label: '平板 · 标准 · 3:4（1536×2048）', widthPx: 1536, heightPx: 2048,
    safeInsetsPx: { left: 0, top: 0, right: 0, bottom: 0 }, minTouchSizePx: 96,
  },
  {
    id: 'phone-standard-16x9', orientation: 'landscape', ratio: '16:9',
    label: '手机 · 标准 · 16:9（1920×1080）', widthPx: 1920, heightPx: 1080,
    safeInsetsPx: { left: 0, top: 0, right: 0, bottom: 0 }, minTouchSizePx: 88,
  },
  {
    id: 'phone-standard-20x9', orientation: 'landscape', ratio: '20:9',
    label: '手机 · 基准 · 20:9（2400×1080）', widthPx: 2400, heightPx: 1080,
    safeInsetsPx: { left: 72, top: 0, right: 72, bottom: 0 }, minTouchSizePx: 88,
    touchObstacles: [
      { kind: 'gesture', label: '左侧系统手势区', x: 0, y: 0, width: 72, height: 1080 },
      { kind: 'gesture', label: '右侧系统手势区', x: 2328, y: 0, width: 72, height: 1080 },
    ],
  },
  {
    id: 'tablet-standard-16x10', orientation: 'landscape', ratio: '16:10',
    label: '平板 · 标准 · 16:10（2560×1600）', widthPx: 2560, heightPx: 1600,
    safeInsetsPx: { left: 32, top: 32, right: 32, bottom: 32 }, minTouchSizePx: 96,
  },
  {
    id: 'tablet-standard-4x3', orientation: 'landscape', ratio: '4:3',
    label: '平板 · 标准 · 4:3（2048×1536）', widthPx: 2048, heightPx: 1536,
    safeInsetsPx: { left: 0, top: 0, right: 0, bottom: 0 }, minTouchSizePx: 96,
  },
]

export function findDevicePresetV6(id: string | null | undefined): DevicePresetV6 | null {
  return id ? DEVICE_PRESETS_V6.find(item => item.id === id) ?? null : null
}

export function devicePresetsForOrientationV6(orientation: DeviceOrientationV6): DevicePresetV6[] {
  return DEVICE_PRESETS_V6.filter(item => item.orientation === orientation)
}

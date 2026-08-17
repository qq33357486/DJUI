import type { InsetsV6 } from '@/utils/viewportV6'

export interface DevicePresetV6 {
  id: string
  label: string
  widthPx: number
  heightPx: number
  safeInsetsPx: InsetsV6
}

export const DEVICE_PRESETS_V6: DevicePresetV6[] = [
  { id: 'phone-16-9', label: '标准手机 9:16', widthPx: 1080, heightPx: 1920, safeInsetsPx: { left: 0, top: 0, right: 0, bottom: 0 } },
  { id: 'iphone-15', label: 'iPhone 15 刘海屏', widthPx: 1170, heightPx: 2532, safeInsetsPx: { left: 0, top: 177, right: 0, bottom: 102 } },
  { id: 'iphone-plus', label: 'iPhone Plus', widthPx: 1284, heightPx: 2778, safeInsetsPx: { left: 0, top: 177, right: 0, bottom: 102 } },
  { id: 'android-20-9', label: '安卓全面屏 20:9', widthPx: 1080, heightPx: 2400, safeInsetsPx: { left: 0, top: 72, right: 0, bottom: 72 } },
  { id: 'fold-inner', label: '折叠屏内屏', widthPx: 1768, heightPx: 2208, safeInsetsPx: { left: 0, top: 48, right: 0, bottom: 48 } },
  { id: 'tablet-wide', label: '宽平板', widthPx: 2560, heightPx: 1600, safeInsetsPx: { left: 0, top: 32, right: 0, bottom: 32 } },
]

export function findDevicePresetV6(widthPx: number | null, heightPx: number | null): DevicePresetV6 | null {
  if (widthPx === null || heightPx === null) return null
  return DEVICE_PRESETS_V6.find(item => item.widthPx === widthPx && item.heightPx === heightPx) ?? null
}

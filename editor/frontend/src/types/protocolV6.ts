import type { StarType } from '@/types/layout'

export const DJUI_PROTOCOL_VERSION = 6 as const
export const DJUI_SCHEMA_VERSION = 1 as const
export const DEFAULT_WIDE_RATIO = 1.25

export type CanvasModeV6 = 'Contain' | 'MatchWidth' | 'MatchHeight'
export type ResponsiveVariantV6 = 'base' | 'wide'
export type ImageFitV6 = 'stretch' | 'contain' | 'cover'
export type AnchorTargetV6 = 'parent' | 'screen' | 'safe'
export type SafeEdgeV6 = 'left' | 'top' | 'right' | 'bottom'

export interface ProjectFileV6 {
  protocolVersion: typeof DJUI_PROTOCOL_VERSION
  schemaVersion: typeof DJUI_SCHEMA_VERSION
  projectId?: string
  name?: string
  orientation: 'portrait' | 'landscape'
  canvas: {
    referenceWidth: number
    referenceHeight: number
    mode: CanvasModeV6
  }
  responsive: {
    wideRatio: number
  }
  defaultFont?: string | null
}

export interface PageLocalSizeV6 { width: number; height: number }
export interface WindowConfigV6 {
  mode?: 'fullscreen' | 'popup'
  transition?: { open?: string | null; close?: string | null }
}

export const RESPONSIVE_OVERRIDE_PATHS = [
  'basic.visible', 'basic.disabled',
  'transform.x', 'transform.y', 'transform.width', 'transform.height',
  'appearance.image', 'appearance.background', 'appearance.imageFit',
  'appearance.focalX', 'appearance.focalY', 'appearance.borderThickness', 'appearance.borderColor',
  'text.text', 'text.fontSize', 'text.textColor', 'text.strokeSize', 'text.strokeColor',
  'text.bold', 'text.font', 'text.textWrap',
  'button.imageHover', 'button.imagePressed', 'progress.value',
] as const

export type ResponsiveOverridePathV6 = typeof RESPONSIVE_OVERRIDE_PATHS[number]
export type OverrideMapV6 = Partial<Record<ResponsiveOverridePathV6, unknown>>

export interface NodeV6 {
  id: string
  starType: StarType
  name?: string
  basic?: { visible?: boolean; disabled?: boolean; isStatic?: boolean }
  transform?: {
    x?: number; y?: number; width?: number; height?: number
    rotation?: number; scale?: [number, number]; opacity?: number; zIndex?: number
  }
  appearance?: {
    image?: string | null; background?: string | null; imageMask?: string | null
    imageFit?: ImageFitV6; focalX?: number; focalY?: number
    sourceSize?: PageLocalSizeV6 | null
    borderThickness?: number | null; borderColor?: string | null
    cornerRadius?: number; clipContent?: boolean
    imageFlipX?: boolean; imageFlipY?: boolean; imageBlurLevel?: number; desaturated?: boolean
  }
  anchor?: {
    target?: AnchorTargetV6
    side?: 'None' | 'TopLeft' | 'Top' | 'TopRight' | 'Left' | 'Center' | 'Right' | 'BottomLeft' | 'Bottom' | 'BottomRight'
    safeEdges?: SafeEdgeV6[]
  }
  stretch?: {
    style?: 'None' | 'Horizontal' | 'Vertical' | 'Both'
    margins?: { left: number; top: number; right: number; bottom: number }
  }
  aspectRatio?: { mode: 'None' | 'WidthControlsHeight' | 'HeightControlsWidth' | 'FitInParent'; ratio: number }
  sceneFrame?: { backgroundId: string; artboard: PageLocalSizeV6 } | null
  templateRef?: string | null
  templateOverrides?: Record<string, OverrideMapV6> | null
  children: NodeV6[]
  [key: string]: unknown
}

export interface PageFileV6 {
  protocolVersion: typeof DJUI_PROTOCOL_VERSION
  schemaVersion: typeof DJUI_SCHEMA_VERSION
  pageId: string
  kind: 'window' | 'template'
  localSize?: PageLocalSizeV6
  window?: WindowConfigV6
  root: NodeV6
  responsive?: { wide: { overrides: Record<string, OverrideMapV6> } }
}

export interface CompatibilityIssue {
  path: string
  message: string
}

export type CompatibilityResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'legacy' | 'future' | 'invalid'; issues: CompatibilityIssue[] }

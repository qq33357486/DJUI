import type { ImageFitV6 } from '@/types/protocolV6'

export interface ImageFitResult {
  x: number
  y: number
  width: number
  height: number
  crop?: { x: number; y: number; width: number; height: number }
}

export function computeImageFit(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
  fit: ImageFitV6,
  focalX = 0.5,
  focalY = 0.5,
): ImageFitResult {
  const sw = Math.max(1, sourceWidth)
  const sh = Math.max(1, sourceHeight)
  const dw = Math.max(0, destinationWidth)
  const dh = Math.max(0, destinationHeight)
  const fx = Math.max(0, Math.min(1, focalX))
  const fy = Math.max(0, Math.min(1, focalY))
  if (fit === 'stretch') return { x: 0, y: 0, width: dw, height: dh }
  if (fit === 'contain') {
    const scale = Math.min(dw / sw, dh / sh)
    const width = sw * scale
    const height = sh * scale
    return { x: (dw - width) * fx, y: (dh - height) * fy, width, height }
  }
  const sourceAspect = sw / sh
  const targetAspect = dw / Math.max(1, dh)
  if (sourceAspect > targetAspect) {
    const cropWidth = sh * targetAspect
    return { x: 0, y: 0, width: dw, height: dh, crop: { x: (sw - cropWidth) * fx, y: 0, width: cropWidth, height: sh } }
  }
  const cropHeight = sw / Math.max(0.0001, targetAspect)
  return { x: 0, y: 0, width: dw, height: dh, crop: { x: 0, y: (sh - cropHeight) * fy, width: sw, height: cropHeight } }
}

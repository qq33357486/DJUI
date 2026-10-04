import { stringToArray } from 'konva/lib/shapes/Text'

/** 「无」仅取消文本自身的裁剪；换行与对齐仍以原控件框为参照。 */
export function overflowTextPreview(
  text: string,
  width: number,
  height: number,
  fontSize: number,
  wrap: boolean,
  align: 'left' | 'center' | 'right',
  verticalAlign: 'top' | 'middle' | 'bottom',
  measure: (text: string) => number,
) {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!wrap) {
      lines.push(paragraph)
      continue
    }
    let line = ''
    for (const character of stringToArray(paragraph)) {
      // 单字比框宽也必须保留；下一字另起一行，不让 Konva 丢弃整段。
      if (line && measure(line + character) > width) {
        lines.push(line)
        line = ''
      }
      line += character
    }
    lines.push(line)
  }
  // 预先断行，再给 Konva 足够的排字空间，避免其固定宽高隐式截断。
  // 向上取整也避免字体测量的浮点误差让边界字符被再次截断。
  const renderWidth = Math.max(width, Math.ceil(Math.max(0, ...lines.map(measure))))
  const renderHeight = Math.max(height, lines.length * fontSize)
  return {
    text: lines.join('\n'),
    width: renderWidth,
    height: renderHeight,
    xOffset: (width - renderWidth) * (align === 'right' ? 1 : align === 'center' ? 0.5 : 0),
    yOffset: (height - renderHeight) * (verticalAlign === 'bottom' ? 1 : verticalAlign === 'middle' ? 0.5 : 0),
    wrap: 'none' as const,
  }
}

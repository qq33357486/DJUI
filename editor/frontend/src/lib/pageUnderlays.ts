/**
 * 编辑器画布中的页面后景关联。
 *
 * 该关联只服务于编辑态合成预览，不属于 Runtime 页面协议；key 为前景页面，value 为其直接后景页面。
 */
export type PageUnderlayMap = Record<string, string>

/**
 * 判断把 foregroundId 关联到 candidateId 后是否会形成环。
 * 返回环路径（含起点和终点）时代表不可保存；否则返回 null。
 */
export function findUnderlayCycle(
  links: PageUnderlayMap,
  foregroundId: string,
  candidateId: string,
): string[] | null {
  const path = [foregroundId]
  const visited = new Set<string>()
  let current: string | undefined = candidateId

  while (current) {
    path.push(current)
    if (current === foregroundId) return path
    if (visited.has(current)) return null
    visited.add(current)
    current = links[current]
  }
  return null
}

/** 过滤不存在页面、模板页和自关联，避免旧侧车数据影响编辑。 */
export function prunePageUnderlays<T extends { nodeKind: 'window' | 'template' }>(
  links: PageUnderlayMap,
  pages: Record<string, T>,
): PageUnderlayMap {
  const result: PageUnderlayMap = {}
  for (const [foregroundId, backgroundId] of Object.entries(links)) {
    if (!foregroundId || !backgroundId || foregroundId === backgroundId) continue
    if (pages[foregroundId]?.nodeKind !== 'window') continue
    if (pages[backgroundId]?.nodeKind !== 'window') continue
    result[foregroundId] = backgroundId
  }
  return result
}

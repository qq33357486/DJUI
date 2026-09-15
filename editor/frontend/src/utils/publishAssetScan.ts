// 发布素材预览：扫描成品素材目录 + 统计页面 JSON 对素材的引用次数
// 发布现状是「成品素材」整个目录无差别镜像到星火工程 ui/image/djui，
// 所以「会被发布的素材」= 成品素材 下所有文件（不筛扩展名）。

import { projectContext } from '@/fs/projectContext'
import * as fs from '@/fs/fsAccess'
import { listPages, loadPage, FINISHED_SUBDIRS } from '@/api/client'
import type { UiNode, UiPage } from '@/types/layout'

export { FINISHED_SUBDIRS }

export interface PublishAssetRefPage {
  pageId: string
  count: number
}

export interface PublishAssetInfo {
  /** 成品素材 内相对路径（正斜杠） */
  relPath: string
  /** 一级子目录分类，根目录散文件归「其他」 */
  category: string
  fileName: string
  sizeBytes: number | null
  /** 累计引用次数：同一素材在每个节点出现一次就 +1 */
  refCount: number
  /** 引用页面明细，按次数降序 */
  refPages: PublishAssetRefPage[]
}

export interface PublishAssetScanResult {
  assets: PublishAssetInfo[]
  totalPages: number
  /** 加载失败被跳过的页面 */
  failedPages: string[]
}

// 页面 JSON 中引用素材的字段，值为引擎路径 image/djui/<成品素材内相对路径>
const IMAGE_FIELDS: Array<'image' | 'imageMask' | 'imageHover' | 'imagePressed' | 'imageDisabled'> = [
  'image', 'imageMask', 'imageHover', 'imagePressed', 'imageDisabled',
]

// 引擎路径 → 成品素材相对路径；非 image/djui/ 前缀不算素材引用
function enginePathToRel(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const p = value.replace(/\\/g, '/')
  return p.startsWith('image/djui/') ? p.slice('image/djui/'.length) : null
}

function collectNodeRefs(node: UiNode, onRef: (rel: string) => void): void {
  const appearance = node.appearance as Record<string, unknown> | undefined
  const button = node.button as Record<string, unknown> | undefined
  for (const field of IMAGE_FIELDS) {
    for (const section of [appearance, button]) {
      // image/imageMask 在 appearance，imageHover/Pressed/Disabled 在 button，互不重叠
      const rel = enginePathToRel(section?.[field])
      if (rel) onRef(rel)
    }
  }
  // 模板实例覆盖值里也可能替换图片字段（fieldPath 形如 appearance.image）
  for (const overrides of Object.values(node.templateOverrides ?? {})) {
    for (const [fieldPath, value] of Object.entries(overrides ?? {})) {
      if (!/(^|\.)(image|imageMask|imageHover|imagePressed|imageDisabled)$/.test(fieldPath)) continue
      const rel = enginePathToRel(value)
      if (rel) onRef(rel)
    }
  }
  for (const child of node.children ?? []) collectNodeRefs(child, onRef)
}

export async function scanPublishAssets(): Promise<PublishAssetScanResult> {
  const ws = projectContext.ws
  if (!ws) return { assets: [], totalPages: 0, failedPages: [] }

  // 1. 枚举成品素材下全部文件（不筛扩展名，忠实反映发布镜像范围）
  const dir = await fs.getDirHandle(ws, '成品素材', false)
  const files = dir ? await fs.walkFiles(dir, '', undefined) : []

  // 2. 逐个取文件大小（单个失败不阻断扫描）
  const sizes = new Map<string, number>()
  if (dir) {
    for (const rel of files) {
      const handle = await fs.getFileHandle(dir, rel, false)
      if (!handle) continue
      try {
        sizes.set(rel, (await handle.getFile()).size)
      } catch { /* 大小未知显示 - */ }
    }
  }

  // 3. 逐页收集引用：rel -> 累计次数 / rel -> pageId -> 页内次数
  const refCounts = new Map<string, number>()
  const refPagesMap = new Map<string, Map<string, number>>()
  const failedPages: string[] = []
  let pageIds: string[] = []
  try {
    pageIds = await listPages()
  } catch { /* 工作区未就绪时按 0 页处理 */ }

  const record = (rel: string, pageId: string) => {
    refCounts.set(rel, (refCounts.get(rel) ?? 0) + 1)
    let perPage = refPagesMap.get(rel)
    if (!perPage) {
      perPage = new Map()
      refPagesMap.set(rel, perPage)
    }
    perPage.set(pageId, (perPage.get(pageId) ?? 0) + 1)
  }

  for (const pageId of pageIds) {
    let page: UiPage | null = null
    try {
      page = await loadPage(pageId)
    } catch {
      // 读取/校验失败按跳过处理
    }
    if (!page) {
      failedPages.push(pageId)
      continue
    }
    collectNodeRefs(page.root, rel => record(rel, pageId))
  }

  // 4. 组装结果（walkFiles 已按名称排序，组内排序交给展示层）
  const assets: PublishAssetInfo[] = files.map(rel => {
    const slash = rel.indexOf('/')
    const category = slash > 0 ? rel.slice(0, slash) : '其他'
    const perPage = refPagesMap.get(rel)
    return {
      relPath: rel,
      category,
      fileName: slash >= 0 ? rel.slice(slash + 1) : rel,
      sizeBytes: sizes.get(rel) ?? null,
      refCount: refCounts.get(rel) ?? 0,
      refPages: perPage
        ? [...perPage.entries()]
            .map(([pageId, count]) => ({ pageId, count }))
            .sort((a, b) => b.count - a.count || a.pageId.localeCompare(b.pageId))
        : [],
    }
  })

  return { assets, totalPages: pageIds.length, failedPages }
}

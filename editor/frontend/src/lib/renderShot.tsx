// 无头渲染入口（#render）：由 djui-shot.mjs 起的本地数据服务供数，
// 复用主画布同款渲染管线（NodeShape / PageShotStage）出图。
// 不依赖 File System Access、不依赖编辑器状态；CLI 通过 window 标志位取结果。

import { useEffect, useState } from 'react'
import * as api from '@/api/client'
import { inspectPageV6, inspectProjectV6 } from '@/lib/schemaV6'
import { normalizePage } from '@/lib/normalize'
import { setAssetResolver } from '@/hooks/useImageUrl'
import { useProjectStore } from '@/store/projectStore'
import { useEditorStore } from '@/store/editorStore'
import { PageShotStage } from './autoShot'
import { registerFontMapping } from './fontLoader'
import type { UiNode, UiPage } from '@/types/layout'
import type { PageUnderlayMap } from './pageUnderlays'

type SliceMeta = Record<string, { left: number; top: number; right: number; bottom: number }>

export interface RenderShotParams {
  base: string        // 本地数据服务地址（http://127.0.0.1:port）
  page: string        // 页面 ID
  scale: number       // 导出倍率
  variant: 'base' | 'wide'
}

interface FontFileEntry { url: string; bold: boolean }
interface FontEntry { family: string; cssFamily: string; files: FontFileEntry[] }

// 目标页 + 模板引用 + 后景链，全部加载进 store（环保护）
async function loadPageTree(base: string, pageId: string, underlays: PageUnderlayMap): Promise<UiPage> {
  const pages: UiPage[] = []
  const seen = new Set<string>()
  let target: UiPage | null = null

  const load = async (id: string): Promise<void> => {
    if (seen.has(id)) return
    seen.add(id)
    const res = await fetch(`${base}/page?id=${encodeURIComponent(id)}`)
    if (!res.ok) {
      if (id === pageId) throw new Error(`页面不存在或读取失败：${id}`)
      return // 引用页缺失时渲染层显示占位，与主画布行为一致
    }
    const raw = await res.json()
    const result = inspectPageV6(raw)
    if (!result.ok) {
      if (id === pageId) throw new Error(`页面 ${id} 不是可编辑的 DJUI v6 文件`)
      return
    }
    const page = normalizePage(api.uiPageFromV6(result.value))
    if (!page) {
      if (id === pageId) throw new Error(`页面 ${id} 归一化失败`)
      return
    }
    pages.push(page)
    if (id === pageId) target = page

    const queue: string[] = []
    const walk = (n: UiNode) => {
      if (n.starType === 'TemplateInstance' && n.templateRef) queue.push(n.templateRef)
      for (const c of n.children ?? []) walk(c)
    }
    walk(page.root)
    const bg = underlays[id]
    if (bg) queue.push(bg)
    for (const next of queue) await load(next)
  }

  await load(pageId)
  if (!target) throw new Error(`页面加载失败：${pageId}`)
  for (const p of pages) useEditorStore.getState().upsertPage(p)
  return target
}

async function registerFonts(base: string): Promise<void> {
  let entries: FontEntry[] = []
  try {
    const res = await fetch(`${base}/fonts`)
    if (res.ok) entries = await res.json()
  } catch { /* 字体清单拿不到 → 系统回退字体渲染 */ }
  for (const entry of entries) {
    for (const file of entry.files) {
      try {
        const buf = await (await fetch(file.url)).arrayBuffer()
        const face = new FontFace(entry.cssFamily, buf, file.bold ? { weight: 'bold' } : {})
        await face.load()
        ;(document as any).fonts?.add(face)
      } catch { /* 单个字体文件失败不阻塞 */ }
    }
    registerFontMapping(entry.family, entry.cssFamily)
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: UiPage; sliceMeta: SliceMeta; scale: number; variant: 'base' | 'wide' }
  | { status: 'error'; message: string }

export default function RenderShotApp({ params }: { params: RenderShotParams }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 1. 图片解析旁路：本地数据服务 URL 替代 File System Access 读图
        setAssetResolver((kind, path) => {
          const rel = kind === 'engine' ? `成品素材/${path.replace(/^image\/djui\//, '')}` : path
          return `${params.base}/asset?path=${encodeURIComponent(rel)}`
        })
        // 2. 工程配置
        const projRes = await fetch(`${params.base}/project.json`)
        if (!projRes.ok) throw new Error('工程配置读取失败（.djui/layout/project.json）')
        const proj = inspectProjectV6(await projRes.json())
        if (!proj.ok) throw new Error('工程配置不是有效的 DJUI v6 文件')
        api.setActiveProjectV6(proj.value)
        useProjectStore.setState({ config: api.projectConfigFromV6(proj.value) })
        // 3. 字体（标准 sfnt 文件注册；引擎封装格式由服务端过滤）
        await registerFonts(params.base)
        // 4. 后景表 + 页面树
        let underlays: PageUnderlayMap = {}
        try {
          const uRes = await fetch(`${params.base}/underlays`)
          if (uRes.ok) underlays = await uRes.json()
        } catch { /* 无后景配置 */ }
        const page = await loadPageTree(params.base, params.page, underlays)
        // 5. 九宫格 meta
        let sliceMeta: SliceMeta = {}
        try {
          const sRes = await fetch(`${params.base}/slice-meta`)
          if (sRes.ok) sliceMeta = await sRes.json()
        } catch { /* 无 meta */ }
        if (!cancelled) setState({ status: 'ready', page, sliceMeta, scale: params.scale, variant: params.variant })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        fetch(`${params.base}/result`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ error: message }) }).catch(() => { /* 本地服务不可达时仅落 window 标志 */ })
        if (!cancelled) {
          ;(window as any).__DJUI_SHOT_ERROR__ = message
          ;(window as any).__DJUI_SHOT_READY__ = true
          setState({ status: 'error', message })
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.status === 'loading') return null
  if (state.status === 'error') return null
  return (
    <PageShotStage
      page={state.page}
      variant={state.variant}
      pixelRatio={state.scale}
      sliceMeta={state.sliceMeta}
      onDone={(err, dataUrl) => {
        const w = window as any
        // 结果直接 POST 回本地数据服务（大图走 HTTP 比 CDP evaluate 稳定得多）；
        // text/plain 是 CORS 简单请求，免预检
        const body = err ? JSON.stringify({ error: err.message }) : JSON.stringify({ data: dataUrl ?? '' })
        fetch(`${params.base}/result`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body })
          .then(() => { w.__DJUI_SHOT_READY__ = true })
          .catch(() => {
            w.__DJUI_SHOT_ERROR__ = '结果回传失败（本地服务不可达）'
            w.__DJUI_SHOT_READY__ = true
          })
      }}
    />
  )
}

// 解析 #render?port=..&page=..&scale=..&variant=..
export function parseRenderHash(): RenderShotParams | null {
  if (!location.hash.startsWith('#render')) return null
  const q = new URLSearchParams(location.hash.slice('#render'.length).replace(/^\?/, ''))
  const port = q.get('port')
  const page = q.get('page')
  if (!port || !page) return null
  const scaleRaw = Number(q.get('scale'))
  const scale = Number.isFinite(scaleRaw) ? Math.min(3, Math.max(0.5, scaleRaw)) : 1
  const variant = q.get('variant') === 'wide' ? 'wide' : 'base'
  return { base: `http://127.0.0.1:${port}`, page, scale, variant }
}

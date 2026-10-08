// AI 自动化截图：文件驱动的请求/响应通道
//
// AI（或外部脚本）往 UI 工作区写 `临时文件/自动化/截图请求.json`，
// 编辑器轮询发现后用与主画布同一套渲染管线离屏出图，
// PNG 写入 `临时文件/截图/`，结果写回 `临时文件/自动化/截图响应.json`。
// AI 侧配套入口是 `脚本区/djui-shot.mjs`，全程无需控制浏览器。
//
// 纯前端架构下的必然取舍：渲染发生在浏览器里，因此要求编辑器保持打开且工作区已授权。

import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Stage, Layer, Rect } from 'react-konva'
import type Konva from 'konva'
import * as fs from '@/fs/fsAccess'
import { projectContext } from '@/fs/projectContext'
import * as api from '@/api/client'
import { useProjectStore } from '@/store/projectStore'
import { useEditorStore } from '@/store/editorStore'
import { NodeShape, cloneTreeWithResponsiveOverrides, computePageImageFrame } from '@/components/CanvasArea'
import type { UiNode, UiPage } from '@/types/layout'
import { Rect as LayoutRect } from '@/utils/layoutSolver'

const AUTO_DIR = '临时文件/自动化'
const REQ_PATH = `${AUTO_DIR}/截图请求.json`
const RESP_PATH = `${AUTO_DIR}/截图响应.json`
const SHOT_DIR = '临时文件/截图'
const POLL_INTERVAL_MS = 1500
// 图片（含模板引用、后景页素材）全部就绪的等待上限；超时按当前状态出图
const IMAGE_WAIT_TIMEOUT_MS = 10000
// 请求落盘超过该时长视为陈旧（编辑器刚打开时避免补渲染早已超时的请求）
const REQUEST_STALE_MS = 10 * 60 * 1000

export interface ShotRequest {
  id: string
  action: 'screenshot'
  page: string
  scale?: number
  variant?: 'base' | 'wide'
  out?: string
  ts?: number
}

export interface ShotResponse {
  id: string
  status: 'done' | 'error'
  file?: string
  error?: string
  ts: number
}

type SliceMeta = Record<string, { left: number; top: number; right: number; bottom: number }>

// ===== 离屏渲染组件（与主画布同一套 NodeShape / 布局求解，只输出内容层） =====

export function PageShotStage({ page, variant, pixelRatio, sliceMeta, onDone }: {
  page: UiPage
  variant: 'base' | 'wide'
  pixelRatio: number
  sliceMeta: SliceMeta
  onDone: (err: Error | null, dataUrl?: string) => void
}) {
  const config = useProjectStore(s => s.config)
  const allPages = useEditorStore(s => s.allPages)
  const pageUnderlays = useEditorStore(s => s.pageUnderlays)
  const stageRef = useRef<Konva.Stage>(null)
  const settledRef = useRef(false)

  const workspacePath = config?.workspacePath ?? ''
  const projectPath = config?.starProjectPath ?? ''
  const actualW = page.designWidth
  const actualH = page.designHeight
  const safeRect: LayoutRect = { x: 0, y: 0, width: actualW, height: actualH }

  const effectiveRoot = variant === 'wide'
    ? cloneTreeWithResponsiveOverrides(page.root, page.responsive?.wide?.overrides)
    : page.root
  const pageImageFrame = computePageImageFrame(effectiveRoot, actualW, actualH)

  // 后景页由深到浅排序（与主画布一致），只读渲染在前
  const underlayPages: UiPage[] = []
  const visited = new Set<string>([page.pageId])
  const collect = (foregroundId: string) => {
    const backgroundId = pageUnderlays[foregroundId]
    const background = backgroundId ? allPages[backgroundId] : null
    if (!background || background.nodeKind !== 'window' || visited.has(background.pageId)) return
    visited.add(background.pageId)
    collect(background.pageId)
    underlayPages.push(background)
  }
  collect(page.pageId)

  useEffect(() => {
    let cancelled = false
    const finish = (err: Error | null, dataUrl?: string) => {
      if (cancelled || settledRef.current) return
      settledRef.current = true
      onDone(err, dataUrl)
    }
    void (async () => {
      try {
        await document.fonts.ready
      } catch { /* 字体 API 异常不阻塞出图 */ }
      const startedAt = Date.now()
      const poll = () => {
        if (cancelled || settledRef.current) return
        const stage = stageRef.current
        if (stage) {
          const images = stage.find('Image') as Konva.Image[]
          const allLoaded = images.every(kimg => {
            const img = kimg.image() as HTMLImageElement | undefined
            return !!img && img.complete && img.naturalWidth > 0
          })
          if (allLoaded || Date.now() - startedAt > IMAGE_WAIT_TIMEOUT_MS) {
            try {
              finish(null, stage.toDataURL({ pixelRatio }))
            } catch (e) {
              finish(e instanceof Error ? e : new Error(String(e)))
            }
            return
          }
        }
        if (Date.now() - startedAt > IMAGE_WAIT_TIMEOUT_MS + 3000) {
          finish(new Error('离屏画布渲染超时'))
          return
        }
        setTimeout(poll, 120)
      }
      setTimeout(poll, 120)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Stage ref={stageRef as any} width={actualW} height={actualH} listening={false}>
      <Layer listening={false}>
        <Rect x={0} y={0} width={actualW} height={actualH} fill="#161a23" listening={false} />
        {underlayPages.map(underlay => {
          const underlayRoot = variant === 'wide'
            ? cloneTreeWithResponsiveOverrides(underlay.root, underlay.responsive?.wide.overrides)
            : underlay.root
          const underlayImageFrame = computePageImageFrame(underlayRoot, actualW, actualH)
          return (underlayRoot.children ?? []).map(child => (
            <NodeShape
              key={`underlay-${underlay.pageId}-${child.id}`}
              node={child}
              isSelected={false}
              selectedIds={[]}
              onSelect={() => {}}
              onDragEnd={() => {}}
              onDragPreviewChange={() => {}}
              onTransformEnd={() => {}}
              registerRef={() => {}}
              workspacePath={workspacePath}
              projectPath={projectPath}
              parentRect={{ x: 0, y: 0, width: actualW, height: actualH }}
              canvasWidth={actualW}
              canvasHeight={actualH}
              safeRect={safeRect}
              imageFrame={underlayImageFrame}
              showEditorOverlay={false}
              sliceMeta={sliceMeta}
              dragPreview={null}
              inheritedDragDelta={{ x: 0, y: 0 }}
              readOnly
            />
          ))
        })}
        {(effectiveRoot.children ?? []).map(child => (
          <NodeShape
            key={child.id}
            node={child}
            isSelected={false}
            selectedIds={[]}
            onSelect={() => {}}
            onDragEnd={() => {}}
            onDragPreviewChange={() => {}}
            onTransformEnd={() => {}}
            registerRef={() => {}}
            workspacePath={workspacePath}
            projectPath={projectPath}
            parentRect={{ x: 0, y: 0, width: actualW, height: actualH }}
            canvasWidth={actualW}
            canvasHeight={actualH}
            safeRect={safeRect}
            imageFrame={pageImageFrame}
            showEditorOverlay={false}
            sliceMeta={sliceMeta}
            dragPreview={null}
            inheritedDragDelta={{ x: 0, y: 0 }}
            readOnly
          />
        ))}
      </Layer>
    </Stage>
  )
}

// 把页面渲染为 PNG dataURL（设计分辨率 × pixelRatio）
async function renderPageToDataUrl(page: UiPage, variant: 'base' | 'wide', pixelRatio: number): Promise<string> {
  const sliceMeta = await api.getSliceMeta()
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;'
  document.body.appendChild(holder)
  const root = createRoot(holder)
  try {
    return await new Promise<string>((resolve, reject) => {
      root.render(
        <PageShotStage
          page={page}
          variant={variant}
          pixelRatio={pixelRatio}
          sliceMeta={sliceMeta}
          onDone={(err, dataUrl) => {
            if (err) reject(err)
            else resolve(dataUrl ?? '')
          }}
        />
      )
    })
  } finally {
    root.unmount()
    holder.remove()
  }
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// 页面树里模板实例引用的页面若未加载（如 AI 刚落盘的模板），从磁盘补读，只补缺不覆盖内存
async function ensureTemplateRefsLoaded(root: UiNode): Promise<void> {
  const store = useEditorStore.getState()
  const missing = new Set<string>()
  const walk = (node: UiNode) => {
    if (node.starType === 'TemplateInstance' && node.templateRef && !store.allPages[node.templateRef]) {
      missing.add(node.templateRef)
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  for (const pageId of missing) {
    try {
      const page = await api.loadPage(pageId)
      if (page) useEditorStore.getState().upsertPage(page)
    } catch { /* 模板读失败时渲染层会显示"未选择模板"占位，与主画布行为一致 */ }
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'page'
}

async function handleScreenshotRequest(req: ShotRequest): Promise<ShotResponse> {
  const config = useProjectStore.getState().config
  const ws = projectContext.ws
  if (!config || !ws) {
    return { id: req.id, status: 'error', error: '编辑器尚未完成工程配置（未选择工程目录或未授权）', ts: Date.now() }
  }
  let page: UiPage | null = null
  try {
    page = await api.loadPage(req.page)
  } catch (e) {
    return { id: req.id, status: 'error', error: e instanceof Error ? e.message : String(e), ts: Date.now() }
  }
  if (!page) {
    return { id: req.id, status: 'error', error: `页面不存在：${req.page}`, ts: Date.now() }
  }
  await ensureTemplateRefsLoaded(page.root)
  const scale = typeof req.scale === 'number' && Number.isFinite(req.scale) ? Math.min(3, Math.max(0.5, req.scale)) : 1
  const dataUrl = await renderPageToDataUrl(page, req.variant === 'wide' ? 'wide' : 'base', scale)
  await fs.ensureDir(ws, SHOT_DIR)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const idTag = req.id.replace(/[^0-9a-zA-Z]/g, '').slice(0, 4)
  const fileName = `${sanitizeFileName(req.out || req.page)}_${stamp}_${idTag}.png`
  const filePath = `${SHOT_DIR}/${fileName}`
  await fs.writeFileBinary(ws, filePath, dataUrlToArrayBuffer(dataUrl))
  return { id: req.id, status: 'done', file: filePath, ts: Date.now() }
}

// ===== 轮询通道 =====

let polling = false

async function pollOnce(): Promise<void> {
  const ws = projectContext.ws
  if (!ws) return
  const text = await fs.readFileText(ws, REQ_PATH)
  if (text === null) return
  let req: ShotRequest | null = null
  try {
    req = JSON.parse(text.replace(/^\uFEFF/, '')) as ShotRequest
  } catch {
    // 半截 JSON（脚本写入瞬间）或坏文件：本轮跳过，等写完整或下轮清理
    return
  }
  if (!req || typeof req.id !== 'string' || !req.id) {
    await fs.removeFile(ws, REQ_PATH).catch(() => {})
    return
  }
  if (req.action !== 'screenshot') {
    const resp: ShotResponse = { id: req.id, status: 'error', error: `未知 action：${String(req.action)}`, ts: Date.now() }
    await fs.writeFileJson(ws, RESP_PATH, resp)
    await fs.removeFile(ws, REQ_PATH).catch(() => {})
    return
  }
  if (typeof req.ts === 'number' && Date.now() - req.ts > REQUEST_STALE_MS) {
    await fs.removeFile(ws, REQ_PATH).catch(() => {})
    return
  }
  let resp: ShotResponse
  try {
    resp = await handleScreenshotRequest(req)
  } catch (e) {
    resp = { id: req.id, status: 'error', error: e instanceof Error ? e.message : String(e), ts: Date.now() }
  }
  await fs.writeFileJson(ws, RESP_PATH, resp)
  await fs.removeFile(ws, REQ_PATH).catch(() => {})
  console.info(`[autoShot] ${req.page} → ${resp.status === 'done' ? resp.file : resp.error}`)
}

// App 在工作区就绪后调用；返回停止函数
export function startAutoShotPolling(): () => void {
  const timer = window.setInterval(() => {
    if (polling) return
    polling = true
    void pollOnce().catch(() => {}).finally(() => { polling = false })
  }, POLL_INTERVAL_MS)
  return () => {
    window.clearInterval(timer)
    polling = false
  }
}

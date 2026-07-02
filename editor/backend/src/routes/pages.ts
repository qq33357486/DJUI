import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'
import { applyProjectPatches, patchPageData, readSoundConfig } from '../patches.js'

// 从配置获取工程目录
function getProjectPath(): string {
  const configPath = path.resolve(process.cwd(), 'djui_config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return config.starProjectPath ?? process.cwd()
  }
  return process.cwd()
}

// DJUI 页面源目录：工程目录/ui/djui/pages/
function getPagesDir() {
  return path.join(getProjectPath(), 'ui', 'djui', 'pages')
}

function resolvePageFile(pageId: string): string | null {
  if (!pageId || pageId.includes('/') || pageId.includes('\\') || pageId.includes('..')) {
    return null
  }
  if (/[<>:"|?*\x00-\x1F]/.test(pageId)) return null

  const pagesDir = path.resolve(getPagesDir())
  const file = path.resolve(pagesDir, `${pageId}.json`)
  const relative = path.relative(pagesDir, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return file
}

// 从配置获取 workspace 路径
function getWorkspacePath(): string | null {
  const configPath = path.resolve(process.cwd(), 'djui_config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return config.workspacePath ?? null
  }
  return null
}

// 读取九宫格元数据
function readSliceMeta(): Record<string, { left: number; top: number; right: number; bottom: number }> {
  const ws = getWorkspacePath()
  if (!ws) return {}
  const p = path.join(ws, '.djui', 'slice-meta.json')
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return typeof data === 'object' && data !== null ? data : {}
    }
  } catch { /* ignore */ }
  return {}
}

// 递归遍历节点树，注入 slicedEdges
function injectSliceEdges(node: any, meta: Record<string, { left: number; top: number; right: number; bottom: number }>) {
  if (!node) return
  if (node.appearance && node.appearance.image) {
    const edges = meta[node.appearance.image]
    if (edges) {
      node.appearance.slicedEdges = [edges.left, edges.top, edges.right, edges.bottom]
    } else {
      delete node.appearance.slicedEdges
    }
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      injectSliceEdges(child, meta)
    }
  }
}

// 递归剥离编辑器专用字段（不序列化到运行时 JSON）
function stripEditorFields(node: any) {
  if (!node) return
  delete node.editorLocked
  delete node.editorHidden
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      stripEditorFields(child)
    }
  }
}

export async function registerPageRoutes(app: FastifyInstance) {
  // 列出所有页面
  app.get('/api/pages', async () => {
    const dir = getPagesDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      return { pages: [] }
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    const pages = files.map(f => f.replace('.json', ''))
    return { pages }
  })

  // 加载页面
  app.get('/api/pages/:pageId', async (req, reply) => {
    const { pageId } = req.params as { pageId: string }
    const file = resolvePageFile(pageId)
    if (!file) {
      reply.code(400)
      return { error: '页面 ID 无效' }
    }
    if (!fs.existsSync(file)) {
      reply.code(404)
      return { error: '页面不存在' }
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  })

  // 保存页面
  app.post('/api/pages/:pageId', async (req, reply) => {
    const { pageId } = req.params as { pageId: string }
    const projectPath = getProjectPath()
    applyProjectPatches(projectPath)
    const dir = getPagesDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const file = resolvePageFile(pageId)
    if (!file) {
      reply.code(400)
      return { ok: false, error: '页面 ID 无效' }
    }
    const data = req.body as any
    // 注入九宫格切片元数据到节点 appearance
    if (data && data.root) {
      const soundConfig = readSoundConfig(projectPath)
      patchPageData(data, soundConfig.defaultButtonSoundId)
      const meta = readSliceMeta()
      injectSliceEdges(data.root, meta)
      stripEditorFields(data.root)
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  })

  // 删除页面
  app.delete('/api/pages/:pageId', async (req, reply) => {
    const { pageId } = req.params as { pageId: string }
    const file = resolvePageFile(pageId)
    if (!file) {
      reply.code(400)
      return { ok: false, error: '页面 ID 无效' }
    }
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
    return { ok: true }
  })
}

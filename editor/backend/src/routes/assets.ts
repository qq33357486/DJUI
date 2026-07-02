import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.gif', '.bmp']

// 扩展名 -> MIME 映射
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tga': 'application/octet-stream',
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.includes(path.extname(filePath).toLowerCase())
}

function resolveInside(base: string, rel: string): string | null {
  const resolvedBase = path.resolve(base)
  const resolvedTarget = path.resolve(resolvedBase, rel)
  const relative = path.relative(resolvedBase, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolvedTarget
}

export async function registerAssetRoutes(app: FastifyInstance) {
  // 列出目录中的素材
  // 默认只返回当前层级（dirs + files），用于多级目录浏览
  // 加 flat=true 时递归平铺返回所有文件（用于搜索）
  app.get('/api/assets', async (req) => {
    const { dir, flat } = req.query as { dir: string; flat?: string }
    if (!dir || !fs.existsSync(dir)) {
      return flat ? { assets: [] } : { current: dir ?? '', parent: null, dirs: [], files: [] }
    }
    let dirStat: fs.Stats
    try {
      dirStat = fs.statSync(dir)
    } catch {
      return flat ? { assets: [] } : { current: dir, parent: null, dirs: [], files: [] }
    }
    if (!dirStat.isDirectory()) {
      return flat ? { assets: [] } : { current: dir, parent: null, dirs: [], files: [] }
    }

    // 平铺模式：递归扫描所有文件
    if (flat === 'true' || flat === '1') {
      const assets: string[] = []
      const scan = (d: string, base: string) => {
        const entries = fs.readdirSync(d, { withFileTypes: true })
        for (const e of entries) {
          const full = path.join(d, e.name)
          if (e.isDirectory()) {
            scan(full, base)
          } else if (isImageFile(e.name)) {
            assets.push(path.relative(base, full).replace(/\\/g, '/'))
          }
        }
      }
      try { scan(dir, dir) } catch { /* ignore */ }
      return { assets }
    }

    // 层级模式：当前目录下的子目录 + 图片文件
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return { current: dir, parent: null, dirs: [], files: [] }
    }

    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))

    const files = entries
      .filter(e => e.isFile() && isImageFile(e.name))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))

    const parent = path.dirname(dir)
    return {
      current: dir,
      parent: parent !== dir ? parent : null,
      dirs,
      files,
    }
  })

  // 提供图片文件 HTTP 接口（解决浏览器禁止 file:// 的问题）
  // 用 ?path= 绝对路径访问，或 ?base=&rel= 组合访问
  // 可选 ?fallback= 当 path 不存在时尝试的备用路径
  app.get('/api/assets/file', async (req, reply) => {
    const { path: absPath, base, rel, fallback } = req.query as {
      path?: string
      base?: string
      rel?: string
      fallback?: string
    }

    const candidates: string[] = []

    if (absPath) candidates.push(path.resolve(absPath))
    if (base && rel) {
      const resolved = resolveInside(base, rel)
      if (resolved) candidates.push(resolved)
    }
    if (fallback) candidates.push(path.resolve(fallback))

    let filePath: string | null = null
    for (const c of candidates) {
      if (c && isImageFile(c) && fs.existsSync(c) && fs.statSync(c).isFile()) {
        filePath = c
        break
      }
    }

    if (!filePath) {
      reply.code(404).send({ error: '文件不存在' })
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const mime = MIME_MAP[ext] ?? 'application/octet-stream'

    try {
      const buf = fs.readFileSync(filePath)
      reply
        .header('Content-Type', mime)
        .header('Cache-Control', 'no-cache')
        .send(buf)
    } catch {
      reply.code(500).send({ error: '读取失败' })
    }
  })
}

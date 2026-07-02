import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'
import {
  getDefaultSoundConfig,
  getSoundsConfigPath,
  readSoundConfig,
  validateSoundConfigForSave,
} from '../patches.js'

function getConfiguredProjectPath(): string {
  const configPath = path.resolve(process.cwd(), 'djui_config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return config.starProjectPath ?? process.cwd()
  }
  return process.cwd()
}

function getProjectPath(input?: string): string {
  return input || getConfiguredProjectPath()
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function isPlainFileName(value: string): boolean {
  return path.basename(value) === value && !/[<>:"|?*\x00-\x1F]/.test(value)
}

function readAssetPath(asset: unknown): string {
  if (typeof asset === 'string') return normalizeSlashes(asset)
  if (asset && typeof asset === 'object' && 'Path' in asset) {
    const pathValue = (asset as { Path?: unknown }).Path
    return typeof pathValue === 'string' ? normalizeSlashes(pathValue) : ''
  }
  return ''
}

function readJsonFile(file: string): unknown {
  const text = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

function walkFiles(dir: string): string[] {
  const result: string[] = []
  if (!fs.existsSync(dir)) return result

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkFiles(abs))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      result.push(abs)
    }
  }
  return result
}

function readGameDataSoundEntries(projectPath: string) {
  const baseDir = path.join(projectPath, 'editor', 'data', 'GameEntry', 'ScopeData', 'GameDataSound')
  if (!fs.existsSync(baseDir)) return []

  return walkFiles(baseDir)
    .map(file => {
      try {
        const data = readJsonFile(file) as any
        const root = data?.Root ?? {}
        if (root.$type !== 'GameCore.ResourceType.Data.GameDataSound') return null

        const rel = normalizeSlashes(path.relative(baseDir, file))
        const parts = rel.replace(/\.json$/i, '').split('/').filter(Boolean)
        if (parts.length === 0 || !parts.every(isPlainFileName)) return null

        const name = String(root.Name ?? parts[parts.length - 1])
        const category = String(root.Category ?? parts.slice(0, -1).join('/') ?? '')
        const asset = readAssetPath(root.Asset)
        const gameDataPath = `$GameEntry.ScopeData.GameDataSound.${parts.join('.')}.Root`

        return {
          id: String(data.$id ?? gameDataPath),
          name,
          category,
          asset,
          gameDataPath,
          file: rel,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aa = `${a!.category}/${a!.name}`
      const bb = `${b!.category}/${b!.name}`
      return aa.localeCompare(bb, 'zh-Hans-CN')
    })
}

export async function registerSoundRoutes(app: FastifyInstance) {
  app.get('/api/sounds/gamedata', async (req, reply) => {
    const { projectPath: rawProjectPath } = req.query as { projectPath?: string }
    const projectPath = getProjectPath(rawProjectPath)
    if (!projectPath || !fs.existsSync(projectPath)) {
      reply.code(400)
      return { sounds: [], error: '工程路径无效' }
    }
    return { sounds: readGameDataSoundEntries(projectPath) }
  })

  app.get('/api/sounds/config', async (req, reply) => {
    const { projectPath: rawProjectPath } = req.query as { projectPath?: string }
    const projectPath = getProjectPath(rawProjectPath)
    if (!projectPath || !fs.existsSync(projectPath)) {
      reply.code(400)
      return { ...getDefaultSoundConfig(), error: '工程路径无效' }
    }
    return readSoundConfig(projectPath)
  })

  app.put('/api/sounds/config', async (req, reply) => {
    const { projectPath, config } = req.body as { projectPath?: string; config?: unknown }
    const targetProjectPath = getProjectPath(projectPath)
    if (!targetProjectPath || !fs.existsSync(targetProjectPath)) {
      reply.code(400)
      return { ok: false, error: '工程路径无效' }
    }

    const { config: cleaned, error } = validateSoundConfigForSave(config)
    if (error) {
      reply.code(400)
      return { ok: false, error, config: cleaned }
    }

    const file = getSoundsConfigPath(targetProjectPath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cleaned, null, 2), 'utf-8')
    return { ok: true, config: cleaned }
  })
}

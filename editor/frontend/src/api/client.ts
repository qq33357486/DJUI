// API 层：所有文件操作通过 File System Access API 在浏览器中完成
// 替代原有的后端 HTTP 调用

import { UiPage, ProjectConfig } from '@/types/layout'
import { projectContext } from '@/fs/projectContext'
import * as fs from '@/fs/fsAccess'
import {
  type DjuiSoundConfig,
  type DjuiSoundItem,
  type SoundSetupStatus,
  type PatchRunResult as ApplyPatchesResult,
  type PatchReport,
  sanitizeSoundConfig,
  validateSoundConfigForSave,
  applyProjectPatches,
  patchAndSavePage,
  readSoundConfig,
  getDefaultSoundConfig,
  SOUND_CONFIG_VERSION,
} from '@/lib/patches'
import { normalizePage, normalizeDetectChanges } from '@/lib/normalize'
import { AGENTS_VERSION, readAgentsVersion, buildAgentsMd } from '@/lib/agentsTemplate'
import { EFFECT_PRESETS } from '@/lib/effectsPresets'
import {
  RUNTIME_FILES,
  RUNTIME_VERSION,
  SCRIPT_FILES,
  SCRIPTS_VERSION,
} from '@/lib/bundledAssets'

// ===== API 类型定义 =====
export interface GameDataSoundEntry {
  id: string
  name: string
  category: string
  asset: string
  gameDataPath: string
  file: string
}

export interface RuntimeStatus {
  status: 'missing' | 'outdated' | 'ok' | 'invalid'
  message: string
  installedVersion?: string
  expectedVersion?: string
  installedDir?: string
  installedFiles?: string[]
  sourceFiles?: string[]
  missingFiles?: string[]
  extraFiles?: string[]
  changedFiles?: string[]
}

export interface InitRuntimeResult {
  ok: boolean
  error?: string
  version?: string
  targetDir?: string
  copiedFiles?: string[]
}

export interface WorkspaceStatus {
  status: 'empty' | 'partial' | 'ok' | 'invalid'
  message: string
  dirs: string[]
  missing?: string[]
  hasAgents?: boolean
}

export interface InitWorkspaceResult {
  ok: boolean
  error?: string
  workspacePath?: string
  dirs?: string[]
  created?: string[]
  message?: string
}

export interface PublishResult {
  ok: boolean
  error?: string
  copiedAssets?: string[]
  copiedPages?: string[]
  copiedClientPages?: string[]
  copiedServerPages?: string[]
  copiedSoundsConfig?: boolean
  copiedConfig?: boolean
  warnings?: string[]
  soundBindingSummary?: {
    soundCount: number
    boundSoundRefCount: number
    missingRefCount: number
  }
  targetDir?: string
  targetDirs?: {
    images?: string
    clientPages?: string
    clientSounds?: string
    serverSounds?: string
    serverPages?: string
    clientConfig?: string
  }
  message?: string
}

export interface AgentsStatus {
  status: 'ok' | 'outdated' | 'missing'
  latestVersion: string
  installedVersion: string | null
  message: string
}

export interface ScriptsStatus {
  status: 'ok' | 'outdated' | 'missing' | 'unavailable'
  latestVersion: string | null
  installedVersion: string | null
  message: string
}

export interface AssetListResult {
  current: string
  parent: string | null
  dirs: string[]
  files: string[]
}

export interface BrowseResult {
  current: string
  parent: string | null
  dirs: string[]
  error?: string
}

// 类型重导出（保持组件导入不变）
export type { DjuiSoundConfig, DjuiSoundItem, SoundSetupStatus, ApplyPatchesResult, PatchReport }

export interface SliceEdges { left: number; top: number; right: number; bottom: number }
export type SliceMeta = Record<string, SliceEdges>

// ===== 配置（localStorage 持久化，DirectoryHandle 持久化在 IndexedDB） =====

const CONFIG_KEY = 'djui.project.config'
const PAGE_KEY = 'djui.project.lastPage'

export function getStoredConfig(): ProjectConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveStoredConfig(config: ProjectConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function clearStoredConfig(): void {
  localStorage.removeItem(CONFIG_KEY)
  localStorage.removeItem(PAGE_KEY)
}

export function getLastPageId(): string | null {
  return localStorage.getItem(PAGE_KEY)
}

export function saveLastPageId(pageId: string): void {
  localStorage.setItem(PAGE_KEY, pageId)
}

// ===== 页面 CRUD =====

const PAGES_DIR = 'ui/djui/pages'

export async function listPages(): Promise<string[]> {
  const star = projectContext.star
  if (!star) return []
  const pagesDir = await fs.ensureDir(star, PAGES_DIR)
  const allFiles = await fs.walkFiles(pagesDir, undefined, ['.json'])
  return allFiles.map(f => f.replace(/\.json$/i, ''))
}

export async function loadPage(pageId: string): Promise<UiPage | null> {
  const star = projectContext.star
  if (!star) return null
  const raw = await fs.readFileJson<unknown>(star, `${PAGES_DIR}/${pageId}.json`)
  // 数据边界关卡：normalizePage 确保返回的结构 100% 符合 UiPage 接口
  const page = normalizePage(raw)
  if (page && normalizeDetectChanges(raw)) {
    // 静默持久化修复（和 patches 系统一致的行为）
    try {
      const ws = projectContext.ws
      const sliceMeta = ws ? await getSliceMetaData() : {}
      const soundConfig = await readSoundConfig(star)
      await patchAndSavePage(star, page, sliceMeta, soundConfig.defaultButtonSoundId)
    } catch { /* 持久化失败不影响内存加载 */ }
  }
  return page
}

export async function savePage(page: UiPage): Promise<void> {
  const star = projectContext.star
  if (!star) throw new Error('未选择星火工程目录')
  await fs.ensureDir(star, PAGES_DIR)

  // 读取 slice meta（如果 workspace 已选）
  let sliceMeta: Record<string, { left: number; top: number; right: number; bottom: number }> = {}
  const ws = projectContext.ws
  if (ws) {
    sliceMeta = await getSliceMetaData()
  }

  // 读取默认按钮音效
  const soundConfig = await readSoundConfig(star)

  await patchAndSavePage(star, page, sliceMeta, soundConfig.defaultButtonSoundId)
}

export async function deletePage(pageId: string): Promise<void> {
  const star = projectContext.star
  if (!star) return
  await fs.removeFile(star, `${PAGES_DIR}/${pageId}.json`)
}

// ===== 素材浏览 =====

export async function listAssets(dirPath: string): Promise<AssetListResult> {
  const ws = projectContext.ws
  if (!ws) return { current: dirPath, parent: null, dirs: [], files: [] }
  const { dirs, files } = await fs.readImageEntries(ws, dirPath)
  const parent = dirPath.includes('/') ? dirPath.replace(/\/[^/]+$/, '') : null
  return { current: dirPath, parent, dirs, files }
}

export async function listAssetsFlat(dirPath: string): Promise<string[]> {
  const ws = projectContext.ws
  if (!ws) return []
  const dir = dirPath ? await fs.getDirHandle(ws, dirPath, false) : ws
  if (!dir) return []
  return await fs.walkFiles(dir, dirPath, ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.gif', '.bmp'])
}

// 构造图片 Blob URL（异步）
export async function assetFileUrl(absPath: string): Promise<string | null> {
  const ws = projectContext.ws
  if (!ws) return null
  // absPath 可能是 workspace 相对路径或绝对路径，取相对部分
  const relPath = absPath.replace(/^.*?(成品素材|原始素材|临时文件)/, '$1')
  return await fs.getImageBlobUrl(ws, relPath)
}

// 引擎路径转图片 URL（先尝试 workspace 成品素材，再尝试工程 ui/image/djui）
export async function enginePathToUrl(enginePath: string): Promise<string | null> {
  const rel = enginePath.replace(/^image\/djui\//, '')
  // 先试 workspace 成品素材
  const ws = projectContext.ws
  if (ws) {
    const wsPath = `成品素材/${rel}`
    const url = await fs.getImageBlobUrl(ws, wsPath)
    if (url) return url
  }
  // 再试工程 ui/image/djui
  const star = projectContext.star
  if (star) {
    const projPath = `ui/${enginePath}`
    const url = await fs.getImageBlobUrl(star, projPath)
    if (url) return url
  }
  return null
}

// ===== 效果预设 =====

export async function getEffectPresets(): Promise<{ id: string; category: string; label: string; desc: string }[]> {
  return EFFECT_PRESETS
}

// ===== 音效配置 =====

export async function getGameDataSounds(_projectPath?: string): Promise<GameDataSoundEntry[]> {
  const star = projectContext.star
  if (!star) return []

  const soundDataDir = await fs.getDirHandle(star, 'editor/data/GameEntry/ScopeData/GameDataSound', false)
  if (!soundDataDir) return []

  const jsonFiles = await fs.walkJsonFiles(soundDataDir)
  const sounds: GameDataSoundEntry[] = []

  for (const file of jsonFiles) {
    const data = await fs.readFileJson<any>(soundDataDir, file)
    if (!data) continue
    const root = data.Root
    if (!root || root.$type !== 'GameCore.ResourceType.Data.GameDataSound') continue

    const parts = file.replace(/\.json$/, '').split('/')
    const gameDataPath = `$GameEntry.ScopeData.GameDataSound.${parts.join('.')}.Root`
    const name = root.Name ?? parts[parts.length - 1]
    const category = root.Category ?? parts.slice(0, -1).join('/')
    const assetRaw = root.Asset
    const asset = typeof assetRaw === 'string' ? assetRaw.replace(/\\/g, '/') : (assetRaw?.Path ?? '').replace(/\\/g, '/')

    sounds.push({
      id: data.$id ?? gameDataPath,
      name,
      category,
      asset,
      gameDataPath,
      file,
    })
  }

  sounds.sort((a, b) => `${a.category}/${a.name}`.localeCompare(`${b.category}/${b.name}`, 'zh-Hans-CN'))
  return sounds
}

export async function getSoundConfig(_projectPath?: string): Promise<DjuiSoundConfig> {
  const star = projectContext.star
  if (!star) return getDefaultSoundConfig()
  return await readSoundConfig(star)
}

export async function saveSoundConfig(_projectPath: string = '', config: unknown): Promise<DjuiSoundConfig> {
  const star = projectContext.star
  if (!star) throw new Error('未选择星火工程目录')

  const { config: cleanedConfig, error } = validateSoundConfigForSave(config)
  if (error) throw new Error(error)

  await fs.writeFileJson(star, 'ui/djui/sounds.json', cleanedConfig)
  return cleanedConfig
}

// ===== 补丁 =====

export async function applyPatches(_projectPath: string): Promise<ApplyPatchesResult> {
  const star = projectContext.star
  if (!star) {
    return {
      ok: false,
      changed: false,
      warnings: ['未选择星火工程目录'],
      blockers: [],
      patches: [],
      soundSetup: {
        status: 'missing-config',
        soundCount: 0,
        defaultButtonSoundId: null,
        missingButtonSounds: 0,
      },
    }
  }

  const result = await applyProjectPatches(star)
  return {
    ok: result.ok,
    changed: result.changed,
    warnings: result.warnings,
    blockers: result.blockers,
    patches: result.patches,
    soundSetup: result.soundSetup,
  }
}

// ===== Runtime 检查/安装 =====

export async function checkRuntime(_projectPath: string): Promise<RuntimeStatus> {
  const star = projectContext.star
  if (!star) return { status: 'invalid', message: '未选择星火工程目录' }

  const runtimeDir = await fs.getDirHandle(star, 'src/DjuiRuntime', false)
  if (!runtimeDir) return { status: 'missing', message: '未安装 Runtime' }

  // 读版本
  const versionText = await fs.readFileText(star, 'src/DjuiRuntime/djui_version.txt')
  const installedVersion = versionText?.trim() ?? 'unknown'

  // 检查文件差异
  const installedFileNames: string[] = []
  for await (const entry of runtimeDir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.cs')) {
      installedFileNames.push(entry.name)
    }
  }

  const sourceFileNames = RUNTIME_FILES.map(f => f.name)
  const missingFiles = sourceFileNames.filter(n => !installedFileNames.includes(n))
  const extraFiles = installedFileNames.filter(n => !sourceFileNames.includes(n))

  if (installedVersion === RUNTIME_VERSION && missingFiles.length === 0 && extraFiles.length === 0) {
    return { status: 'ok', message: 'Runtime 已就绪', installedVersion, expectedVersion: RUNTIME_VERSION }
  }

  return {
    status: 'outdated',
    message: 'Runtime 可升级',
    installedVersion,
    expectedVersion: RUNTIME_VERSION,
    installedFiles: installedFileNames,
    sourceFiles: sourceFileNames,
    missingFiles,
    extraFiles,
  }
}

export async function initRuntime(_projectPath: string): Promise<InitRuntimeResult> {
  const star = projectContext.star
  if (!star) return { ok: false, error: '未选择星火工程目录' }

  const targetDir = await fs.ensureDir(star, 'src/DjuiRuntime')

  // 清理旧 .cs 文件
  for await (const entry of targetDir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.cs')) {
      await targetDir.removeEntry(entry.name)
    }
  }

  // 写入新文件
  const copied: string[] = []
  for (const file of RUNTIME_FILES) {
    await fs.writeFileText(star, `src/DjuiRuntime/${file.name}`, file.content)
    copied.push(file.name)
  }

  await fs.writeFileText(star, 'src/DjuiRuntime/djui_version.txt', RUNTIME_VERSION)
  await fs.writeFileText(star, 'src/DjuiRuntime/README.md',
    `# DJUI Runtime\n\nVersion: ${RUNTIME_VERSION}\n\nThis directory was auto-created by DJUI Editor.\nDo not edit manually - use DJUI Editor to update.\n`)

  return { ok: true, version: RUNTIME_VERSION, targetDir: 'src/DjuiRuntime', copiedFiles: copied }
}

// ===== 工作区 =====

const WORKSPACE_DIRS = ['原始素材', '成品素材', '临时文件', '文档', '脚本区']
const FINISHED_SUBDIRS = ['backgrounds', 'buttons', 'frames', 'icons', 'lists', 'decorations', 'text', 'misc']

export async function checkWorkspace(_workspacePath: string): Promise<WorkspaceStatus> {
  const ws = projectContext.ws
  if (!ws) return { status: 'invalid', message: '未选择工作区目录', dirs: [] }

  const existing: string[] = []
  for (const d of WORKSPACE_DIRS) {
    if (await fs.dirExists(ws, d)) existing.push(d)
  }
  const hasAgents = await fs.fileExists(ws, 'AGENTS.md')

  if (existing.length === WORKSPACE_DIRS.length) {
    return { status: 'ok', message: 'UI 工作区已初始化', dirs: existing, hasAgents }
  }
  if (existing.length > 0) {
    return { status: 'partial', message: '工作区不完整', dirs: existing, missing: WORKSPACE_DIRS.filter(d => !existing.includes(d)) }
  }
  return { status: 'empty', message: '目录尚未初始化', dirs: [] }
}

export async function initWorkspace(_workspacePath: string): Promise<InitWorkspaceResult> {
  const ws = projectContext.ws
  if (!ws) return { ok: false, error: '未选择工作区目录' }

  const created: string[] = []

  // 主目录
  for (const d of WORKSPACE_DIRS) {
    await fs.ensureDir(ws, d)
    created.push(d)
  }

  // 成品素材子目录
  for (const sub of FINISHED_SUBDIRS) {
    await fs.ensureDir(ws, `成品素材/${sub}`)
    await fs.writeGitKeep(ws, `成品素材/${sub}`)
  }

  // 待审核子目录
  for (const sub of FINISHED_SUBDIRS) {
    await fs.ensureDir(ws, `临时文件/待审核/${sub}`)
    await fs.writeGitKeep(ws, `临时文件/待审核/${sub}`)
  }

  // 去绿幕后目录
  await fs.ensureDir(ws, '临时文件/去绿幕后')
  await fs.writeGitKeep(ws, '临时文件/去绿幕后')

  // 今天日期的原始素材目录
  const today = new Date().toISOString().slice(0, 10)
  await fs.ensureDir(ws, `原始素材/${today}`)
  await fs.writeGitKeep(ws, `原始素材/${today}`)

  // .gitkeep
  await fs.writeGitKeep(ws, '原始素材')
  await fs.writeGitKeep(ws, '临时文件')
  await fs.writeGitKeep(ws, '文档')
  await fs.writeGitKeep(ws, '脚本区')

  // AGENTS.md
  if (!await fs.fileExists(ws, 'AGENTS.md')) {
    await fs.writeFileText(ws, 'AGENTS.md', buildAgentsMd())
  }

  return { ok: true, workspacePath: ws.name, dirs: WORKSPACE_DIRS, created, message: '工作区初始化完成' }
}

export async function publishAssets(_workspacePath: string = '', _projectPath: string = ''): Promise<PublishResult> {
  const ws = projectContext.ws
  const star = projectContext.star
  if (!ws || !star) return { ok: false, error: '未选择工程目录' }

  // 1. 应用补丁
  const patchResult = await applyProjectPatches(star)
  if (!patchResult.ok || patchResult.blockers.length > 0) {
    return { ok: false, error: patchResult.blockers.join('\n') || '补丁应用失败' }
  }

  // 2. 检查源目录
  const finishedDir = await fs.getDirHandle(ws, '成品素材', false)
  if (!finishedDir) return { ok: false, error: '成品素材目录不存在' }
  const pagesSourceDir = await fs.getDirHandle(star, PAGES_DIR, false)
  if (!pagesSourceDir) return { ok: false, error: '页面目录不存在' }

  // 3. 镜像成品素材 → ui/image/djui
  const imageTarget = await fs.ensureDir(star, 'ui/image/djui')
  const assetCount = await fs.mirrorDir(finishedDir, imageTarget)

  // 4. 镜像页面 → AppBundle/user_files/djui/pages (client)
  const clientDjuiDir = await fs.ensureDir(star, 'AppBundle/user_files/djui')
  // 先清理旧的 pages 目录
  await fs.removeDir(star, 'AppBundle/user_files/djui/pages')
  const clientPagesDir = await fs.ensureDir(star, 'AppBundle/user_files/djui/pages')
  const pageCount = await fs.mirrorDir(pagesSourceDir, clientPagesDir)

  // 5. 镜像页面 → AppBundle/user_files/djui/pages (server - 同一路径)
  // （client 和 server 使用同一 user_files/djui 路径，无需额外操作）

  // 6. 复制 sounds.json
  let copiedSoundsConfig = false
  if (await fs.fileExists(star, 'ui/djui/sounds.json')) {
    const soundData = await fs.readFileText(star, 'ui/djui/sounds.json')
    if (soundData) {
      await fs.writeFileText(star, 'AppBundle/user_files/djui/sounds.json', soundData)
      copiedSoundsConfig = true
    }
  }

  // 7. 发布警告
  const warnings = await buildPublishWarnings(pagesSourceDir, star)

  return {
    ok: true,
    copiedAssets: new Array(assetCount).fill(''),
    copiedPages: new Array(pageCount).fill(''),
    copiedClientPages: new Array(pageCount).fill(''),
    copiedSoundsConfig,
    warnings,
    targetDir: 'ui/image/djui',
    targetDirs: {
      images: 'ui/image/djui',
      clientPages: 'AppBundle/user_files/djui/pages',
      clientSounds: copiedSoundsConfig ? 'AppBundle/user_files/djui/sounds.json' : undefined,
    },
    message: '发布完成',
  }
}

async function buildPublishWarnings(pagesDir: FileSystemDirectoryHandle, star: FileSystemDirectoryHandle): Promise<string[]> {
  const warnings: string[] = []
  const soundIds = new Set<string>()

  const soundConfig = await readSoundConfig(star)
  for (const s of soundConfig.sounds) {
    soundIds.add(s.id)
  }

  const jsonFiles = await fs.walkJsonFiles(pagesDir)
  const refs = new Set<string>()

  function collectRefs(node: unknown) {
    if (!node || typeof node !== 'object') return
    const n = node as any
    if (n.djui && typeof n.djui.clickSoundId === 'string' && n.djui.clickSoundId.trim()) {
      refs.add(n.djui.clickSoundId.trim())
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) collectRefs(child)
    }
  }

  for (const file of jsonFiles) {
    const page = await fs.readFileJson<any>(pagesDir, file)
    if (page?.root) collectRefs(page.root)
  }

  for (const ref of refs) {
    if (!soundIds.has(ref)) {
      warnings.push(`音效引用 ${ref} 在 sounds.json 中不存在`)
    }
  }

  return warnings
}

// ===== AGENTS.md =====

export async function checkAgentsUpdate(_workspacePath: string): Promise<AgentsStatus> {
  const ws = projectContext.ws
  if (!ws) return { status: 'missing', latestVersion: AGENTS_VERSION, installedVersion: null, message: '未选择工作区目录' }

  const content = await fs.readFileText(ws, 'AGENTS.md')
  if (!content) return { status: 'missing', latestVersion: AGENTS_VERSION, installedVersion: null, message: 'AGENTS.md 不存在' }

  const installedVersion = readAgentsVersion(content)
  if (!installedVersion || installedVersion !== AGENTS_VERSION) {
    return { status: 'outdated', latestVersion: AGENTS_VERSION, installedVersion, message: 'AGENTS.md 需要更新' }
  }

  return { status: 'ok', latestVersion: AGENTS_VERSION, installedVersion, message: 'AGENTS.md 已是最新' }
}

export async function updateAgents(_workspacePath: string = ''): Promise<{ ok: boolean; version?: string; message?: string; error?: string }> {
  const ws = projectContext.ws
  if (!ws) return { ok: false, message: '未选择工作区目录' }

  // 备份
  const existing = await fs.readFileText(ws, 'AGENTS.md')
  if (existing) {
    await fs.writeFileText(ws, 'AGENTS.md.bak', existing)
  }

  await fs.writeFileText(ws, 'AGENTS.md', buildAgentsMd())
  return { ok: true, version: AGENTS_VERSION, message: 'AGENTS.md 已更新' }
}

// ===== 脚本区 =====

export async function checkScriptsUpdate(_workspacePath: string): Promise<ScriptsStatus> {
  const ws = projectContext.ws
  if (!ws) return { status: 'unavailable', latestVersion: null, installedVersion: null, message: '未选择工作区目录' }

  const installedVersionText = await fs.readFileText(ws, '脚本区/version.txt')
  if (!installedVersionText) {
    return { status: 'missing', latestVersion: SCRIPTS_VERSION, installedVersion: null, message: '脚本区尚未同步' }
  }

  const installedVersion = installedVersionText.trim()
  if (installedVersion !== SCRIPTS_VERSION) {
    return { status: 'outdated', latestVersion: SCRIPTS_VERSION, installedVersion, message: '脚本区需要更新' }
  }

  return { status: 'ok', latestVersion: SCRIPTS_VERSION, installedVersion, message: '脚本区已是最新' }
}

export async function updateScripts(_workspacePath: string = ''): Promise<{ ok: boolean; version?: string; copiedFiles?: string[]; targetDir?: string; message?: string; error?: string }> {
  const ws = projectContext.ws
  if (!ws) return { ok: false, message: '未选择工作区目录' }

  // 备份旧的 脚本区（如果有）
  if (await fs.dirExists(ws, '脚本区')) {
    // 删除旧备份
    await fs.removeDir(ws, '脚本区.bak')
    // 复制当前到备份
    const oldDir = await fs.getDirHandle(ws, '脚本区', false)
    const bakDir = await fs.ensureDir(ws, '脚本区.bak')
    if (oldDir) await fs.mirrorDir(oldDir, bakDir)
  }

  await fs.ensureDir(ws, '脚本区')

  const copied: string[] = []
  for (const file of SCRIPT_FILES) {
    await fs.writeFileText(ws, `脚本区/${file.path}`, file.content)
    copied.push(file.path)
  }
  await fs.writeFileText(ws, '脚本区/version.txt', SCRIPTS_VERSION)

  return { ok: true, version: SCRIPTS_VERSION, copiedFiles: copied, targetDir: '脚本区', message: '脚本区已更新' }
}

// ===== 字体 =====

export async function getFonts(_projectPath?: string): Promise<string[]> {
  const star = projectContext.star
  if (!star) return []

  const text = await fs.readFileText(star, 'ref/fontref.txt')
  if (!text) return []

  const fonts: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const name = trimmed.split(/\s+/)[0]
    if (name) fonts.push(name)
  }
  return fonts
}

// ===== 调色板 =====

const PALETTE_FILE = '.djui/palette.json'

async function readPalette(ws: FileSystemDirectoryHandle): Promise<string[]> {
  const data = await fs.readFileJson<{ colors: string[] }>(ws, PALETTE_FILE)
  return data?.colors ?? []
}

export async function getPalette(_workspacePath: string = ''): Promise<string[]> {
  const ws = projectContext.ws
  if (!ws) return []
  return readPalette(ws)
}

export async function addPaletteColor(_workspacePath: string = '', color: string): Promise<void> {
  const ws = projectContext.ws
  if (!ws) return
  const colors = await readPalette(ws)
  if (!colors.includes(color)) {
    colors.push(color)
    await fs.writeFileJson(ws, PALETTE_FILE, { colors })
  }
}

export async function removePaletteColor(_workspacePath: string = '', color: string): Promise<void> {
  const ws = projectContext.ws
  if (!ws) return
  let colors = await readPalette(ws)
  colors = colors.filter(c => c !== color)
  await fs.writeFileJson(ws, PALETTE_FILE, { colors })
}

// ===== 九宫格元数据 =====

const SLICE_META_FILE = '.djui/slice-meta.json'

export async function getSliceMeta(_workspacePath: string = ''): Promise<Record<string, { left: number; top: number; right: number; bottom: number }>> {
  const ws = projectContext.ws
  if (!ws) return {}
  return getSliceMetaData()
}

async function getSliceMetaData(): Promise<Record<string, { left: number; top: number; right: number; bottom: number }>> {
  const ws = projectContext.ws
  if (!ws) return {}
  const data = await fs.readFileJson<Record<string, any>>(ws, SLICE_META_FILE)
  return data ?? {}
}

export async function setSliceMeta(_workspacePath: string = '', image: string, edges: { left: number; top: number; right: number; bottom: number } | null): Promise<Record<string, any>> {
  const ws = projectContext.ws
  if (!ws) return {}
  const meta = await getSliceMetaData()
  if (edges) {
    meta[image] = edges
  } else {
    delete meta[image]
  }
  await fs.writeFileJson(ws, SLICE_META_FILE, meta)
  return meta
}

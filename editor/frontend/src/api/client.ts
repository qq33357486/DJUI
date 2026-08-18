// API 层：所有文件操作通过 File System Access API 在浏览器中完成
// 替代原有的后端 HTTP 调用

import { UiPage, ProjectConfig } from '@/types/layout'
import {
  DEFAULT_WIDE_RATIO,
  DJUI_PROTOCOL_VERSION,
  DJUI_SCHEMA_VERSION,
  type CompatibilityIssue,
  type PageFileV6,
  type ProjectFileV6,
} from '@/types/protocolV6'
import { inspectPageV6, inspectProjectV6 } from '@/lib/schemaV6'
import { buildMigrationReportV6, inspectMigrationFileV6, type MigrationReportV6 } from '@/lib/v5MigrationReport'
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
import { type PageUnderlayMap } from '@/lib/pageUnderlays'
import { AGENTS_VERSION, readAgentsVersion, buildAgentsMd } from '@/lib/agentsTemplate'
import { EFFECT_PRESETS } from '@/lib/effectsPresets'
import { SYSTEM_FONT_FAMILIES } from '@/lib/fontLoader'
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

// ===== v6 UI 配置源（工作区持久化，发布时镜像到星火工程） =====

const UI_LAYOUT_DIR = '.djui/layout'
const PROJECT_FILE_V6 = UI_LAYOUT_DIR + '/project.json'
const PAGES_DIR = UI_LAYOUT_DIR + '/pages'
const SOUNDS_FILE_V6 = UI_LAYOUT_DIR + '/sounds.json'
// 编辑器专用的画布后景关联，刻意位于 layout/ 之外，发布时不会镜像给 Runtime。
const PAGE_UNDERLAYS_FILE = '.djui/editor/page-underlays.json'
let pageUnderlaySaveQueue: Promise<void> = Promise.resolve()
const STAR_LAYOUT_DIR = 'ui/djui'
const STAR_PROJECT_FILE_V6 = STAR_LAYOUT_DIR + '/project.json'
const STAR_PAGES_DIR = STAR_LAYOUT_DIR + '/pages'
const STAR_SOUNDS_FILE_V6 = STAR_LAYOUT_DIR + '/sounds.json'
let activeProjectFileV6: ProjectFileV6 | null = null

export type ProjectFileLoadResult =
  | { status: 'ok'; project: ProjectFileV6 }
  | { status: 'missing' }
  | { status: 'blocked'; kind: 'legacy' | 'future' | 'invalid'; issues: CompatibilityIssue[] }

export function createProjectFileV6(config: Pick<ProjectConfig, 'orientation' | 'designWidth' | 'designHeight' | 'defaultFont' | 'canvasMode' | 'wideRatio'>): ProjectFileV6 {
  return {
    protocolVersion: DJUI_PROTOCOL_VERSION,
    schemaVersion: DJUI_SCHEMA_VERSION,
    orientation: config.orientation,
    canvas: {
      referenceWidth: config.designWidth,
      referenceHeight: config.designHeight,
      mode: config.canvasMode ?? activeProjectFileV6?.canvas.mode ?? 'Contain',
    },
    responsive: { wideRatio: config.wideRatio ?? activeProjectFileV6?.responsive.wideRatio ?? DEFAULT_WIDE_RATIO },
    defaultFont: config.defaultFont ?? null,
  }
}

export function projectConfigFromV6(project: ProjectFileV6): ProjectConfig {
  return {
    starProjectPath: projectContext.starName,
    workspacePath: projectContext.wsName,
    orientation: project.orientation,
    designWidth: project.canvas.referenceWidth,
    designHeight: project.canvas.referenceHeight,
    canvasScaler: {
      mode: 'ScaleWithScreenSize',
      match: project.canvas.mode === 'MatchWidth' ? 0 : project.canvas.mode === 'MatchHeight' ? 1 : 0.5,
    },
    canvasMode: project.canvas.mode,
    wideRatio: project.responsive.wideRatio,
    defaultFont: project.defaultFont ?? null,
  }
}

/**
 * 一次性迁移：旧版把 UI 配置错误地留在星火工程内；只有工作区尚未建立布局源时，
 * 才复制现有 v6 配置到工作区。复制完成后，工作区成为唯一可编辑源。
 */
async function migrateLegacyLayoutToWorkspace(): Promise<void> {
  const ws = projectContext.ws
  const star = projectContext.star
  if (!ws || !star) return
  if (await fs.fileExists(ws, PROJECT_FILE_V6)) return
  if (!(await fs.fileExists(star, STAR_PROJECT_FILE_V6))) return

  await fs.copyFile(star, STAR_PROJECT_FILE_V6, ws, PROJECT_FILE_V6)
  const legacyPages = await fs.getDirHandle(star, STAR_PAGES_DIR, false)
  if (legacyPages) {
    const files = await fs.walkFiles(legacyPages, undefined, ['.json'])
    for (const file of files) {
      await fs.copyFile(legacyPages, file, ws, PAGES_DIR + '/' + file)
    }
  }
  if (await fs.fileExists(star, STAR_SOUNDS_FILE_V6)) {
    await fs.copyFile(star, STAR_SOUNDS_FILE_V6, ws, SOUNDS_FILE_V6)
  }
}

export async function loadProjectFileV6(): Promise<ProjectFileLoadResult> {
  const ws = projectContext.ws
  if (!ws) return { status: 'missing' }
  if (!(await fs.fileExists(ws, PROJECT_FILE_V6))) {
    await migrateLegacyLayoutToWorkspace()
  }
  if (!(await fs.fileExists(ws, PROJECT_FILE_V6))) return { status: 'missing' }
  const raw = await fs.readFileJson<unknown>(ws, PROJECT_FILE_V6)
  const result = inspectProjectV6(raw)
  if (result.ok) {
    activeProjectFileV6 = result.value
    return { status: 'ok', project: result.value }
  }
  activeProjectFileV6 = null
  return { status: 'blocked', kind: result.kind, issues: result.issues }
}

export async function scanMigrationReportV6(): Promise<MigrationReportV6> {
  const ws = projectContext.ws
  if (!ws) return buildMigrationReportV6([])
  const projectRaw = await fs.readFileJson<unknown>(ws, PROJECT_FILE_V6)
  const reports = [inspectMigrationFileV6(PROJECT_FILE_V6, projectRaw, 'project')]
  const pagesDir = await fs.getDirHandle(ws, PAGES_DIR, false)
  if (pagesDir) {
    const files = await fs.walkFiles(pagesDir, undefined, ['.json'])
    for (const file of files) {
      const raw = await fs.readFileJson<unknown>(pagesDir, file)
      reports.push(inspectMigrationFileV6(PAGES_DIR + '/' + file, raw, 'page'))
    }
  }
  return buildMigrationReportV6(reports)
}

export async function saveProjectFileV6(project: ProjectFileV6): Promise<void> {
  const ws = projectContext.ws
  if (!ws) throw new Error('未选择 UI 工作区目录')
  const result = inspectProjectV6(project)
  if (!result.ok) {
    throw new Error(result.issues.map(issue => issue.path + ': ' + issue.message).join('；'))
  }
  await fs.writeFileJson(ws, PROJECT_FILE_V6, result.value)
  activeProjectFileV6 = result.value
}

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

function uiPageFromV6(page: PageFileV6): UiPage {
  return {
    version: DJUI_PROTOCOL_VERSION,
    pageId: page.pageId,
    designWidth: page.localSize?.width ?? activeProjectFileV6?.canvas.referenceWidth ?? 1080,
    designHeight: page.localSize?.height ?? activeProjectFileV6?.canvas.referenceHeight ?? 1920,
    root: page.root as unknown as UiPage['root'],
    nodeKind: page.kind,
    windowMode: page.window?.mode ?? null,
    transition: page.window?.transition ?? null,
    responsive: page.responsive ?? (page.kind === 'window' ? { wide: { overrides: {} } } : undefined),
  }
}

// 剥离编辑器私有字段(editor* 前缀,如 editorLockAspect/editorHidden):
// 它们只存活在编辑器内存,进协议 JSON 会被 Runtime 严格反序列化拒绝(UnmappedJsonProperty)。
function stripEditorFields(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripEditorFields)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith('editor')) continue
      out[k] = v
    }
    return out
  }
  return node
}

function pageFileV6FromUiPage(page: UiPage): PageFileV6 {
  const base = {
    protocolVersion: DJUI_PROTOCOL_VERSION,
    schemaVersion: DJUI_SCHEMA_VERSION,
    pageId: page.pageId,
    kind: page.nodeKind,
    root: stripEditorFields(page.root),
  }
  if (page.nodeKind === 'template') {
    return { ...base, kind: 'template', localSize: { width: page.designWidth, height: page.designHeight } } as PageFileV6
  }
  return {
    ...base,
    kind: 'window',
    window: { mode: page.windowMode ?? 'fullscreen', transition: page.transition ?? undefined },
    responsive: page.responsive ?? { wide: { overrides: {} } },
  } as PageFileV6
}

export async function listPages(): Promise<string[]> {
  const ws = projectContext.ws
  if (!ws) return []
  const pagesDir = await fs.ensureDir(ws, PAGES_DIR)
  const allFiles = await fs.walkFiles(pagesDir, undefined, ['.json'])
  return allFiles.map(f => f.replace(/\.json$/i, ''))
}

export async function loadPage(pageId: string): Promise<UiPage | null> {
  const ws = projectContext.ws
  if (!ws) return null
  const raw = await fs.readFileJson<unknown>(ws, `${PAGES_DIR}/${pageId}.json`)
  const result = inspectPageV6(raw)
  if (!result.ok) {
    const detail = result.issues.map(issue => issue.path + ': ' + issue.message).join('；')
    throw new Error('页面 ' + pageId + ' 不是可编辑的 DJUI v6 文件：' + detail)
  }
  // v6 仍经过结构边界归一化，但不再运行旧协议补丁或静默写回。
  return normalizePage(uiPageFromV6(result.value))
}

export async function savePage(page: UiPage): Promise<void> {
  const ws = projectContext.ws
  if (!ws) throw new Error('未选择 UI 工作区目录')
  await fs.ensureDir(ws, PAGES_DIR)
  const result = inspectPageV6(pageFileV6FromUiPage(page))
  if (!result.ok) {
    const detail = result.issues.map(issue => issue.path + ': ' + issue.message).join('；')
    throw new Error('拒绝保存非 v6 页面：' + detail)
  }
  await fs.writeFileJson(ws, `${PAGES_DIR}/${page.pageId}.json`, result.value)
}

export async function deletePage(pageId: string): Promise<void> {
  const ws = projectContext.ws
  if (!ws) return
  await fs.removeFile(ws, `${PAGES_DIR}/${pageId}.json`)
}

export async function getPageUnderlays(): Promise<PageUnderlayMap> {
  const ws = projectContext.ws
  if (!ws) return {}
  const raw = await fs.readFileJson<unknown>(ws, PAGE_UNDERLAYS_FILE)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = (raw as Record<string, unknown>).links
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const links: PageUnderlayMap = {}
  for (const [foregroundId, backgroundId] of Object.entries(source as Record<string, unknown>)) {
    if (typeof backgroundId === 'string' && backgroundId) links[foregroundId] = backgroundId
  }
  return links
}

export async function savePageUnderlays(links: PageUnderlayMap): Promise<void> {
  const ws = projectContext.ws
  if (!ws) throw new Error('未选择 UI 工作区目录')
  // 下拉选择可能连续变化；串行写入保证最后一次选择最终落盘，而非被较早的异步写回覆盖。
  const snapshot = { ...links }
  const write = async () => {
    await fs.writeFileJson(ws, PAGE_UNDERLAYS_FILE, { version: 1, links: snapshot })
  }
  pageUnderlaySaveQueue = pageUnderlaySaveQueue.catch(() => {}).then(write)
  await pageUnderlaySaveQueue
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
  const ws = projectContext.ws
  if (!ws) return getDefaultSoundConfig()
  return await readSoundConfig(ws)
}

export async function saveSoundConfig(_projectPath: string = '', config: unknown): Promise<DjuiSoundConfig> {
  const ws = projectContext.ws
  if (!ws) throw new Error('未选择 UI 工作区目录')

  const { config: cleanedConfig, error } = validateSoundConfigForSave(config)
  if (error) throw new Error(error)

  await fs.writeFileJson(ws, SOUNDS_FILE_V6, cleanedConfig)
  return cleanedConfig
}

// ===== 补丁 =====

export async function applyPatches(_projectPath: string): Promise<ApplyPatchesResult> {
  const ws = projectContext.ws
  if (!ws) {
    return {
      ok: false,
      changed: false,
      warnings: ['未选择 UI 工作区目录'],
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

  const result = await applyProjectPatches(ws)
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

  // 检查文件差异（AGENTS.md 随 .cs 一起分发）
  const installedFileNames: string[] = []
  for await (const entry of runtimeDir.values()) {
    if (entry.kind === 'file' && (entry.name.endsWith('.cs') || entry.name === 'AGENTS.md')) {
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
  // UI 配置源（页面、项目配置、音效）；只在发布时镜像到星火工程。
  await fs.ensureDir(ws, PAGES_DIR)

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
  const patchResult = await applyProjectPatches(ws)
  if (!patchResult.ok || patchResult.blockers.length > 0) {
    return { ok: false, error: patchResult.blockers.join('\n') || '补丁应用失败' }
  }

  // 2. 检查源目录
  const finishedDir = await fs.getDirHandle(ws, '成品素材', false)
  if (!finishedDir) return { ok: false, error: '成品素材目录不存在' }
  const pagesSourceDir = await fs.getDirHandle(ws, PAGES_DIR, false)
  if (!pagesSourceDir) return { ok: false, error: '页面目录不存在' }

  // 3. 镜像成品素材 → ui/image/djui（增量：按发布清单跳过未变文件）
  //    清单记录「源侧 size+mtime」;不能用目标 mtime 比对(原子替换会改写 mtime,永不相等)
  const imageTarget = await fs.ensureDir(star, 'ui/image/djui')
  const manifestPath = 'ui/.djui-publish-manifest.json'
  const prevManifest = await fs.readFileJson<{ files: Record<string, [number, number]> }>(star, manifestPath) ?? { files: {} }
  const nextManifest: { files: Record<string, [number, number]> } = { files: {} }
  const assetStats = await fs.mirrorDir(finishedDir, imageTarget, (rel, size, mtime) => {
    const prev = prevManifest.files[rel]
    const unchanged = !!prev && prev[0] === size && prev[1] === mtime
    if (unchanged) nextManifest.files[rel] = [size, mtime] // 保留指纹
    return unchanged
  })
  // 记录本次全部源指纹(含刚复制的)
  const collectFingerprints = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const entry of dir.values()) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      if (entry.kind === 'file') {
        const f = await (await dir.getFileHandle(entry.name)).getFile()
        nextManifest.files[rel] = [f.size, f.lastModified]
      } else {
        await collectFingerprints(await dir.getDirectoryHandle(entry.name), rel)
      }
    }
  }
  await collectFingerprints(finishedDir, '')
  await fs.writeFileJson(star, manifestPath, nextManifest)

  // 4. 工作区配置镜像到星火工程编辑源和 Runtime 消费目录。
  const warningsFromBundle: string[] = []
  await mirrorPages(star, STAR_PAGES_DIR, pagesSourceDir, warningsFromBundle)
  const pageCount = await mirrorPages(star, 'ui/AppBundle/user_files/djui/pages', pagesSourceDir, warningsFromBundle)

  // 5. 发布 v6 项目配置（Runtime 严格读取 project.json）
  const projectData = await fs.readFileText(ws, PROJECT_FILE_V6)
  if (!projectData) return { ok: false, error: '缺少工作区 .djui/layout/project.json' }
  await fs.writeFileText(star, STAR_PROJECT_FILE_V6, projectData)
  await fs.ensureDir(star, 'ui/AppBundle/user_files/djui')
  await fs.writeFileText(star, 'ui/AppBundle/user_files/djui/project.json', projectData)

  // 6. 复制 sounds.json → 同一位置
  let copiedSoundsConfig = false
  if (await fs.fileExists(ws, SOUNDS_FILE_V6)) {
    const soundData = await fs.readFileText(ws, SOUNDS_FILE_V6)
    if (soundData) {
      await fs.writeFileText(star, STAR_SOUNDS_FILE_V6, soundData)
      await fs.ensureDir(star, 'ui/AppBundle/user_files/djui')
      await fs.writeFileText(star, 'ui/AppBundle/user_files/djui/sounds.json', soundData)
      copiedSoundsConfig = true
    }
  }

  // 6. 发布警告
  const warnings = [...warningsFromBundle, ...await buildPublishWarnings(pagesSourceDir, ws)]

  return {
    ok: true,
    copiedAssets: new Array(assetStats.total).fill(''),
    copiedPages: new Array(pageCount).fill(''),
    copiedClientPages: new Array(pageCount).fill(''),
    copiedSoundsConfig,
    copiedConfig: true,
    warnings,
    targetDir: 'ui/image/djui',
    targetDirs: {
      images: 'ui/image/djui',
      clientPages: 'ui/AppBundle/user_files/djui/pages',
      clientSounds: copiedSoundsConfig ? 'ui/AppBundle/user_files/djui/sounds.json' : undefined,
    },
    message: `发布完成：素材 ${assetStats.copied} 复制 / ${assetStats.skipped} 未变跳过 / ${assetStats.removed} 清理`,
  }
}

// 镜像页面目录到指定目标（清空再复制）；目标在 ui/ 下不存在时创建并提示
async function mirrorPages(
  star: FileSystemDirectoryHandle,
  targetPath: string,
  pagesSourceDir: FileSystemDirectoryHandle,
  warnings: string[]
): Promise<number> {
  const parentPath = targetPath.substring(0, targetPath.lastIndexOf('/'))
  await fs.ensureDir(star, parentPath)
  const existed = await fs.getDirHandle(star, targetPath, false)
  if (!existed) {
    warnings.push(`目录 ${targetPath} 原本不存在，已自动创建（若这不是星火工程结构请检查）`)
  }
  const targetDir = await fs.ensureDir(star, targetPath)
  const stats = await fs.mirrorDir(pagesSourceDir, targetDir)
  return stats.total
}

async function buildPublishWarnings(pagesDir: FileSystemDirectoryHandle, workspace: FileSystemDirectoryHandle): Promise<string[]> {
  const warnings: string[] = []
  const soundIds = new Set<string>()

  const soundConfig = await readSoundConfig(workspace)
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

// 字体族在编辑器与引擎间的一致性分类：
// standard  = 工程内有标准字体文件（ttf/otf/ttc），画布与引擎加载同一文件，完全一致
// system    = 系统字体（引擎从 OS 解析），浏览器用同名系统字体，完全一致
// packaged  = 星火 TNND 封装格式，引擎可解码、浏览器不能，画布近似预览
// missing   = 目录里没有任何字体文件，引擎也无法使用
export type FontKind = 'standard' | 'system' | 'packaged' | 'missing'

export interface FontInfo {
  family: string
  kind: FontKind
  files: string[]
  imported: boolean // 是否由 DJUI 导入（可删除）
}

const IMPORTED_FONTS_FILE = '.djui/imported-fonts.json'
const FONT_EXTENSIONS = /\.(otf|ttf|ttc)$/i

function isStandardSfntMagic(magic: string, head: Uint8Array): boolean {
  return magic === 'OTTO' || magic === 'true' || magic === 'ttcf' || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0)
}

async function readHeadBytes(path: string): Promise<Uint8Array | null> {
  const star = projectContext.star
  if (!star) return null
  const handle = await fs.getFileHandle(star, path, false)
  if (!handle) return null
  try {
    const file = await handle.getFile()
    return new Uint8Array(await file.slice(0, 4).arrayBuffer())
  } catch {
    return null
  }
}

async function readImportedFamilies(): Promise<string[]> {
  const ws = projectContext.ws
  if (!ws) return []
  const data = await fs.readFileJson<{ families: string[] }>(ws, IMPORTED_FONTS_FILE)
  return data?.families ?? []
}

async function writeImportedFamilies(families: string[]): Promise<void> {
  const ws = projectContext.ws
  if (!ws) throw new Error('工作区未连接')
  await fs.writeFileJson(ws, IMPORTED_FONTS_FILE, { families })
}

export async function getFontInfos(_projectPath?: string): Promise<FontInfo[]> {
  const star = projectContext.star
  if (!star) return []

  const fonts = await getFonts()
  const imported = await readImportedFamilies()
  const infos: FontInfo[] = []
  for (const family of fonts) {
    if ((SYSTEM_FONT_FAMILIES as readonly string[]).includes(family)) {
      infos.push({ family, kind: 'system', files: [], imported: imported.includes(family) })
      continue
    }
    let entries: { dirs: string[]; files: string[] }
    try {
      entries = await fs.readDirEntries(star, family)
    } catch {
      infos.push({ family, kind: 'missing', files: [], imported: imported.includes(family) })
      continue
    }
    const fontFiles = entries.files.filter(f => FONT_EXTENSIONS.test(f))
    if (fontFiles.length === 0) {
      infos.push({ family, kind: 'missing', files: [], imported: imported.includes(family) })
      continue
    }
    let hasStandard = false
    for (const file of fontFiles) {
      const head = await readHeadBytes(`${family}/${file}`)
      if (!head) continue
      const magic = String.fromCharCode(head[0], head[1], head[2], head[3])
      if (isStandardSfntMagic(magic, head)) { hasStandard = true; break }
    }
    infos.push({
      family,
      kind: hasStandard ? 'standard' : 'packaged',
      files: fontFiles,
      imported: imported.includes(family),
    })
  }
  return infos
}

function sanitizeFamilyName(raw: string): string {
  const cleaned = raw.trim().replace(/\.(otf|ttf|ttc)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-')
  return cleaned.replace(/^-+|-+$/g, '').toLowerCase()
}

export interface ImportFontResult {
  ok: boolean
  error?: string
  family?: string
}

export async function importFontFile(file: File, familyRaw?: string): Promise<ImportFontResult> {
  const star = projectContext.star
  if (!star) return { ok: false, error: '工程目录未连接' }

  // 校验是否标准字体文件（引擎与浏览器都能直接加载）
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3])
  if (!isStandardSfntMagic(magic, head)) {
    return { ok: false, error: '不是标准字体文件（仅支持未封装的 .ttf / .otf / .ttc）' }
  }

  const familyName = sanitizeFamilyName(familyRaw && familyRaw.trim() ? familyRaw : file.name)
  if (!familyName) return { ok: false, error: '字体族名无效' }
  const family = `ui/font/${familyName}`

  const existing = await getFonts()
  if (existing.includes(family)) {
    return { ok: false, error: `字体族 ${family} 已存在，请换一个名字` }
  }

  // 写入工程字体目录
  const buffer = await file.arrayBuffer()
  await fs.ensureDir(star, family)
  await fs.writeFileBinary(star, `${family}/${file.name}`, buffer)

  // 注册到 fontref.txt（保持原有行不动，追加新行）
  const text = (await fs.readFileText(star, 'ref/fontref.txt')) ?? ''
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  lines.push(family)
  await fs.writeFileText(star, 'ref/fontref.txt', lines.join('\n') + '\n')

  // 记录为 DJUI 导入（可删除）
  const imported = await readImportedFamilies()
  if (!imported.includes(family)) imported.push(family)
  await writeImportedFamilies(imported)

  return { ok: true, family }
}

export async function removeImportedFont(family: string): Promise<ImportFontResult> {
  const star = projectContext.star
  if (!star) return { ok: false, error: '工程目录未连接' }

  const imported = await readImportedFamilies()
  if (!imported.includes(family)) {
    return { ok: false, error: '只能删除通过 DJUI 导入的字体' }
  }

  // 删除字体目录
  await fs.removeDir(star, family)

  // 从 fontref.txt 移除
  const text = (await fs.readFileText(star, 'ref/fontref.txt')) ?? ''
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && l !== family)
  await fs.writeFileText(star, 'ref/fontref.txt', lines.length > 0 ? lines.join('\n') + '\n' : '')

  // 更新导入记录
  await writeImportedFamilies(imported.filter(f => f !== family))

  return { ok: true, family }
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

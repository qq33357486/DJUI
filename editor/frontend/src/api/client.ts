import { UiPage, ProjectConfig } from '@/types/layout'

const BASE = '/api'

export async function getConfig(): Promise<ProjectConfig | null> {
  const res = await fetch(`${BASE}/project/config`)
  if (!res.ok) return null
  return res.json()
}

export async function saveConfig(config: ProjectConfig): Promise<void> {
  await fetch(`${BASE}/project/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export async function listPages(): Promise<string[]> {
  const res = await fetch(`${BASE}/pages`)
  if (!res.ok) return []
  const data = await res.json()
  return data.pages ?? []
}

export async function loadPage(pageId: string): Promise<UiPage | null> {
  const res = await fetch(`${BASE}/pages/${encodeURIComponent(pageId)}`)
  if (!res.ok) return null
  return res.json()
}

export async function savePage(page: UiPage): Promise<void> {
  await fetch(`${BASE}/pages/${encodeURIComponent(page.pageId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(page),
  })
}

export async function deletePage(pageId: string): Promise<void> {
  await fetch(`${BASE}/pages/${encodeURIComponent(pageId)}`, {
    method: 'DELETE',
  })
}

// 层级浏览结果
export interface AssetListResult {
  current: string
  parent: string | null
  dirs: string[]
  files: string[]
}

// 列出某目录下的素材（层级模式：当前目录的 dirs + files）
export async function listAssets(dirPath: string): Promise<AssetListResult> {
  const res = await fetch(`${BASE}/assets?dir=${encodeURIComponent(dirPath)}`)
  if (!res.ok) return { current: dirPath, parent: null, dirs: [], files: [] }
  const data = await res.json()
  return {
    current: data.current ?? dirPath,
    parent: data.parent ?? null,
    dirs: data.dirs ?? [],
    files: data.files ?? [],
  }
}

// 递归列出全部素材（平铺，用于搜索）
export async function listAssetsFlat(dirPath: string): Promise<string[]> {
  const res = await fetch(`${BASE}/assets?dir=${encodeURIComponent(dirPath)}&flat=true`)
  if (!res.ok) return []
  const data = await res.json()
  return data.assets ?? []
}

// 构造图片 HTTP URL（避免浏览器禁止 file:// 的问题）
// absPath: 素材绝对路径
export function assetFileUrl(absPath: string): string {
  return `${BASE}/assets/file?path=${encodeURIComponent(absPath)}`
}

// 把引擎路径（如 image/djui/icons/icon_coin_256.png）转换为可预览的 HTTP URL
// 优先尝试 workspace 成品素材目录；找不到时（已发布但工作区删除的情况）回退到星火工程 ui/image/djui
export function enginePathToUrl(enginePath: string, workspacePath: string, projectPath?: string): string {
  const rel = enginePath.replace(/^image\/djui\//, '')
  const wsAbs = `${workspacePath}/成品素材/${rel}`.replace(/\\/g, '/')
  // 后端 /api/assets/file 在文件不存在时返回 404，浏览器会触发 img.onerror
  // 这里把 workspace 和 project 都作为候选查询参数，后端按优先级尝试
  const params = new URLSearchParams()
  params.set('path', wsAbs)
  if (projectPath) {
    const projAbs = `${projectPath}/ui/${enginePath}`.replace(/\\/g, '/')
    params.set('fallback', projAbs)
  }
  return `${BASE}/assets/file?${params.toString()}`
}

export async function getEffectPresets(): Promise<{ id: string; category: string; label: string; desc: string }[]> {
  const res = await fetch(`${BASE}/effects/presets`)
  if (!res.ok) return []
  return res.json()
}

// ===== 音效配置 =====

export interface GameDataSoundEntry {
  id: string
  name: string
  category: string
  asset: string
  gameDataPath: string
  file: string
}

export interface DjuiSoundItem {
  id: string
  name: string
  gameDataPath: string
  asset: string
  category: string
  controlTypes: string[]
}

export interface DjuiSoundConfig {
  version: number
  defaultButtonSoundId: string | null
  sounds: DjuiSoundItem[]
}

export interface PatchReport {
  id: string
  changedFiles: string[]
  message: string
}

export interface ApplyPatchesResult {
  ok: boolean
  changed: boolean
  warnings: string[]
  blockers: string[]
  patches: PatchReport[]
}

export async function getGameDataSounds(projectPath: string): Promise<GameDataSoundEntry[]> {
  const res = await fetch(`${BASE}/sounds/gamedata?projectPath=${encodeURIComponent(projectPath)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.sounds ?? []
}

export async function getSoundConfig(projectPath: string): Promise<DjuiSoundConfig> {
  const res = await fetch(`${BASE}/sounds/config?projectPath=${encodeURIComponent(projectPath)}`)
  if (!res.ok) return { version: 2, defaultButtonSoundId: null, sounds: [] }
  const data = await res.json()
  return { version: data.version ?? 2, defaultButtonSoundId: data.defaultButtonSoundId ?? null, sounds: data.sounds ?? [] }
}

export async function saveSoundConfig(projectPath: string, config: DjuiSoundConfig): Promise<DjuiSoundConfig> {
  const res = await fetch(`${BASE}/sounds/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, config }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) throw new Error(data.error ?? '保存音效配置失败')
  return data.config ?? config
}

export async function applyPatches(projectPath: string): Promise<ApplyPatchesResult> {
  const res = await fetch(`${BASE}/project/apply-patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  })
  const data = await res.json()
  return {
    ok: data.ok ?? false,
    changed: data.changed ?? false,
    warnings: data.warnings ?? [],
    blockers: data.blockers ?? [],
    patches: data.patches ?? [],
  }
}

// ===== 目录浏览 =====

export interface BrowseResult {
  current: string
  parent: string | null
  dirs: string[]
  error?: string
}

export async function browseDir(dir: string): Promise<BrowseResult> {
  const res = await fetch(`${BASE}/browse?dir=${encodeURIComponent(dir)}`)
  return res.json()
}

export async function getBrowseRoots(): Promise<{ roots: string[]; platform: string }> {
  const res = await fetch(`${BASE}/browse/roots`)
  return res.json()
}

export async function mkdir(parentPath: string, name: string): Promise<{ ok: boolean; error?: string; path?: string }> {
  const res = await fetch(`${BASE}/browse/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentPath, name }),
  })
  return res.json()
}

// ===== Runtime 检查/初始化 =====

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

export async function checkRuntime(projectPath: string): Promise<RuntimeStatus> {
  const res = await fetch(`${BASE}/project/check-runtime?projectPath=${encodeURIComponent(projectPath)}`)
  return res.json()
}

export interface InitRuntimeResult {
  ok: boolean
  error?: string
  version?: string
  targetDir?: string
  copiedFiles?: string[]
}

export async function initRuntime(projectPath: string): Promise<InitRuntimeResult> {
  const res = await fetch(`${BASE}/project/init-runtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  })
  return res.json()
}

// ===== UI 工作区 =====

export interface WorkspaceStatus {
  status: 'empty' | 'partial' | 'ok' | 'invalid'
  message: string
  dirs: string[]
  missing?: string[]
  hasAgents?: boolean
}

export async function checkWorkspace(workspacePath: string): Promise<WorkspaceStatus> {
  const res = await fetch(`${BASE}/workspace/check?workspacePath=${encodeURIComponent(workspacePath)}`)
  return res.json()
}

export interface InitWorkspaceResult {
  ok: boolean
  error?: string
  workspacePath?: string
  dirs?: string[]
  created?: string[]
  message?: string
}

export async function initWorkspace(workspacePath: string): Promise<InitWorkspaceResult> {
  const res = await fetch(`${BASE}/workspace/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath }),
  })
  return res.json()
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

export async function publishAssets(workspacePath: string, projectPath: string): Promise<PublishResult> {
  const res = await fetch(`${BASE}/workspace/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, projectPath }),
  })
  return res.json()
}

// ===== AGENTS.md 规范更新检查 =====

export interface AgentsStatus {
  status: 'ok' | 'outdated' | 'missing'
  latestVersion: string
  installedVersion: string | null
  message: string
}

export async function checkAgentsUpdate(workspacePath: string): Promise<AgentsStatus> {
  const res = await fetch(`${BASE}/workspace/check-agents?workspacePath=${encodeURIComponent(workspacePath)}`)
  return res.json()
}

export async function updateAgents(workspacePath: string): Promise<{ ok: boolean; version?: string; message?: string; error?: string }> {
  const res = await fetch(`${BASE}/workspace/update-agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath }),
  })
  return res.json()
}

// ===== 工具脚本（脚本区）同步检查 =====

export interface ScriptsStatus {
  status: 'ok' | 'outdated' | 'missing' | 'unavailable'
  latestVersion: string | null
  installedVersion: string | null
  message: string
}

export async function checkScriptsUpdate(workspacePath: string): Promise<ScriptsStatus> {
  const res = await fetch(`${BASE}/workspace/check-scripts?workspacePath=${encodeURIComponent(workspacePath)}`)
  return res.json()
}

export async function updateScripts(workspacePath: string): Promise<{ ok: boolean; version?: string; copiedFiles?: string[]; targetDir?: string; message?: string; error?: string }> {
  const res = await fetch(`${BASE}/workspace/update-scripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath }),
  })
  return res.json()
}

// ===== 字体列表 =====

export async function getFonts(projectPath: string): Promise<string[]> {
  const res = await fetch(`${BASE}/project/fonts?projectPath=${encodeURIComponent(projectPath)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.fonts ?? []
}

// ===== 项目色盘 =====

export async function getPalette(workspacePath: string): Promise<string[]> {
  const res = await fetch(`${BASE}/workspace/palette?workspacePath=${encodeURIComponent(workspacePath)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.colors ?? []
}

export async function addPaletteColor(workspacePath: string, color: string): Promise<void> {
  await fetch(`${BASE}/workspace/palette`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, color }),
  })
}

export async function removePaletteColor(workspacePath: string, color: string): Promise<void> {
  await fetch(`${BASE}/workspace/palette`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, color }),
  })
}

// ===== 素材九宫格元数据 =====

export interface SliceEdges { left: number; top: number; right: number; bottom: number }
export type SliceMeta = Record<string, SliceEdges>

export async function getSliceMeta(workspacePath: string): Promise<SliceMeta> {
  const res = await fetch(`${BASE}/slice-meta?workspacePath=${encodeURIComponent(workspacePath)}`)
  if (!res.ok) return {}
  const data = await res.json()
  return data.meta ?? {}
}

export async function setSliceMeta(workspacePath: string, image: string, edges: SliceEdges | null): Promise<SliceMeta> {
  const res = await fetch(`${BASE}/slice-meta`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, image, edges }),
  })
  const data = await res.json()
  return data.meta ?? {}
}

// ===== 素材审批 =====

export async function getPendingReview(workspacePath: string): Promise<Record<string, string[]>> {
  const res = await fetch(`${BASE}/workspace/pending-review?workspacePath=${encodeURIComponent(workspacePath)}`)
  if (!res.ok) return {}
  const data = await res.json()
  return data.groups ?? {}
}

export async function approveFiles(workspacePath: string, files: string[]): Promise<{ moved: number; errors: string[] }> {
  const res = await fetch(`${BASE}/workspace/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, files }),
  })
  return res.json()
}

export async function rejectFiles(workspacePath: string, files: string[]): Promise<{ deleted: number; errors: string[] }> {
  const res = await fetch(`${BASE}/workspace/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, files }),
  })
  return res.json()
}

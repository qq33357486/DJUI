// 发布核心：网页和 Node CLI 都只调用这里，避免两套发布规则漂移。
import {
  type DjuiSoundConfig,
  type PatchRunResult,
  createRuntimePageSnapshot,
  getDefaultSoundConfig,
  patchPageNodeTree,
  sanitizeSoundConfig,
} from './patches'
import { DJUI_PROTOCOL_VERSION } from '../types/protocolV6'
import { RUNTIME_FILES, RUNTIME_VERSION, type BundledRuntimeFile } from './runtimeBundle'

export type StoreEntry = { name: string; kind: 'file' | 'directory' }

export interface PublishStore {
  readonly label: string
  fileExists(path: string): Promise<boolean>
  dirExists(path: string): Promise<boolean>
  ensureDir(path: string): Promise<void>
  listEntries(path: string): Promise<StoreEntry[]>
  readText(path: string): Promise<string | null>
  readBytes(path: string): Promise<Uint8Array | null>
  readJson<T>(path: string): Promise<T | null>
  writeText(path: string, content: string): Promise<void>
  writeBytes(path: string, content: Uint8Array): Promise<void>
  writeJson(path: string, data: unknown): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  fileInfo(path: string): Promise<{ size: number; mtime: number } | null>
}

export interface RuntimeStatusCore {
  status: 'missing' | 'outdated' | 'ok' | 'invalid'
  message: string
  installedVersion?: string
  expectedVersion?: string
  /** 已安装版本比当前工具内置的更新：问题在调用方（网页/CLI）过旧，禁止引导 upgrade-runtime */
  installedNewer?: boolean
  installedDir?: string
  installedFiles?: string[]
  sourceFiles?: string[]
  missingFiles?: string[]
  extraFiles?: string[]
}

export type UpgradeRuntimeResult =
  | { ok: true; version: string; targetDir: string; copiedFiles: string[] }
  | { ok: false; code: 'RUNTIME_DOWNGRADE_BLOCKED'; error: string; userAction: string }

/** 语义化版本比较（x.y.z 数字段），返回 >0 / 0 / <0 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().split('.').map(part => parseInt(part, 10))
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

export interface PublishCoreResult {
  ok: boolean
  code?: 'RUNTIME_NOT_READY' | 'PUBLISHER_OUTDATED' | 'INVALID_WORKSPACE' | 'PUBLISH_FAILED'
  error?: string
  userAction?: string
  copiedAssets?: string[]
  copiedPages?: string[]
  copiedClientPages?: string[]
  copiedSoundsConfig?: boolean
  copiedConfig?: boolean
  warnings?: string[]
  targetDir?: string
  targetDirs?: { images?: string; clientPages?: string; clientSounds?: string }
  message?: string
}

export const PUBLISH_CONFIG_FILE = '.djui/publish.json'
const UI_LAYOUT_DIR = '.djui/layout'
const PROJECT_FILE = UI_LAYOUT_DIR + '/project.json'
const PAGES_DIR = UI_LAYOUT_DIR + '/pages'
const SOUNDS_FILE = UI_LAYOUT_DIR + '/sounds.json'
const SLICE_META_FILE = '.djui/slice-meta.json'
const STAR_LAYOUT_DIR = 'ui/djui'
const STAR_PROJECT_FILE = STAR_LAYOUT_DIR + '/project.json'
const STAR_PAGES_DIR = STAR_LAYOUT_DIR + '/pages'
const STAR_SOUNDS_FILE = STAR_LAYOUT_DIR + '/sounds.json'
const CLIENT_DJUI_DIR = 'ui/AppBundle/user_files/djui'
const CLIENT_PAGES_DIR = CLIENT_DJUI_DIR + '/pages'
const IMAGE_TARGET_DIR = 'ui/image/djui'
const MANIFEST_PATH = 'ui/.djui-publish-manifest.json'

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\\/g, '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function walkFiles(store: PublishStore, path: string): Promise<string[]> {
  if (!(await store.dirExists(path))) return []
  const result: string[] = []
  for (const entry of await store.listEntries(path)) {
    const child = joinPath(path, entry.name)
    if (entry.kind === 'directory') result.push(...await walkFiles(store, child))
    else result.push(child)
  }
  return result.sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

async function mirrorDirectory(
  source: PublishStore,
  sourcePath: string,
  target: PublishStore,
  targetPath: string,
  transform?: (sourceFilePath: string, relativePath: string, data: Uint8Array) => Promise<Uint8Array> | Uint8Array,
  shouldSkip?: (relativePath: string, info: { size: number; mtime: number }) => Promise<boolean>,
): Promise<{ copied: number; skipped: number; removed: number; total: number }> {
  const stats = { copied: 0, skipped: 0, removed: 0, total: 0 }
  await target.ensureDir(targetPath)
  const sourceEntries = await source.listEntries(sourcePath)
  const remaining = new Map((await target.listEntries(targetPath)).map(entry => [entry.name, entry]))

  for (const entry of sourceEntries) {
    remaining.delete(entry.name)
    const from = joinPath(sourcePath, entry.name)
    const to = joinPath(targetPath, entry.name)
    if (entry.kind === 'directory') {
      const nested = await mirrorDirectory(source, from, target, to, transform, shouldSkip)
      stats.copied += nested.copied; stats.skipped += nested.skipped; stats.removed += nested.removed; stats.total += nested.total
      continue
    }

    stats.total++
    const relative = from.slice(sourcePath.length).replace(/^\//, '')
    const info = await source.fileInfo(from)
    if (info && shouldSkip && await shouldSkip(relative, info) && await target.fileExists(to)) {
      stats.skipped++
      continue
    }
    const content = await source.readBytes(from)
    if (content === null) throw new Error(`无法读取发布源文件：${from}`)
    await target.writeBytes(to, transform ? await transform(from, relative, content) : content)
    stats.copied++
  }

  for (const entry of remaining.values()) {
    await target.remove(joinPath(targetPath, entry.name), entry.kind === 'directory')
    stats.removed++
  }
  return stats
}

async function collectFingerprints(store: PublishStore, dir: string): Promise<Record<string, [number, number]>> {
  const result: Record<string, [number, number]> = {}
  for (const file of await walkFiles(store, dir)) {
    const info = await store.fileInfo(file)
    if (!info) continue
    result[file.slice(dir.length).replace(/^\//, '')] = [info.size, info.mtime]
  }
  return result
}

export async function applyProjectPatchesCore(store: PublishStore): Promise<PatchRunResult> {
  const result: PatchRunResult = {
    ok: true, changed: false, warnings: [], blockers: [], patches: [],
    soundSetup: { status: 'missing-config', soundCount: 0, defaultButtonSoundId: null, missingButtonSounds: 0 },
  }
  const rawSound = await store.readJson<unknown>(SOUNDS_FILE)
  const hasSoundConfig = rawSound !== null
  const soundConfig: DjuiSoundConfig = rawSound === null ? getDefaultSoundConfig() : sanitizeSoundConfig(rawSound)
  if (rawSound !== null && !jsonEquals(rawSound, soundConfig)) {
    await store.writeJson(SOUNDS_FILE, soundConfig)
    result.changed = true
    result.patches.push({ id: 'sound-config-v2', changedFiles: [SOUNDS_FILE], message: '声音配置已升级到 v2' })
  }

  const pages = (await walkFiles(store, PAGES_DIR)).filter(file => file.toLowerCase().endsWith('.json'))
  const migratedAnchorFiles: string[] = []
  const patchedButtonFiles: string[] = []
  let missingButtonSounds = 0
  for (const file of pages) {
    const displayName = file.slice(PAGES_DIR.length + 1)
    const page = await store.readJson<unknown>(file)
    if (page === null) { result.blockers.push(`页面 JSON 读取失败：${displayName}`); continue }
    // 协议分流：Runtime 只认 v6（严格反序列化），发布器绝不改写页面协议结构。
    // 旧协议页面一律拒绝发布，由用户在编辑器中打开保存完成迁移。
    const protocolVersion = isRecord(page) && typeof page.protocolVersion === 'number' ? page.protocolVersion : null
    if (protocolVersion !== DJUI_PROTOCOL_VERSION) {
      result.blockers.push(
        `页面 ${displayName} 不是 v6 协议（protocolVersion=${protocolVersion ?? '缺失'}），发布器拒绝自动迁移；` +
        `请在 DJUI 编辑器打开并保存该页面完成 v6 迁移后再发布`,
      )
      continue
    }
    // v6 页面只做节点级语义补丁（锚点/音效），顶层协议字段原样保留
    const patch = patchPageNodeTree(page, soundConfig.defaultButtonSoundId)
    missingButtonSounds += patch.missingButtonSounds
    if (patch.changed) {
      await store.writeJson(file, page)
      result.changed = true
      if (patch.migratedAnchors > 0) migratedAnchorFiles.push(file)
      if (patch.patchedButtonSounds > 0) patchedButtonFiles.push(file)
    }
  }
  if (migratedAnchorFiles.length) result.patches.push({ id: 'page-anchor-v4', changedFiles: migratedAnchorFiles, message: `已迁移 ${migratedAnchorFiles.length} 个页面的旧锚点数据` })
  if (patchedButtonFiles.length) result.patches.push({ id: 'button-default-click-sound', changedFiles: patchedButtonFiles, message: `已为 ${patchedButtonFiles.length} 个页面补齐 Button 默认点击音效` })
  result.soundSetup = {
    status: !hasSoundConfig ? 'missing-config' : soundConfig.sounds.length === 0 ? 'no-sounds' : !soundConfig.defaultButtonSoundId ? 'missing-default' : 'ok',
    soundCount: soundConfig.sounds.length,
    defaultButtonSoundId: soundConfig.defaultButtonSoundId,
    missingButtonSounds,
  }
  return result
}

async function getSliceMeta(store: PublishStore): Promise<Record<string, { left: number; top: number; right: number; bottom: number }>> {
  const raw = await store.readJson<unknown>(SLICE_META_FILE)
  return isRecord(raw) ? raw as Record<string, { left: number; top: number; right: number; bottom: number }> : {}
}

async function buildPublishWarnings(store: PublishStore): Promise<string[]> {
  const warnings: string[] = []
  const config = sanitizeSoundConfig(await store.readJson<unknown>(SOUNDS_FILE))
  const soundIds = new Set(config.sounds.map(sound => sound.id))
  const refs = new Set<string>()
  const collectRefs = (node: unknown) => {
    if (!isRecord(node)) return
    const djui = isRecord(node.djui) ? node.djui : null
    if (typeof djui?.clickSoundId === 'string' && djui.clickSoundId) refs.add(djui.clickSoundId)
    if (Array.isArray(node.children)) node.children.forEach(collectRefs)
  }
  for (const file of (await walkFiles(store, PAGES_DIR)).filter(file => file.endsWith('.json'))) {
    const page = await store.readJson<unknown>(file)
    if (isRecord(page)) collectRefs(page.root)
  }
  for (const ref of refs) if (!soundIds.has(ref)) warnings.push(`音效引用 ${ref} 在 sounds.json 中不存在`)
  return warnings
}

/**
 * 旧版项目把 layout 留在星火工程；一旦用户触发脚本更新或发布，立即迁回工作区。
 * 这是幂等操作：工作区已有 project.json 时绝不覆盖编辑源。
 */
export async function migrateLegacyLayoutCore(workspace: PublishStore, star: PublishStore): Promise<{ migrated: boolean; pages: number; sounds: boolean }> {
  if (await workspace.fileExists(PROJECT_FILE) || !(await star.fileExists(STAR_PROJECT_FILE))) {
    return { migrated: false, pages: 0, sounds: false }
  }
  const project = await star.readBytes(STAR_PROJECT_FILE)
  if (project === null) throw new Error('旧版项目配置无法读取，无法迁移')
  await workspace.writeBytes(PROJECT_FILE, project)
  let pages = 0
  for (const file of await walkFiles(star, STAR_PAGES_DIR)) {
    if (!file.toLowerCase().endsWith('.json')) continue
    const data = await star.readBytes(file)
    if (data === null) throw new Error(`旧版页面无法读取：${file}`)
    await workspace.writeBytes(joinPath(PAGES_DIR, file.slice(STAR_PAGES_DIR.length).replace(/^\//, '')), data)
    pages++
  }
  let sounds = false
  const soundData = await star.readBytes(STAR_SOUNDS_FILE)
  if (soundData !== null) {
    await workspace.writeBytes(SOUNDS_FILE, soundData)
    sounds = true
  }
  return { migrated: true, pages, sounds }
}

export async function checkRuntimeCore(star: PublishStore): Promise<RuntimeStatusCore> {
  const runtimeDir = 'src/DjuiRuntime'
  if (!(await star.dirExists(runtimeDir))) return { status: 'missing', message: '未安装 Runtime' }
  const installedVersion = (await star.readText(runtimeDir + '/djui_version.txt'))?.trim() ?? 'unknown'
  const installedFiles = (await star.listEntries(runtimeDir))
    .filter(entry => entry.kind === 'file' && (entry.name.endsWith('.cs') || entry.name === 'AGENTS.md'))
    .map(entry => entry.name)
  const sourceFiles = RUNTIME_FILES.map(file => file.name)
  const missingFiles = sourceFiles.filter(file => !installedFiles.includes(file))
  const extraFiles = installedFiles.filter(file => !sourceFiles.includes(file))
  if (installedVersion === RUNTIME_VERSION && missingFiles.length === 0 && extraFiles.length === 0) {
    return { status: 'ok', message: 'Runtime 已就绪', installedVersion, expectedVersion: RUNTIME_VERSION }
  }
  if (compareVersions(installedVersion, RUNTIME_VERSION) > 0) {
    return {
      status: 'outdated', installedNewer: true,
      message: `星火工程 Runtime（${installedVersion}）比当前工具内置（${RUNTIME_VERSION}）更新，工具侧过旧`,
      installedVersion, expectedVersion: RUNTIME_VERSION, installedFiles, sourceFiles, missingFiles, extraFiles,
    }
  }
  return { status: 'outdated', message: 'Runtime 可升级', installedVersion, expectedVersion: RUNTIME_VERSION, installedFiles, sourceFiles, missingFiles, extraFiles }
}

export async function upgradeRuntimeCore(star: PublishStore, files: BundledRuntimeFile[] = RUNTIME_FILES): Promise<UpgradeRuntimeResult> {
  const dir = 'src/DjuiRuntime'
  const current = (await star.readText(dir + '/djui_version.txt'))?.trim()
  if (current && compareVersions(current, RUNTIME_VERSION) > 0) {
    return {
      ok: false, code: 'RUNTIME_DOWNGRADE_BLOCKED',
      error: `星火工程 Runtime 已是 ${current}，比当前工具内置的 ${RUNTIME_VERSION} 更新`,
      userAction: '禁止降级：请先在 DJUI 网页执行「检查工作区更新」同步脚本区，让本地发布器与 Runtime 同代后再操作。',
    }
  }
  await star.ensureDir(dir)
  for (const entry of await star.listEntries(dir)) if (entry.kind === 'file' && entry.name.endsWith('.cs')) await star.remove(joinPath(dir, entry.name))
  for (const file of files) await star.writeText(joinPath(dir, file.name), file.content)
  await star.writeText(joinPath(dir, 'djui_version.txt'), RUNTIME_VERSION)
  await star.writeText(joinPath(dir, 'README.md'), `# DJUI Runtime\n\nVersion: ${RUNTIME_VERSION}\n\nThis directory was auto-created by DJUI Editor.\nDo not edit manually - use DJUI Editor to update.\n`)
  return { ok: true, version: RUNTIME_VERSION, targetDir: dir, copiedFiles: files.map(file => file.name) }
}

export async function publishCore(workspace: PublishStore, star: PublishStore): Promise<PublishCoreResult> {
  await migrateLegacyLayoutCore(workspace, star)
  const runtime = await checkRuntimeCore(star)
  if (runtime.status !== 'ok') {
    if (runtime.installedNewer) return {
      ok: false, code: 'PUBLISHER_OUTDATED',
      error: `星火工程 Runtime 已是 ${runtime.installedVersion ?? '未知版本'}，比本发布器内置的 ${RUNTIME_VERSION} 更新`,
      userAction: '本地发布器过旧：请让用户在 DJUI 网页执行「检查工作区更新」同步脚本区后再发布。禁止执行 upgrade-runtime（会把 Runtime 降级）。',
    }
    return {
      ok: false, code: 'RUNTIME_NOT_READY', error: runtime.message,
      userAction: `DJUI Runtime 状态为 ${runtime.status}（已安装 ${runtime.installedVersion ?? '无'}，需要 ${runtime.expectedVersion ?? RUNTIME_VERSION}）。请询问用户是否允许执行 upgrade-runtime。`,
    }
  }
  const patches = await applyProjectPatchesCore(workspace)
  if (!patches.ok || patches.blockers.length) return { ok: false, code: 'INVALID_WORKSPACE', error: patches.blockers.join('\n') || '补丁应用失败' }
  if (!(await workspace.dirExists('成品素材'))) return { ok: false, code: 'INVALID_WORKSPACE', error: '成品素材目录不存在' }
  if (!(await workspace.dirExists(PAGES_DIR))) return { ok: false, code: 'INVALID_WORKSPACE', error: '页面目录不存在' }
  const projectData = await workspace.readText(PROJECT_FILE)
  if (!projectData) return { ok: false, code: 'INVALID_WORKSPACE', error: '缺少工作区 .djui/layout/project.json' }

  const prevManifest = await star.readJson<{ files?: Record<string, [number, number]> }>(MANIFEST_PATH) ?? {}
  const previousFiles = prevManifest.files ?? {}
  const assets = await mirrorDirectory(workspace, '成品素材', star, IMAGE_TARGET_DIR, undefined, async (relative, info) => {
    const previous = previousFiles[relative]
    return !!previous && previous[0] === info.size && previous[1] === info.mtime
  })
  await star.writeJson(MANIFEST_PATH, { files: await collectFingerprints(workspace, '成品素材') })

  const warnings: string[] = []
  const serverPages = await mirrorDirectory(workspace, PAGES_DIR, star, STAR_PAGES_DIR)
  const sliceMeta = await getSliceMeta(workspace)
  const clientPagesExisted = await star.dirExists(CLIENT_PAGES_DIR)
  const clientPages = await mirrorDirectory(workspace, PAGES_DIR, star, CLIENT_PAGES_DIR, async (file, _relative, bytes) => {
    if (!file.toLowerCase().endsWith('.json')) return bytes
    const page = JSON.parse(new TextDecoder().decode(bytes))
    return new TextEncoder().encode(JSON.stringify(createRuntimePageSnapshot(page, sliceMeta), null, 2))
  })
  if (!clientPagesExisted) warnings.push(`目录 ${CLIENT_PAGES_DIR} 原本不存在，已自动创建（若这不是星火工程结构请检查）`)
  await star.writeText(STAR_PROJECT_FILE, projectData)
  await star.writeText(CLIENT_DJUI_DIR + '/project.json', projectData)
  let copiedSoundsConfig = false
  const sounds = await workspace.readText(SOUNDS_FILE)
  if (sounds) {
    await star.writeText(STAR_SOUNDS_FILE, sounds)
    await star.writeText(CLIENT_DJUI_DIR + '/sounds.json', sounds)
    copiedSoundsConfig = true
  }
  warnings.push(...await buildPublishWarnings(workspace))
  return {
    ok: true,
    copiedAssets: new Array(assets.total).fill(''), copiedPages: new Array(serverPages.total).fill(''), copiedClientPages: new Array(clientPages.total).fill(''),
    copiedSoundsConfig, copiedConfig: true, warnings,
    targetDir: IMAGE_TARGET_DIR,
    targetDirs: { images: IMAGE_TARGET_DIR, clientPages: CLIENT_PAGES_DIR, clientSounds: copiedSoundsConfig ? CLIENT_DJUI_DIR + '/sounds.json' : undefined },
    message: `发布完成：素材 ${assets.copied} 复制 / ${assets.skipped} 未变跳过 / ${assets.removed} 清理`,
  }
}

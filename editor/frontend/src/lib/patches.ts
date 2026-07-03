// 补丁/迁移逻辑（从后端 patches.ts 移植，改造为异步 DirectoryHandle 操作）

import * as fs from '../fs/fsAccess'
import { normalizePage, normalizeDetectChanges } from './normalize'

export const SOUND_CONFIG_VERSION = 2
export const PAGE_SCHEMA_VERSION = 5

type JsonRecord = Record<string, unknown>

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

export interface PatchRunResult {
  ok: boolean
  changed: boolean
  warnings: string[]
  blockers: string[]
  patches: PatchReport[]
}

export interface PagePatchResult {
  changed: boolean
  migratedAnchors: number
  patchedButtonSounds: number
  missingButtonSounds: number
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// 页面目录：ui/djui/pages
const PAGES_DIR = 'ui/djui/pages'
// 声音配置：ui/djui/sounds.json
const SOUNDS_FILE = 'ui/djui/sounds.json'

export function getDefaultSoundConfig(): DjuiSoundConfig {
  return { version: SOUND_CONFIG_VERSION, defaultButtonSoundId: null, sounds: [] }
}

export function soundAppliesToButton(sound: DjuiSoundItem): boolean {
  return sound.controlTypes.length === 0 || sound.controlTypes.includes('Button')
}

export function sanitizeSoundConfig(raw: unknown): DjuiSoundConfig {
  const source = isRecord(raw) ? raw : {}
  const rawSounds = Array.isArray(source.sounds) ? source.sounds : []
  const ids = new Set<string>()
  const sounds: DjuiSoundItem[] = []

  for (const item of rawSounds) {
    if (!isRecord(item)) continue
    const id = String(item.id ?? '').trim()
    if (!id || ids.has(id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) continue

    const name = String(item.name ?? id).trim() || id
    const gameDataPath = String(item.gameDataPath ?? '').trim()
    const asset = normalizeSlashes(String(item.asset ?? '').trim())
    const category = String(item.category ?? '').trim()
    const controlTypes = Array.isArray(item.controlTypes)
      ? [...new Set(item.controlTypes.map(x => String(x).trim()).filter(Boolean))]
      : []

    sounds.push({ id, name, gameDataPath, asset, category, controlTypes })
    ids.add(id)
  }

  const requestedDefault = typeof source.defaultButtonSoundId === 'string'
    ? source.defaultButtonSoundId.trim()
    : ''
  const defaultSound = requestedDefault
    ? sounds.find(sound => sound.id === requestedDefault && soundAppliesToButton(sound))
    : null

  return {
    version: SOUND_CONFIG_VERSION,
    defaultButtonSoundId: defaultSound ? defaultSound.id : null,
    sounds,
  }
}

export function validateSoundConfigForSave(raw: unknown): { config: DjuiSoundConfig; error?: string } {
  const config = sanitizeSoundConfig(raw)
  if (config.sounds.length === 0) return { config }

  if (!config.defaultButtonSoundId) {
    return { config, error: '请先选择一个适用于 Button 的按钮默认音效' }
  }

  const defaultSound = config.sounds.find(sound => sound.id === config.defaultButtonSoundId)
  if (!defaultSound || !soundAppliesToButton(defaultSound)) {
    return { config, error: '按钮默认音效不存在，或未允许用于 Button 控件' }
  }

  return { config }
}

function migrateOldAnchor(anchor: JsonRecord): { side: string; stretchStyle: 'None' | 'Horizontal' | 'Vertical' | 'Both' } {
  if (typeof anchor.side === 'string' && anchor.side) {
    return { side: anchor.side, stretchStyle: 'None' }
  }

  const min = isRecord(anchor.anchorMin) ? anchor.anchorMin : null
  const max = isRecord(anchor.anchorMax) ? anchor.anchorMax : null
  const minX = typeof min?.x === 'number' ? min.x : null
  const minY = typeof min?.y === 'number' ? min.y : null
  const maxX = typeof max?.x === 'number' ? max.x : null
  const maxY = typeof max?.y === 'number' ? max.y : null

  if (minX === null || minY === null || maxX === null || maxY === null) {
    return { side: 'TopLeft', stretchStyle: 'None' }
  }

  const hStretch = Math.abs(maxX - minX) > 0.001
  const vStretch = Math.abs(maxY - minY) > 0.001
  const hSide = minX < 0.25 ? 'Left' : minX > 0.75 ? 'Right' : 'Center'
  const vSide = minY < 0.25 ? 'Bottom' : minY > 0.75 ? 'Top' : 'Middle'

  let side: string
  if (hStretch && vStretch) {
    side = 'Center'
  } else if (hStretch) {
    side = vSide === 'Middle' ? 'Center' : vSide
  } else if (vStretch) {
    side = hSide
  } else if (vSide === 'Middle' && hSide === 'Center') {
    side = 'Center'
  } else if (vSide === 'Middle') {
    side = hSide
  } else if (hSide === 'Center') {
    side = vSide
  } else {
    side = `${vSide}${hSide}`
  }

  const stretchStyle =
    hStretch && vStretch ? 'Both' : hStretch ? 'Horizontal' : vStretch ? 'Vertical' : 'None'

  return { side, stretchStyle }
}

function patchNode(node: unknown, defaultButtonSoundId: string | null, result: PagePatchResult) {
  if (!isRecord(node)) return

  const anchor = isRecord(node.anchor) ? node.anchor : null
  if (anchor && isRecord(anchor.anchorMin) && !anchor.side) {
    const migrated = migrateOldAnchor(anchor)
    anchor.side = migrated.side

    if (migrated.stretchStyle !== 'None') {
      node.stretch = {
        style: migrated.stretchStyle,
        margins: {
          left: typeof anchor.left === 'number' ? anchor.left : 0,
          right: typeof anchor.right === 'number' ? anchor.right : 0,
          top: typeof anchor.top === 'number' ? anchor.top : 0,
          bottom: typeof anchor.bottom === 'number' ? anchor.bottom : 0,
        },
      }
    }

    delete anchor.anchorMin
    delete anchor.anchorMax
    delete anchor.left
    delete anchor.right
    delete anchor.top
    delete anchor.bottom
    delete anchor.preset
    result.changed = true
    result.migratedAnchors++
  }

  if (anchor && !anchor.side) {
    anchor.side = 'TopLeft'
    result.changed = true
  }

  if (node.starType === 'Button') {
    const djui = isRecord(node.djui) ? node.djui : {}
    const currentSound = typeof djui.clickSoundId === 'string' ? djui.clickSoundId.trim() : ''
    if (!currentSound) {
      if (defaultButtonSoundId) {
        if (!isRecord(node.djui)) node.djui = djui
        djui.clickSoundId = defaultButtonSoundId
        result.changed = true
        result.patchedButtonSounds++
      } else {
        result.missingButtonSounds++
      }
    }
  }

  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) patchNode(child, defaultButtonSoundId, result)
  }
}

export function patchPageData(page: unknown, defaultButtonSoundId: string | null): PagePatchResult {
  const result: PagePatchResult = {
    changed: false,
    migratedAnchors: 0,
    patchedButtonSounds: 0,
    missingButtonSounds: 0,
  }

  // 数据边界关卡：先归一化结构，确保 root/children 安全
  const normalized = normalizePage(page)
  if (!normalized) return result

  // 把归一化后的数据写回原对象（保持引用语义）
  const pageObj = page as Record<string, unknown>
  if (isRecord(page)) {
    Object.keys(pageObj).forEach(k => delete pageObj[k])
    Object.assign(pageObj, normalized)
  }

  if (pageObj.version !== PAGE_SCHEMA_VERSION) {
    pageObj.version = PAGE_SCHEMA_VERSION
    result.changed = true
  }

  patchNode(pageObj.root, defaultButtonSoundId, result)
  return result
}

// 递归注入 slicedEdges
function injectSliceEdges(node: any, meta: Record<string, { left: number; top: number; right: number; bottom: number }>) {
  if (!node) return
  const appearance = node.appearance
  if (isRecord(appearance) && typeof appearance.image === 'string' && appearance.image) {
    const key = normalizeSlashes(appearance.image)
    const edges = meta[key]
    if (edges) {
      node.appearance.slicedEdges = [edges.left, edges.top, edges.right, edges.bottom]
    } else if ('slicedEdges' in appearance) {
      delete appearance.slicedEdges
    }
  }
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) injectSliceEdges(child, meta)
  }
}

// 删除编辑器专用字段
function stripEditorFields(node: any) {
  if (!isRecord(node)) return
  delete node.editorLocked
  delete node.editorHidden
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) stripEditorFields(child)
  }
}

// 从工程目录读声音配置
export async function readSoundConfig(projectRoot: FileSystemDirectoryHandle): Promise<DjuiSoundConfig> {
  const data = await fs.readFileJson<unknown>(projectRoot, SOUNDS_FILE)
  if (data === null) return getDefaultSoundConfig()
  return sanitizeSoundConfig(data)
}

// 异步版 applyProjectPatches：操作工程目录 handle
export async function applyProjectPatches(projectRoot: FileSystemDirectoryHandle): Promise<PatchRunResult> {
  const result: PatchRunResult = {
    ok: true,
    changed: false,
    warnings: [],
    blockers: [],
    patches: [],
  }

  // 1. 声音配置
  let soundConfig: DjuiSoundConfig
  const rawSound = await fs.readFileJson<unknown>(projectRoot, SOUNDS_FILE)
  if (rawSound === null) {
    result.warnings.push('当前工程没有声音配置，请在"声音配置"中添加音效并选择按钮默认音效。')
    soundConfig = getDefaultSoundConfig()
  } else {
    const config = sanitizeSoundConfig(rawSound)
    if (!jsonEquals(rawSound, config)) {
      await fs.writeFileJson(projectRoot, SOUNDS_FILE, config)
      result.changed = true
      result.patches.push({
        id: 'sound-config-v2',
        changedFiles: [normalizeSlashes(SOUNDS_FILE)],
        message: `声音配置已升级到 v${SOUND_CONFIG_VERSION}`,
      })
    }
    if (config.sounds.length === 0) {
      result.warnings.push('当前工程没有任何 DJUI 音效配置，Button 暂时不会自动补齐点击音效。')
    } else if (!config.defaultButtonSoundId) {
      result.blockers.push('已配置音效，但尚未选择按钮默认音效。请打开"声音配置"并选择一个适用于 Button 的默认音效。')
    }
    soundConfig = config
  }

  // 2. 页面补丁
  const pagesDir = await fs.getDirHandle(projectRoot, PAGES_DIR, false)
  if (!pagesDir) return result

  const jsonFiles = await fs.walkJsonFiles(pagesDir)
  const migratedAnchorFiles: string[] = []
  const patchedButtonFiles: string[] = []
  const normalizedFiles: string[] = []
  let totalMissingButtonSounds = 0

  for (const file of jsonFiles) {
    const page = await fs.readFileJson<unknown>(pagesDir, file)
    if (page === null) {
      result.blockers.push(`页面 JSON 读取失败：${file}`)
      continue
    }

    // 检测是否需要结构归一化修复
    const needsNormalize = normalizeDetectChanges(page)

    const pagePatch = patchPageData(page, soundConfig.defaultButtonSoundId)
    totalMissingButtonSounds += pagePatch.missingButtonSounds

    if (pagePatch.changed || needsNormalize) {
      await fs.writeFileJson(pagesDir, file, page)
      result.changed = true
      if (needsNormalize) normalizedFiles.push(normalizeSlashes(`${PAGES_DIR}/${file}`))
      if (pagePatch.migratedAnchors > 0) migratedAnchorFiles.push(normalizeSlashes(`${PAGES_DIR}/${file}`))
      if (pagePatch.patchedButtonSounds > 0) patchedButtonFiles.push(normalizeSlashes(`${PAGES_DIR}/${file}`))
    }
  }

  if (normalizedFiles.length > 0) {
    result.patches.push({
      id: 'page-structure-normalize',
      changedFiles: normalizedFiles,
      message: `已修复 ${normalizedFiles.length} 个页面的节点结构（补全缺失字段）`,
    })
  }

  if (migratedAnchorFiles.length > 0) {
    result.patches.push({
      id: 'page-anchor-v4',
      changedFiles: migratedAnchorFiles,
      message: `已迁移 ${migratedAnchorFiles.length} 个页面的旧锚点数据`,
    })
  }

  if (patchedButtonFiles.length > 0) {
    result.patches.push({
      id: 'button-default-click-sound',
      changedFiles: patchedButtonFiles,
      message: `已为 ${patchedButtonFiles.length} 个页面补齐 Button 默认点击音效`,
    })
  }

  if (totalMissingButtonSounds > 0 && !soundConfig.defaultButtonSoundId) {
    const message = soundConfig.sounds.length > 0
      ? `还有 ${totalMissingButtonSounds} 个 Button 缺少点击音效；选择按钮默认音效后会自动补齐。`
      : `还有 ${totalMissingButtonSounds} 个 Button 缺少点击音效；请先添加声音配置。`
    if (soundConfig.sounds.length > 0) {
      result.blockers.push(message)
    } else {
      result.warnings.push(message)
    }
  }

  return result
}

// 注入 slice edges 并清理编辑器字段后保存页面
export async function patchAndSavePage(
  projectRoot: FileSystemDirectoryHandle,
  pageData: any,
  sliceMeta: Record<string, { left: number; top: number; right: number; bottom: number }>,
  defaultButtonSoundId: string | null
): Promise<void> {
  patchPageData(pageData, defaultButtonSoundId)
  if (pageData.root) {
    injectSliceEdges(pageData.root, sliceMeta)
    stripEditorFields(pageData.root)
  }
  const pageId = pageData.pageId
  if (!pageId) throw new Error('页面数据缺少 pageId')
  await fs.writeFileJson(projectRoot, `${PAGES_DIR}/${pageId}.json`, pageData)
}

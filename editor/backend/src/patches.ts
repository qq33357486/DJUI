import fs from 'fs'
import path from 'path'

export const SOUND_CONFIG_VERSION = 2
export const PAGE_SCHEMA_VERSION = 4

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

function readJsonFile(file: string): unknown {
  const text = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

function writeJsonFile(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function walkJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const result: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkJsonFiles(fullPath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      result.push(fullPath)
    }
  }
  return result
}

export function getPagesDir(projectPath: string) {
  return path.join(projectPath, 'ui', 'djui', 'pages')
}

export function getSoundsConfigPath(projectPath: string) {
  return path.join(projectPath, 'ui', 'djui', 'sounds.json')
}

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

export function readSoundConfig(projectPath: string): DjuiSoundConfig {
  const file = getSoundsConfigPath(projectPath)
  if (!fs.existsSync(file)) return getDefaultSoundConfig()
  try {
    return sanitizeSoundConfig(readJsonFile(file))
  } catch {
    return getDefaultSoundConfig()
  }
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

  if (!isRecord(page)) return result

  if (page.version !== PAGE_SCHEMA_VERSION) {
    page.version = PAGE_SCHEMA_VERSION
    result.changed = true
  }

  patchNode(page.root, defaultButtonSoundId, result)
  return result
}

function patchSoundConfigFile(projectPath: string, result: PatchRunResult): DjuiSoundConfig {
  const file = getSoundsConfigPath(projectPath)
  if (!fs.existsSync(file)) {
    result.warnings.push('当前工程没有声音配置，请在“声音配置”中添加音效并选择按钮默认音效。')
    return getDefaultSoundConfig()
  }

  let raw: unknown
  try {
    raw = readJsonFile(file)
  } catch {
    result.blockers.push(`声音配置读取失败：${file}`)
    return getDefaultSoundConfig()
  }

  const config = sanitizeSoundConfig(raw)
  if (!jsonEquals(raw, config)) {
    writeJsonFile(file, config)
    result.changed = true
    result.patches.push({
      id: 'sound-config-v2',
      changedFiles: [normalizeSlashes(file)],
      message: `声音配置已升级到 v${SOUND_CONFIG_VERSION}`,
    })
  }

  if (config.sounds.length === 0) {
    result.warnings.push('当前工程没有任何 DJUI 音效配置，Button 暂时不会自动补齐点击音效。')
  } else if (!config.defaultButtonSoundId) {
    result.blockers.push('已配置音效，但尚未选择按钮默认音效。请打开“声音配置”并选择一个适用于 Button 的默认音效。')
  }

  return config
}

export function applyProjectPatches(projectPath: string): PatchRunResult {
  const result: PatchRunResult = {
    ok: true,
    changed: false,
    warnings: [],
    blockers: [],
    patches: [],
  }

  if (!projectPath || !fs.existsSync(projectPath)) {
    return {
      ok: false,
      changed: false,
      warnings: [],
      blockers: ['工程路径无效'],
      patches: [],
    }
  }

  const soundConfig = patchSoundConfigFile(projectPath, result)
  const pagesDir = getPagesDir(projectPath)
  if (!fs.existsSync(pagesDir)) return result

  const migratedAnchorFiles: string[] = []
  const patchedButtonFiles: string[] = []
  let totalMissingButtonSounds = 0

  for (const file of walkJsonFiles(pagesDir)) {
    let page: unknown
    try {
      page = readJsonFile(file)
    } catch {
      result.blockers.push(`页面 JSON 读取失败：${file}`)
      continue
    }

    const pagePatch = patchPageData(page, soundConfig.defaultButtonSoundId)
    totalMissingButtonSounds += pagePatch.missingButtonSounds

    if (pagePatch.changed) {
      writeJsonFile(file, page)
      result.changed = true
      if (pagePatch.migratedAnchors > 0) migratedAnchorFiles.push(normalizeSlashes(file))
      if (pagePatch.patchedButtonSounds > 0) patchedButtonFiles.push(normalizeSlashes(file))
    }
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

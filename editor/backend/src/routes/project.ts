import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import {
  AGENTS_VERSION,
  buildAgentsMd,
  readAgentsVersion,
} from '../agentsTemplate.js'
import { applyProjectPatches } from '../patches.js'

const CONFIG_FILE = 'djui_config.json'

type JsonRecord = Record<string, unknown>

// 工作区内放置工具脚本的子目录名（中文）
const WORKSPACE_SCRIPTS_DIR = '脚本区'

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonFile(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function collectJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const result: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...collectJsonFiles(fullPath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      result.push(fullPath)
    }
  }
  return result
}

function collectClickSoundRefs(node: unknown, refs: Set<string>) {
  if (!isRecord(node)) return
  const djui = node.djui
  if (isRecord(djui) && typeof djui.clickSoundId === 'string' && djui.clickSoundId.trim()) {
    refs.add(djui.clickSoundId.trim())
  }
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) collectClickSoundRefs(child, refs)
  }
}

function buildPublishWarnings(sourcePagesDir: string, sourceSoundsFile: string) {
  const warnings: string[] = []
  const soundIds = new Set<string>()
  let soundCount = 0
  let soundMissingAssetCount = 0

  if (fs.existsSync(sourceSoundsFile)) {
    const soundsConfig = readJsonFile(sourceSoundsFile)
    const sounds = isRecord(soundsConfig) && Array.isArray(soundsConfig.sounds) ? soundsConfig.sounds : []
    for (const item of sounds) {
      if (!isRecord(item)) continue
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!id) continue
      soundIds.add(id)
      soundCount++
      if (typeof item.asset !== 'string' || !item.asset.trim()) {
        soundMissingAssetCount++
      }
    }
  }

  const clickSoundRefs = new Set<string>()
  for (const pageFile of collectJsonFiles(sourcePagesDir)) {
    const page = readJsonFile(pageFile)
    if (isRecord(page)) collectClickSoundRefs(page.root, clickSoundRefs)
  }

  const missingRefs = [...clickSoundRefs].filter(id => !soundIds.has(id))

  if (soundCount > 0 && clickSoundRefs.size === 0) {
    warnings.push(`已发布 ${soundCount} 个音效配置，但当前页面没有任何控件绑定点击音效。请选中控件，在“反馈效果 / 点击音效”里选择。`)
  }
  if (soundMissingAssetCount > 0) {
    warnings.push(`有 ${soundMissingAssetCount} 个音效配置缺少资源路径，运行时会跳过播放。`)
  }
  if (missingRefs.length > 0) {
    warnings.push(`页面引用了 ${missingRefs.length} 个不存在的点击音效：${missingRefs.slice(0, 5).join('、')}${missingRefs.length > 5 ? ' 等' : ''}。`)
  }
  if (!fs.existsSync(sourceSoundsFile) && clickSoundRefs.size > 0) {
    warnings.push('页面已绑定点击音效，但工程里没有 ui/djui/sounds.json，运行时无法解析这些音效。')
  }

  return {
    warnings,
    soundBindingSummary: {
      soundCount,
      boundSoundRefCount: clickSoundRefs.size,
      missingRefCount: missingRefs.length,
    },
  }
}

function resolveInside(base: string, ...segments: string[]): string | null {
  const resolvedBase = path.resolve(base)
  const resolvedTarget = path.resolve(resolvedBase, ...segments)
  const relative = path.relative(resolvedBase, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolvedTarget
}

// DJUI 仓库内 scripts/ 目录路径
function getScriptsSourceDir(): string {
  // 从 cwd 向上找 DJUI 仓库根（含 editor/ + scripts/）
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'scripts')
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'version.txt'))) {
      return candidate
    }
    // 也可能是 editor/backend 作为 cwd
    const editorParent = path.dirname(path.dirname(dir))
    const candidate2 = path.join(editorParent, 'scripts')
    if (fs.existsSync(candidate2) && fs.existsSync(path.join(candidate2, 'version.txt'))) {
      return candidate2
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // 从 import.meta.url 推算：editor/backend/src/ → ../../../scripts
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const fromUrl = path.resolve(__dirname, '../../../scripts')
    if (fs.existsSync(fromUrl) && fs.existsSync(path.join(fromUrl, 'version.txt'))) {
      return fromUrl
    }
  } catch { /* ignore */ }
  return ''
}

// 工程配置存在 backend 目录下（运行时持久化）
function getConfigPath() {
  return path.resolve(process.cwd(), CONFIG_FILE)
}

// DJUI 仓库内 runtime 目录的路径
function getRuntimeSourceDir(): string {
  // 后端工作目录是 editor/backend/，runtime 在仓库根
  // 先从 cwd 向上找
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'runtime')
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'DjuiUiLoader.cs'))) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 退化：尝试从 import.meta.url 推算
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // __dirname = editor/backend/src/
    const fromUrl = path.resolve(__dirname, '../../../runtime')
    if (fs.existsSync(fromUrl)) return fromUrl
  } catch { /* ignore */ }

  return ''
}

// runtime 版本号
const RUNTIME_VERSION = '0.2.1'

// runtime 下的所有 .cs 文件
function listRuntimeFiles(): string[] {
  const srcDir = getRuntimeSourceDir()
  if (!fs.existsSync(srcDir)) return []
  return fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.cs'))
    .map(f => f)
}

function sameFileContent(a: string, b: string): boolean {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b))
  } catch {
    return false
  }
}

export async function registerProjectRoutes(app: FastifyInstance) {
  // 读取配置
  app.get('/api/project/config', async () => {
    const file = getConfigPath()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
    return null
  })

  // 保存配置
  app.post('/api/project/config', async (req) => {
    const config = req.body as Record<string, unknown>
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    return { ok: true }
  })

  app.post('/api/project/apply-patches', async (req) => {
    const { projectPath } = req.body as { projectPath?: string }
    return applyProjectPatches(projectPath ?? '')
  })

  // ===== 目录浏览 =====
  // 列出指定路径下的子目录（用于目录选择器）
  app.get('/api/browse', async (req, reply) => {
    const { dir } = req.query as { dir?: string }
    const startPath = dir || process.cwd()

    if (!fs.existsSync(startPath)) {
      return { current: startPath, dirs: [], error: '路径不存在' }
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(startPath)
    } catch {
      return { current: startPath, dirs: [], error: '无法访问' }
    }

    if (!stat.isDirectory()) {
      return { current: startPath, dirs: [], error: '不是目录' }
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(startPath, { withFileTypes: true })
    } catch {
      return { current: startPath, dirs: [], error: '无权限' }
    }

    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => e.name)
      .sort()

    // 父目录
    const parent = path.dirname(startPath)

    return {
      current: startPath,
      parent: parent !== startPath ? parent : null,
      dirs,
    }
  })

  // 创建目录（新建文件夹）
  app.post('/api/browse/mkdir', async (req) => {
    const { parentPath, name } = req.body as { parentPath: string; name: string }

    if (!parentPath || !name) {
      return { ok: false, error: '参数缺失' }
    }

    // 清理文件名，防止路径穿越
    const safeName = name.replace(/[\\/:*?"<>|]/g, '').trim()
    if (!safeName) {
      return { ok: false, error: '文件夹名无效' }
    }

    const fullPath = path.join(parentPath, safeName)

    if (fs.existsSync(fullPath)) {
      return { ok: false, error: '文件夹已存在' }
    }

    try {
      fs.mkdirSync(fullPath, { recursive: true })
      return { ok: true, path: fullPath }
    } catch {
      return { ok: false, error: '创建失败' }
    }
  })

  // 获取磁盘根（Windows = 盘符列表）
  app.get('/api/browse/roots', async () => {
    const platform = process.platform
    if (platform === 'win32') {
      // 列出可用盘符
      const drives: string[] = []
      for (let c = 67; c <= 90; c++) { // C: to Z:
        const letter = String.fromCharCode(c)
        const drivePath = `${letter}:\\`
        try {
          fs.accessSync(drivePath)
          drives.push(drivePath)
        } catch { /* drive doesn't exist */ }
      }
      return { roots: drives, platform: 'win32' }
    }
    // Unix: 根目录
    return { roots: ['/'], platform }
  })

  // ===== Runtime 检查 =====
  // 检查星火项目中的 DJUI runtime 状态
  app.get('/api/project/check-runtime', async (req) => {
    const { projectPath } = req.query as { projectPath: string }

    if (!projectPath || !fs.existsSync(projectPath)) {
      return { status: 'invalid', message: '工程路径无效' }
    }

    const runtimeDir = path.join(projectPath, 'src', 'DjuiRuntime')
    const versionFile = path.join(runtimeDir, 'djui_version.txt')

    if (!fs.existsSync(runtimeDir)) {
      return {
        status: 'missing',
        message: '工程中未安装 DJUI Runtime',
        expectedVersion: RUNTIME_VERSION,
      }
    }

    // 读取已安装版本
    let installedVersion = 'unknown'
    if (fs.existsSync(versionFile)) {
      installedVersion = fs.readFileSync(versionFile, 'utf-8').trim()
    }

    // 读取已安装文件列表
    const installedFiles = fs.existsSync(runtimeDir)
      ? fs.readdirSync(runtimeDir).filter(f => f.endsWith('.cs'))
      : []

    // 源文件列表
    const sourceFiles = listRuntimeFiles()
    const sourceDir = getRuntimeSourceDir()
    const missingFiles = sourceFiles.filter(f => !installedFiles.includes(f))
    const extraFiles = installedFiles.filter(f => !sourceFiles.includes(f))
    const changedFiles = sourceFiles.filter(f => {
      const src = path.join(sourceDir, f)
      const dst = path.join(runtimeDir, f)
      return fs.existsSync(dst) && !sameFileContent(src, dst)
    })

    if (
      installedVersion === RUNTIME_VERSION &&
      missingFiles.length === 0 &&
      extraFiles.length === 0 &&
      changedFiles.length === 0
    ) {
      return {
        status: 'ok',
        message: 'DJUI Runtime 已是最新版本',
        installedVersion,
        expectedVersion: RUNTIME_VERSION,
        installedDir: runtimeDir,
        installedFiles,
        sourceFiles,
      }
    }

    return {
      status: 'outdated',
      message: `Runtime 需要更新 (${installedVersion} → ${RUNTIME_VERSION})`,
      installedVersion,
      expectedVersion: RUNTIME_VERSION,
      installedDir: runtimeDir,
      installedFiles,
      sourceFiles,
      missingFiles,
      extraFiles,
      changedFiles,
    }
  })

  // ===== Runtime 初始化 / 更新 =====
  // 将 runtime 代码复制到星火工程
  app.post('/api/project/init-runtime', async (req) => {
    const { projectPath } = req.body as { projectPath: string }

    if (!projectPath || !fs.existsSync(projectPath)) {
      return { ok: false, error: '工程路径无效' }
    }

    const sourceDir = getRuntimeSourceDir()
    const targetDir = path.join(projectPath, 'src', 'DjuiRuntime')

    if (!fs.existsSync(sourceDir)) {
      return { ok: false, error: 'DJUI 仓库中 runtime/ 目录不存在' }
    }

    // 创建目标目录
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // 先清理旧的 DJUI 托管 .cs 文件，避免项目侧残留分叉 Runtime。
    for (const file of fs.readdirSync(targetDir).filter(f => f.endsWith('.cs'))) {
      fs.unlinkSync(path.join(targetDir, file))
    }

    // 复制所有 .cs 文件
    const sourceFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.cs'))
    const copied: string[] = []

    for (const file of sourceFiles) {
      const src = path.join(sourceDir, file)
      const dst = path.join(targetDir, file)
      fs.copyFileSync(src, dst)
      copied.push(file)
    }

    // 写版本号文件
    fs.writeFileSync(
      path.join(targetDir, 'djui_version.txt'),
      RUNTIME_VERSION,
      'utf-8'
    )

    // 写 README
    fs.writeFileSync(
      path.join(targetDir, 'README.md'),
      `# DJUI Runtime\n\nVersion: ${RUNTIME_VERSION}\n\nThis directory was auto-created by DJUI Editor.\nDo not edit manually - use DJUI Editor to update.\n`,
      'utf-8'
    )

    return {
      ok: true,
      version: RUNTIME_VERSION,
      targetDir,
      copiedFiles: copied,
    }
  })

  // ===== UI 工作区 =====
  // UI 工作区标准目录结构
  // 原始素材按日期子目录管理（如 原始素材/2026-06-28/xxx/）
  // 成品素材按分类子目录管理（如 成品素材/buttons/, 成品素材/icons/）
  const WORKSPACE_DIRS = [
    '原始素材',
    '成品素材',
    '临时文件',
    '文档',
    '脚本区',
  ]

  // 成品素材分类子目录
  const FINISHED_SUBDIRS = [
    'backgrounds',   // 背景图（全屏背景、面板底图）
    'buttons',        // 按钮（normal/pressed/disabled 状态）
    'frames',         // 边框、对话框底框
    'icons',          // 图标（功能图标、道具图标）
    'lists',          // 列表项、卡片
    'decorations',    // 装饰物（特效、光效、花纹）
    'text',           // 文字相关（艺术字、标题图）
    'misc',           // 未分类
  ]

  function resolvePendingReviewFile(workspacePath: string, relPath: string) {
    const normalized = relPath.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length !== 4 || parts[0] !== '临时文件' || parts[1] !== '待审核') {
      return null
    }

    const [, , cat, fileName] = parts
    if (!FINISHED_SUBDIRS.includes(cat)) return null
    if (path.basename(fileName) !== fileName) return null
    if (!/\.(png|webp|jpg|jpeg)$/i.test(fileName)) return null

    const srcAbs = resolveInside(workspacePath, '临时文件', '待审核', cat, fileName)
    const dstAbs = resolveInside(workspacePath, '成品素材', cat, fileName)
    if (!srcAbs || !dstAbs) return null

    return { cat, fileName, srcAbs, dstAbs }
  }

  // 检查 UI 工作区状态
  app.get('/api/workspace/check', async (req) => {
    const { workspacePath } = req.query as { workspacePath: string }

    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { status: 'invalid', message: '路径无效', dirs: [] }
    }

    const existing = WORKSPACE_DIRS.filter(d =>
      fs.existsSync(path.join(workspacePath, d))
    )
    const hasAgents = fs.existsSync(path.join(workspacePath, 'AGENTS.md'))

    if (existing.length === WORKSPACE_DIRS.length) {
      return {
        status: 'ok',
        message: 'UI 工作区已初始化',
        dirs: existing,
        hasAgents,
      }
    }

    if (existing.length > 0) {
      return {
        status: 'partial',
        message: `工作区不完整（${existing.length}/${WORKSPACE_DIRS.length}）`,
        dirs: existing,
        missing: WORKSPACE_DIRS.filter(d => !existing.includes(d)),
        hasAgents,
      }
    }

    return {
      status: 'empty',
      message: '此目录尚未初始化为 UI 工作区',
      dirs: [],
      missing: WORKSPACE_DIRS,
    }
  })

  // 初始化 UI 工作区
  app.post('/api/workspace/init', async (req) => {
    const { workspacePath } = req.body as { workspacePath: string }

    if (!workspacePath) {
      return { ok: false, error: '请指定工作区路径' }
    }

    // 如果目录不存在则创建
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true })
    }

    const created: string[] = []
    for (const dir of WORKSPACE_DIRS) {
      const dirPath = path.join(workspacePath, dir)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
        created.push(dir)
      }
    }

    // 创建成品素材分类子目录
    for (const subdir of FINISHED_SUBDIRS) {
      const subPath = path.join(workspacePath, '成品素材', subdir)
      if (!fs.existsSync(subPath)) {
        fs.mkdirSync(subPath, { recursive: true })
      }
    }
    // 创建待审核分类子目录
    for (const subdir of FINISHED_SUBDIRS) {
      const subPath = path.join(workspacePath, '临时文件', '待审核', subdir)
      if (!fs.existsSync(subPath)) {
        fs.mkdirSync(subPath, { recursive: true })
      }
    }
    const greenKeyDir = path.join(workspacePath, '临时文件', '去绿幕后')
    if (!fs.existsSync(greenKeyDir)) {
      fs.mkdirSync(greenKeyDir, { recursive: true })
    }

    // 创建今天的原始素材日期目录
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const todayDir = path.join(workspacePath, '原始素材', today)
    if (!fs.existsSync(todayDir)) {
      fs.mkdirSync(todayDir, { recursive: true })
    }

    // 写 AGENTS.md（带版本头）
    const agentsPath = path.join(workspacePath, 'AGENTS.md')
    if (!fs.existsSync(agentsPath)) {
      fs.writeFileSync(agentsPath, buildAgentsMd(), 'utf-8')
    }

    const ensureGitKeep = (dirPath: string) => {
      const keepPath = path.join(dirPath, '.gitkeep')
      if (!fs.existsSync(keepPath)) {
        fs.writeFileSync(keepPath, '', 'utf-8')
      }
    }

    // 写 .gitkeep 到关键空目录（确保空目录能被 git 跟踪）
    for (const subdir of FINISHED_SUBDIRS) {
      ensureGitKeep(path.join(workspacePath, '成品素材', subdir))
      ensureGitKeep(path.join(workspacePath, '临时文件', '待审核', subdir))
    }
    ensureGitKeep(path.join(workspacePath, '原始素材'))
    ensureGitKeep(todayDir)
    ensureGitKeep(path.join(workspacePath, '临时文件'))
    ensureGitKeep(greenKeyDir)
    ensureGitKeep(path.join(workspacePath, '文档'))
    ensureGitKeep(path.join(workspacePath, WORKSPACE_SCRIPTS_DIR))

    return {
      ok: true,
      workspacePath,
      dirs: WORKSPACE_DIRS,
      created,
      message: 'UI 工作区初始化完成',
    }
  })

  // 打包：将成品素材 + 页面 JSON 同步到星火工程
  app.post('/api/workspace/publish', async (req) => {
    const { workspacePath, projectPath } = req.body as {
      workspacePath: string
      projectPath: string
    }

    if (!workspacePath || !projectPath) {
      return { ok: false, error: '请指定工作区和工程路径' }
    }

    const patchResult = applyProjectPatches(projectPath)
    if (!patchResult.ok || patchResult.blockers.length > 0) {
      return {
        ok: false,
        error: patchResult.blockers[0] ?? 'DJUI 数据补丁检查失败',
        patchResult,
      }
    }

    const finishedDir = path.join(workspacePath, '成品素材')
    const sourcePagesDir = path.join(projectPath, 'ui', 'djui', 'pages')
    const sourceSoundsFile = path.join(projectPath, 'ui', 'djui', 'sounds.json')
    const configSrc = path.resolve(process.cwd(), 'djui_config.json')

    const targetImageDir = path.join(projectPath, 'ui', 'image', 'djui')
    const clientDjuiDir = path.join(projectPath, 'ui', 'AppBundle', 'user_files', 'djui')
    const clientPagesDir = path.join(clientDjuiDir, 'pages')
    const clientSoundsPath = path.join(clientDjuiDir, 'sounds.json')
    const serverDjuiDir = path.join(projectPath, 'AppBundle', 'user_files', 'djui')
    const serverPagesDir = path.join(serverDjuiDir, 'pages')
    const serverSoundsPath = path.join(serverDjuiDir, 'sounds.json')
    const clientConfigPath = path.join(clientDjuiDir, 'djui_config.json')

    if (!fs.existsSync(finishedDir)) {
      return { ok: false, error: `成品素材目录不存在：${finishedDir}` }
    }
    if (!fs.existsSync(sourcePagesDir)) {
      return { ok: false, error: `页面源目录不存在：${sourcePagesDir}` }
    }

    function copyDir(src: string, dst: string, baseDir: string, copied: string[]) {
      const entries = fs.readdirSync(src, { withFileTypes: true })
      for (const e of entries) {
        const srcPath = path.join(src, e.name)
        const dstPath = path.join(dst, e.name)
        if (e.isDirectory()) {
          if (!fs.existsSync(dstPath)) fs.mkdirSync(dstPath, { recursive: true })
          copyDir(srcPath, dstPath, baseDir, copied)
        } else {
          if (!fs.existsSync(path.dirname(dstPath))) fs.mkdirSync(path.dirname(dstPath), { recursive: true })
          fs.copyFileSync(srcPath, dstPath)
          copied.push(path.relative(baseDir, dstPath).replace(/\\/g, '/'))
        }
      }
    }

    function mirrorDir(src: string, dst: string) {
      if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true })
      fs.mkdirSync(dst, { recursive: true })
      const copied: string[] = []
      copyDir(src, dst, dst, copied)
      return copied
    }

    if (fs.existsSync(clientDjuiDir)) fs.rmSync(clientDjuiDir, { recursive: true, force: true })
    if (fs.existsSync(serverDjuiDir)) fs.rmSync(serverDjuiDir, { recursive: true, force: true })

    const copiedAssets = mirrorDir(finishedDir, targetImageDir)
    const copiedClientPages = mirrorDir(sourcePagesDir, clientPagesDir)
    const copiedServerPages = mirrorDir(sourcePagesDir, serverPagesDir)

    let copiedSoundsConfig = false
    if (fs.existsSync(sourceSoundsFile)) {
      fs.mkdirSync(clientDjuiDir, { recursive: true })
      fs.mkdirSync(serverDjuiDir, { recursive: true })
      fs.copyFileSync(sourceSoundsFile, clientSoundsPath)
      fs.copyFileSync(sourceSoundsFile, serverSoundsPath)
      copiedSoundsConfig = true
    }

    let copiedConfig = false
    if (fs.existsSync(configSrc)) {
      fs.mkdirSync(clientDjuiDir, { recursive: true })
      fs.copyFileSync(configSrc, clientConfigPath)
      copiedConfig = true
    }

    const publishDiagnostics = buildPublishWarnings(sourcePagesDir, sourceSoundsFile)

    return {
      ok: true,
      copiedAssets,
      copiedPages: copiedClientPages,
      copiedClientPages,
      copiedServerPages,
      copiedSoundsConfig,
      copiedConfig,
      warnings: [...patchResult.warnings, ...publishDiagnostics.warnings],
      soundBindingSummary: publishDiagnostics.soundBindingSummary,
      targetDir: targetImageDir,
      targetDirs: {
        images: targetImageDir,
        clientPages: clientPagesDir,
        clientSounds: clientSoundsPath,
        serverSounds: serverSoundsPath,
        serverPages: serverPagesDir,
        clientConfig: clientConfigPath,
      },
      message: `已同步 ${copiedAssets.length} 个素材、${copiedClientPages.length} 个页面、${copiedSoundsConfig ? 1 : 0} 个音效配置、${copiedConfig ? 1 : 0} 个配置到星火工程`,
    }
  })

  // ===== AGENTS.md 规范更新检查 =====
  // 比较工作区现有 AGENTS.md 顶部版本标记与编辑器内置版本
  app.get('/api/workspace/check-agents', async (req) => {
    const { workspacePath } = req.query as { workspacePath: string }
    const latestVersion = AGENTS_VERSION

    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { status: 'missing', latestVersion, installedVersion: null, message: '工作区路径无效' }
    }

    const agentsPath = path.join(workspacePath, 'AGENTS.md')
    if (!fs.existsSync(agentsPath)) {
      return {
        status: 'missing',
        latestVersion,
        installedVersion: null,
        message: '工作区没有 AGENTS.md',
      }
    }

    let content = ''
    try {
      content = fs.readFileSync(agentsPath, 'utf-8')
    } catch {
      return { status: 'missing', latestVersion, installedVersion: null, message: '读取 AGENTS.md 失败' }
    }

    const installedVersion = readAgentsVersion(content)
    if (!installedVersion) {
      // 老版本文件没有版本标记
      return {
        status: 'outdated',
        latestVersion,
        installedVersion: null,
        message: `AGENTS.md 是旧版本（无版本标记），建议更新到 v${latestVersion}`,
      }
    }

    if (installedVersion === latestVersion) {
      return {
        status: 'ok',
        latestVersion,
        installedVersion,
        message: 'AGENTS.md 已是最新版本',
      }
    }

    return {
      status: 'outdated',
      latestVersion,
      installedVersion,
      message: `AGENTS.md 需要更新（${installedVersion} → ${latestVersion}）`,
    }
  })

  // 把最新 AGENTS.md 模板覆盖写入工作区
  app.post('/api/workspace/update-agents', async (req) => {
    const { workspacePath } = req.body as { workspacePath: string }

    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { ok: false, error: '工作区路径无效' }
    }

    const agentsPath = path.join(workspacePath, 'AGENTS.md')

    // 备份旧文件（如果存在）
    if (fs.existsSync(agentsPath)) {
      const backupPath = path.join(workspacePath, `AGENTS.md.bak`)
      try {
        fs.copyFileSync(agentsPath, backupPath)
      } catch { /* ignore backup failure */ }
    }

    try {
      fs.writeFileSync(agentsPath, buildAgentsMd(), 'utf-8')
      return {
        ok: true,
        version: AGENTS_VERSION,
        message: `AGENTS.md 已更新到 v${AGENTS_VERSION}`,
      }
    } catch (e) {
      return { ok: false, error: `写入失败: ${String(e)}` }
    }
  })

  // ===== 工具脚本（脚本区）同步检查 =====
  // 比较 workspace 脚本区/version.txt 与 DJUI 仓库 scripts/version.txt
  app.get('/api/workspace/check-scripts', async (req) => {
    const { workspacePath } = req.query as { workspacePath: string }
    const sourceDir = getScriptsSourceDir()

    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return { status: 'unavailable', latestVersion: null, installedVersion: null, message: 'DJUI 仓库 scripts/ 不可用（开发模式未挂载）' }
    }

    const sourceVersion = fs.readFileSync(path.join(sourceDir, 'version.txt'), 'utf-8').trim()

    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { status: 'missing', latestVersion: sourceVersion, installedVersion: null, message: '工作区路径无效' }
    }

    const wsScriptsDir = path.join(workspacePath, WORKSPACE_SCRIPTS_DIR)
    const wsVersionFile = path.join(wsScriptsDir, 'version.txt')

    if (!fs.existsSync(wsVersionFile)) {
      return {
        status: 'missing',
        latestVersion: sourceVersion,
        installedVersion: null,
        message: `工作区「${WORKSPACE_SCRIPTS_DIR}」无脚本或无版本号`,
      }
    }

    const installedVersion = fs.readFileSync(wsVersionFile, 'utf-8').trim()

    if (installedVersion === sourceVersion) {
      return {
        status: 'ok',
        latestVersion: sourceVersion,
        installedVersion,
        message: `脚本区已是最新版本 v${sourceVersion}`,
      }
    }

    return {
      status: 'outdated',
      latestVersion: sourceVersion,
      installedVersion,
      message: `脚本区需要更新（${installedVersion} → ${sourceVersion}）`,
    }
  })

  // 把 DJUI scripts/ 同步到 workspace 脚本区/
  app.post('/api/workspace/update-scripts', async (req) => {
    const { workspacePath } = req.body as { workspacePath: string }

    const sourceDir = getScriptsSourceDir()
    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return { ok: false, error: 'DJUI 仓库 scripts/ 不可用' }
    }
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { ok: false, error: '工作区路径无效' }
    }

    const targetDir = path.join(workspacePath, WORKSPACE_SCRIPTS_DIR)

    // 备份旧目录（如果存在且非空）
    if (fs.existsSync(targetDir)) {
      const backupDir = path.join(workspacePath, `${WORKSPACE_SCRIPTS_DIR}.bak`)
      try {
        // 删除旧备份
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true })
        fs.cpSync(targetDir, backupDir, { recursive: true })
      } catch { /* ignore */ }
    }

    // 创建目标目录
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

    // 复制 scripts/ 下所有文件（.py、version.txt、README.md 等），保留子目录
    const copiedFiles: string[] = []
    const copyRecursive = (src: string, dst: string) => {
      const entries = fs.readdirSync(src, { withFileTypes: true })
      for (const e of entries) {
        const srcPath = path.join(src, e.name)
        const dstPath = path.join(dst, e.name)
        if (e.isDirectory()) {
          if (!fs.existsSync(dstPath)) fs.mkdirSync(dstPath, { recursive: true })
          copyRecursive(srcPath, dstPath)
        } else {
          fs.copyFileSync(srcPath, dstPath)
          copiedFiles.push(e.name)
        }
      }
    }
    try {
      copyRecursive(sourceDir, targetDir)
    } catch (e) {
      return { ok: false, error: `复制失败: ${String(e)}` }
    }

    const version = fs.readFileSync(path.join(sourceDir, 'version.txt'), 'utf-8').trim()
    return {
      ok: true,
      version,
      copiedFiles,
      targetDir,
      message: `脚本区已更新到 v${version}（${copiedFiles.length} 个文件）`,
    }
  })

  // ===== 字体列表（从 ref/fontref.txt 读取）=====
  app.get('/api/project/fonts', async (req) => {
    const projectPath = (req.query as any).projectPath as string
    if (!projectPath) return { fonts: [] }
    const fontrefPath = path.join(projectPath, 'ref', 'fontref.txt')
    const fonts: string[] = []
    try {
      if (fs.existsSync(fontrefPath)) {
        const content = fs.readFileSync(fontrefPath, 'utf-8')
        // fontref.txt 格式：每行一个字体族名（可能有注释 # 或路径映射）
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          // 取第一个 token 作为字体族名
          const token = trimmed.split(/\s+/)[0]
          if (token && !fonts.includes(token)) fonts.push(token)
        }
      }
    } catch { /* ignore */ }
    return { fonts }
  })

  // ===== 项目色盘（存储在 workspace/.djui/palette.json）=====
  function getPalettePath(workspacePath: string): string {
    return path.join(workspacePath, '.djui', 'palette.json')
  }

  function readPalette(workspacePath: string): string[] {
    try {
      const p = getPalettePath(workspacePath)
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
        return Array.isArray(data.colors) ? data.colors : []
      }
    } catch { /* ignore */ }
    return []
  }

  function writePalette(workspacePath: string, colors: string[]): void {
    const dir = path.join(workspacePath, '.djui')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(getPalettePath(workspacePath), JSON.stringify({ colors }, null, 2))
  }

  app.get('/api/workspace/palette', async (req) => {
    const workspacePath = (req.query as any).workspacePath as string
    if (!workspacePath) return { colors: [] }
    return { colors: readPalette(workspacePath) }
  })

  app.post('/api/workspace/palette', async (req) => {
    const { workspacePath, color } = req.body as { workspacePath: string; color: string }
    if (!workspacePath || !color) return { ok: false }
    const colors = readPalette(workspacePath)
    if (!colors.includes(color)) {
      colors.push(color)
      writePalette(workspacePath, colors)
    }
    return { ok: true, colors }
  })

  app.delete('/api/workspace/palette', async (req) => {
    const { workspacePath, color } = req.body as { workspacePath: string; color: string }
    if (!workspacePath || !color) return { ok: false }
    const colors = readPalette(workspacePath).filter(c => c !== color)
    writePalette(workspacePath, colors)
    return { ok: true, colors }
  })

  // ===== 素材九宫格元数据 =====
  function getSliceMetaPath(workspacePath: string): string {
    return path.join(workspacePath, '.djui', 'slice-meta.json')
  }
  function readSliceMeta(workspacePath: string): Record<string, { left: number; top: number; right: number; bottom: number }> {
    try {
      const p = getSliceMetaPath(workspacePath)
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
        return typeof data === 'object' && data !== null ? data : {}
      }
    } catch { /* ignore */ }
    return {}
  }
  function writeSliceMeta(workspacePath: string, meta: Record<string, unknown>): void {
    const dir = path.join(workspacePath, '.djui')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(getSliceMetaPath(workspacePath), JSON.stringify(meta, null, 2))
  }

  app.get('/api/slice-meta', async (req) => {
    const workspacePath = (req.query as any).workspacePath as string
    if (!workspacePath) return { meta: {} }
    return { meta: readSliceMeta(workspacePath) }
  })

  app.put('/api/slice-meta', async (req) => {
    const { workspacePath, image, edges } = req.body as {
      workspacePath: string
      image: string
      edges: { left: number; top: number; right: number; bottom: number } | null
    }
    if (!workspacePath || !image) return { ok: false }
    const meta = readSliceMeta(workspacePath)
    if (edges === null) {
      delete meta[image]
    } else {
      meta[image] = edges
    }
    writeSliceMeta(workspacePath, meta)
    return { ok: true, meta }
  })

  // ===== 素材审批 =====

  // 列出待审核素材
  app.get('/api/workspace/pending-review', async (req) => {
    const workspacePath = (req.query as any).workspacePath as string
    if (!workspacePath) return { groups: {} }
    const reviewDir = path.join(workspacePath, '临时文件', '待审核')
    const groups: Record<string, string[]> = {}
    for (const cat of FINISHED_SUBDIRS) {
      const catDir = path.join(reviewDir, cat)
      if (!fs.existsSync(catDir)) continue
      const files = fs.readdirSync(catDir).filter(f => /\.(png|webp|jpg|jpeg)$/i.test(f))
      if (files.length > 0) {
        groups[cat] = files.map(f => `临时文件/待审核/${cat}/${f}`)
      }
    }
    return { groups }
  })

  // 审批通过：移入成品素材
  app.post('/api/workspace/approve', async (req) => {
    const { workspacePath, files } = req.body as { workspacePath: string; files: string[] }
    if (!workspacePath || !files || !Array.isArray(files)) return { ok: false }
    let moved = 0
    const errors: string[] = []
    for (const relPath of files) {
      const reviewFile = resolvePendingReviewFile(workspacePath, relPath)
      if (!reviewFile) { errors.push(relPath); continue }
      try {
        const { srcAbs, dstAbs } = reviewFile
        if (fs.existsSync(srcAbs)) {
          if (!fs.existsSync(path.dirname(dstAbs))) fs.mkdirSync(path.dirname(dstAbs), { recursive: true })
          fs.copyFileSync(srcAbs, dstAbs)
          fs.unlinkSync(srcAbs)
          moved++
        }
      } catch (e) {
        errors.push(`${relPath}: ${String(e)}`)
      }
    }
    return { ok: true, moved, errors }
  })

  // 审批拒绝：删除
  app.post('/api/workspace/reject', async (req) => {
    const { workspacePath, files } = req.body as { workspacePath: string; files: string[] }
    if (!workspacePath || !files || !Array.isArray(files)) return { ok: false }
    let deleted = 0
    const errors: string[] = []
    for (const relPath of files) {
      const reviewFile = resolvePendingReviewFile(workspacePath, relPath)
      if (!reviewFile) { errors.push(relPath); continue }
      try {
        const absPath = reviewFile.srcAbs
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath)
          deleted++
        }
      } catch (e) {
        errors.push(`${relPath}: ${String(e)}`)
      }
    }
    return { ok: true, deleted, errors }
  })
}

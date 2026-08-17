#!/usr/bin/env node
// DJUI 页面本地校验 CLI — 与编辑器 strict 校验(schemaV6.ts)、发布警告同规则。
// 用法: node scripts/validate-pages.mjs <UI工作区或兼容的星火工程根目录>
//   优先校验 .djui/layout/pages/*.json 与 .djui/layout/project.json；
//   未迁移的旧工程回退校验 ui/djui 下的镜像：
//   协议版本/节点结构/锚点(含 safeEdges)/imageFit+sourceSize/响应式覆盖(ID 引用+封闭字段表)/音效引用
//   任何问题以非零码退出,可直接接 CI 或提交前钩子。

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? process.cwd())
const workspaceLayout = path.join(root, '.djui', 'layout')
const usesWorkspaceSource = fs.existsSync(workspaceLayout)
const sourceRoot = usesWorkspaceSource ? workspaceLayout : path.join(root, 'ui', 'djui')
const sourceLabel = usesWorkspaceSource ? '.djui/layout' : 'ui/djui'
const pagesDir = path.join(sourceRoot, 'pages')
const projectFile = path.join(sourceRoot, 'project.json')
const soundsFile = path.join(sourceRoot, 'sounds.json')

const PROTOCOL = 6
const SCHEMA = 1
const OVERRIDE_PATHS = new Set([
  'basic.visible', 'basic.disabled',
  'transform.x', 'transform.y', 'transform.width', 'transform.height',
  'appearance.image', 'appearance.background', 'appearance.imageFit',
  'appearance.focalX', 'appearance.focalY', 'appearance.borderThickness', 'appearance.borderColor',
  'text.text', 'text.fontSize', 'text.textColor', 'text.strokeSize', 'text.strokeColor',
  'text.bold', 'text.font', 'text.textWrap',
  'button.imageHover', 'button.imagePressed', 'progress.value',
])
const STAR_TYPES = ['Panel', 'Button', 'Label', 'Input', 'Progress', 'SpacingPanel', 'PanelScrollable', 'TemplateInstance']
const ANCHOR_TARGETS = ['parent', 'screen', 'safe', 'image']
const ANCHOR_SIDES = ['None', 'TopLeft', 'Top', 'TopRight', 'Left', 'Center', 'Right', 'BottomLeft', 'Bottom', 'BottomRight']
const SAFE_EDGES = new Set(['left', 'top', 'right', 'bottom'])

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

let totalIssues = 0

function fail(file, p, msg) {
  totalIssues++
  console.error(`  ✗ ${file}${p}: ${msg}`)
}

// ===== project.json =====
function validateProject() {
  if (!fs.existsSync(projectFile)) { console.error('  ✗ 缺少 ' + sourceLabel + '/project.json'); totalIssues++; return }
  const raw = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  const f = sourceLabel + '/project.json'
  if (raw.protocolVersion !== PROTOCOL || raw.schemaVersion !== SCHEMA) fail(f, '$.protocolVersion', `必须是 ${PROTOCOL}/${SCHEMA}(当前 ${raw.protocolVersion}/${raw.schemaVersion})`)
  if (raw.orientation !== 'portrait' && raw.orientation !== 'landscape') fail(f, '$.orientation', '必须是 portrait 或 landscape')
  if (!isRecord(raw.canvas)) fail(f, '$.canvas', '缺少 Canvas 配置')
  else {
    if (!isPos(raw.canvas.referenceWidth)) fail(f, '$.canvas.referenceWidth', '必须大于 0')
    if (!isPos(raw.canvas.referenceHeight)) fail(f, '$.canvas.referenceHeight', '必须大于 0')
    if (!['Contain', 'MatchWidth', 'MatchHeight'].includes(String(raw.canvas.mode))) fail(f, '$.canvas.mode', '不支持的 Canvas 模式')
  }
  if (!isRecord(raw.responsive)) fail(f, '$.responsive', '缺少响应式配置')
  else if (!isPos(raw.responsive.wideRatio) || raw.responsive.wideRatio <= 1) fail(f, '$.responsive.wideRatio', '必须大于 1')
}

// ===== 页面节点递归 =====
function validateNode(node, p, file, ids) {
  const id = typeof node.id === 'string' ? node.id.trim() : ''
  if (!id) fail(file, p + '.id', '节点 ID 不能为空')
  else if (ids.has(id)) fail(file, p + '.id', `节点 ID 重复: ${id}`)
  else ids.add(id)
  if (!STAR_TYPES.includes(String(node.starType))) fail(file, p + '.starType', `不支持的控件类型: ${node.starType}`)
  if (isRecord(node.anchor)) {
    const a = node.anchor
    if (!ANCHOR_TARGETS.includes(String(a.target ?? 'parent'))) fail(file, p + '.anchor.target', '必须是 parent、screen 或 safe')
    if (!ANCHOR_SIDES.includes(String(a.side ?? 'TopLeft'))) fail(file, p + '.anchor.side', '不支持的锚点位置')
    if (a.target === 'safe') {
      const edges = a.safeEdges
      if (!Array.isArray(edges) || edges.length === 0) fail(file, p + '.anchor.safeEdges', '安全区锚点至少选择一条边')
      else {
        if (edges.some(e => typeof e !== 'string' || !SAFE_EDGES.has(e))) fail(file, p + '.anchor.safeEdges', '包含非法安全边')
        if (new Set(edges).size !== edges.length) fail(file, p + '.anchor.safeEdges', '安全边不能重复')
      }
    }
  }
  if (isRecord(node.appearance)) {
    const ap = node.appearance
    const fit = ap.imageFit
    if (fit !== undefined && !['stretch', 'contain', 'cover'].includes(String(fit))) fail(file, p + '.appearance.imageFit', '图片铺放方式无效')
    if (fit === 'contain' || fit === 'cover') {
      if (!isRecord(ap.sourceSize)) fail(file, p + '.appearance.sourceSize', 'contain/cover 必须记录素材原始尺寸')
      else {
        if (!isPos(ap.sourceSize.width)) fail(file, p + '.appearance.sourceSize.width', '必须大于 0')
        if (!isPos(ap.sourceSize.height)) fail(file, p + '.appearance.sourceSize.height', '必须大于 0')
      }
    }
    for (const k of ['focalX', 'focalY']) {
      const n = ap[k]
      if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) fail(file, p + '.appearance.' + k, '必须是 0 到 1 的有限数字')
    }
  }
  if (node.sceneFrame !== undefined && node.sceneFrame !== null) {
    if (!isRecord(node.sceneFrame)) fail(file, p + '.sceneFrame', '场景画板必须是对象')
    else {
      if (typeof node.sceneFrame.backgroundId !== 'string' || !node.sceneFrame.backgroundId.trim()) fail(file, p + '.sceneFrame.backgroundId', '必须引用背景节点 ID')
      if (!isRecord(node.sceneFrame.artboard)) fail(file, p + '.sceneFrame.artboard', '缺少场景画板尺寸')
      else {
        if (!isPos(node.sceneFrame.artboard.width)) fail(file, p + '.sceneFrame.artboard.width', '必须大于 0')
        if (!isPos(node.sceneFrame.artboard.height)) fail(file, p + '.sceneFrame.artboard.height', '必须大于 0')
      }
    }
  }
  if (!Array.isArray(node.children)) fail(file, p + '.children', 'children 必须是数组')
  else node.children.forEach((c, i) => {
    if (!isRecord(c)) fail(file, p + `.children[${i}]`, '节点必须是对象')
    else validateNode(c, p + `.children[${i}]`, file, ids)
  })
}

function collectSoundRefs(node, refs) {
  if (!isRecord(node)) return
  if (isRecord(node.djui) && typeof node.djui.clickSoundId === 'string' && node.djui.clickSoundId.trim()) refs.add(node.djui.clickSoundId.trim())
  if (Array.isArray(node.children)) node.children.forEach(c => collectSoundRefs(c, refs))
}

// ===== 页面 =====
function validatePage(file, soundIds) {
  const rel = sourceLabel + '/pages/' + file
  let raw
  try { raw = JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf8')) }
  catch (e) { fail(rel, '$', `JSON 解析失败: ${e.message}`); return }
  if (raw.protocolVersion !== PROTOCOL || raw.schemaVersion !== SCHEMA) {
    fail(rel, '$.protocolVersion', `旧协议或版本不符(当前 ${raw.protocolVersion}/${raw.schemaVersion}),必须显式迁移到 ${PROTOCOL}/${SCHEMA}`)
    return
  }
  if (typeof raw.pageId !== 'string' || !raw.pageId.trim()) fail(rel, '$.pageId', '页面 ID 不能为空')
  if (raw.kind !== 'window' && raw.kind !== 'template') fail(rel, '$.kind', '必须是 window 或 template')
  if (raw.kind === 'window' && !isRecord(raw.window)) fail(rel, '$.window', 'Window 页面缺少 window 配置')
  const ids = new Set()
  if (!isRecord(raw.root) || !Array.isArray(raw.root.children)) fail(rel, '$.root', '缺少结构根或 root.children')
  else {
    validateNode(raw.root, '$.root', rel, ids)
    validateSceneFrames(raw.root, '$.root', rel)
  }
  // 响应式覆盖
  if (raw.responsive !== undefined) {
    if (!isRecord(raw.responsive) || !isRecord(raw.responsive.wide) || !isRecord(raw.responsive.wide.overrides)) {
      fail(rel, '$.responsive', '响应式覆盖必须使用 wide.overrides 结构')
    } else {
      for (const [nodeId, map] of Object.entries(raw.responsive.wide.overrides)) {
        if (!ids.has(nodeId)) fail(rel, `$.responsive.wide.overrides.${nodeId}`, '覆盖引用了不存在的节点 ID')
        if (!isRecord(map)) { fail(rel, `$.responsive.wide.overrides.${nodeId}`, '节点覆盖必须是对象'); continue }
        for (const field of Object.keys(map)) {
          if (!OVERRIDE_PATHS.has(field)) fail(rel, `$.responsive.wide.overrides.${nodeId}.${field}`, '字段不允许被响应式覆盖')
        }
      }
    }
  }
  // 音效引用(与发布警告同源)
  const refs = new Set()
  if (isRecord(raw.root)) collectSoundRefs(raw.root, refs)
  for (const ref of refs) if (!soundIds.has(ref)) fail(rel, '$', `音效引用 ${ref} 在 sounds.json 中不存在`)
}

function validateSceneFrames(root, rootPath, file) {
  const rootChildren = Array.isArray(root.children) ? root.children : []
  const rootById = new Map()
  rootChildren.forEach(child => {
    if (isRecord(child) && typeof child.id === 'string') rootById.set(child.id, child)
  })
  const walk = (node, p, insideScene, isRootChild) => {
    const frame = isRecord(node.sceneFrame) ? node.sceneFrame : null
    const nowInsideScene = insideScene || !!frame
    if (frame) {
      if (!isRootChild) fail(file, p + '.sceneFrame', '场景画板只能放在页面根节点下')
      const backgroundId = typeof frame.backgroundId === 'string' ? frame.backgroundId : ''
      const background = rootById.get(backgroundId)
      if (!background) fail(file, p + '.sceneFrame.backgroundId', '引用的背景必须是页面根下节点')
      else if (!isRecord(background.appearance) || typeof background.appearance.image !== 'string' || !background.appearance.image) fail(file, p + '.sceneFrame.backgroundId', '引用节点必须是带图片的背景')
      if (!isRecord(node.anchor) || node.anchor.target !== 'image') fail(file, p + '.anchor.target', '场景画板容器必须锚定 image 图帧')
      if (!isRecord(node.stretch) || node.stretch.style !== 'Both') fail(file, p + '.stretch.style', '场景画板容器必须使用 Both 拉伸填满图帧')
    } else if (insideScene && isRecord(node.anchor) && node.anchor.target !== undefined && node.anchor.target !== 'parent') {
      fail(file, p + '.anchor.target', '场景画板内节点只能锚定 parent')
    }
    if (Array.isArray(node.children)) node.children.forEach((child, index) => {
      if (isRecord(child)) walk(child, p + '.children[' + index + ']', nowInsideScene, false)
    })
  }
  rootChildren.forEach((child, index) => {
    if (isRecord(child)) walk(child, rootPath + '.children[' + index + ']', false, true)
  })
}

// ===== main =====
console.log(`DJUI 本地校验 — 工程: ${root}`)
validateProject()
const soundIds = new Set()
if (fs.existsSync(soundsFile)) {
  try {
    const sc = JSON.parse(fs.readFileSync(soundsFile, 'utf8'))
    if (Array.isArray(sc.sounds)) sc.sounds.forEach(s => { if (s && typeof s.id === 'string') soundIds.add(s.id) })
  } catch { /* 音效文件损坏由编辑器侧提示,这里不阻塞 */ }
}
if (!fs.existsSync(pagesDir)) { console.error(`✗ 页面目录不存在: ${pagesDir}`); process.exit(1) }
const files = fs.readdirSync(pagesDir).filter(n => n.endsWith('.json')).sort()
for (const f of files) validatePage(f, soundIds)
console.log(`检查 ${files.length} 个页面 + project.json: ${totalIssues === 0 ? '全部通过 ✓' : totalIssues + ' 个问题 ✗'}`)
process.exit(totalIssues === 0 ? 0 : 1)

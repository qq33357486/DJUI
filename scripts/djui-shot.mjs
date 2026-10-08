#!/usr/bin/env node
// djui-shot — AI/命令行一键截图 DJUI 页面
//
// 默认模式（无头直渲染）：自动拉起本机 Chrome/Edge 无头实例加载 DJUI 前端的
// #render 渲染页，页面数据与素材由本脚本起的本地服务直接从工程磁盘读取，
// 出图落盘后关闭浏览器。全程不依赖编辑器是否打开、不依赖浏览器目录授权。
//
// 备用模式（--via-editor）：写请求文件让开着的编辑器处理（适合编辑器常开、
// 想避免起浏览器开销的场景；要求编辑器已打开该工作区并授权目录访问）。
//
// 用法（在 UI 工作区的「脚本区」下运行，或用 --workspace 指定工作区根目录）：
//   node djui-shot.mjs <页面ID> [选项]
// 选项：
//   --scale <n>        导出倍率，默认 1（设计分辨率 1:1），如 --scale 2 高清出图
//   --variant <v>      base（默认）| wide 宽屏响应式变体
//   --out <name>       输出文件名前缀（默认页面ID），始终落在 临时文件/截图/ 下
//   --timeout <sec>    等待出图的超时秒数，默认 60
//   --workspace <p>    UI 工作区根目录（默认：脚本区目录的上一级）
//   --bundle <url>     前端渲染页地址，默认线上 https://ui.duojie.games（本地调试传 http://localhost:7321）
//   --browser <path>   浏览器可执行文件路径（默认自动探测 Chrome/Edge）
//   --via-editor       走编辑器文件通道而非无头直渲染
//
// 输出：成功时 stdout 只打印 PNG 绝对路径（exit 0）；失败时 stderr 给出原因（exit 1/2/3）。
// 需要 Node >= 21（依赖原生 WebSocket 连接浏览器调试端口）。

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_BUNDLE = 'https://ui.duojie.games'
const SHOT_DIR_PARTS = ['临时文件', '截图']
const PAGES_DIR = ['.djui', 'layout', 'pages']
const UNDERLAYS_FILE = ['.djui', 'editor', 'page-underlays.json']
const SLICE_META_FILE = ['.djui', 'slice-meta.json']
const PUBLISH_FILE = ['.djui', 'publish.json']

// ---------- 参数 ----------

function usage(code = 1) {
  const lines = [
    '用法: node djui-shot.mjs <页面ID> [--scale 2] [--variant base|wide] [--out 名字] [--timeout 60]',
    '      [--workspace 工作区路径] [--bundle 前端地址] [--browser 浏览器路径] [--via-editor]',
    '默认无头直渲染（不依赖编辑器）；--via-editor 走编辑器文件通道（需编辑器已打开并授权）。',
  ]
  console.error(lines.join('\n'))
  process.exit(code)
}

function parseArgs(argv) {
  const opt = {
    page: null, scale: 1, variant: 'base', out: null, timeout: 60,
    workspace: null, bundle: DEFAULT_BUNDLE, browser: null, viaEditor: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') usage(0)
    else if (a === '--scale') opt.scale = Number(argv[++i])
    else if (a === '--variant') opt.variant = argv[++i]
    else if (a === '--out') opt.out = argv[++i]
    else if (a === '--timeout') opt.timeout = Number(argv[++i])
    else if (a === '--workspace') opt.workspace = argv[++i]
    else if (a === '--bundle') opt.bundle = argv[++i]
    else if (a === '--browser') opt.browser = argv[++i]
    else if (a === '--via-editor') opt.viaEditor = true
    else if (!a.startsWith('--') && opt.page === null) opt.page = a
    else usage(1)
  }
  if (!opt.page) usage(1)
  if (opt.variant !== 'base' && opt.variant !== 'wide') {
    console.error('--variant 只支持 base 或 wide')
    process.exit(1)
  }
  if (!Number.isFinite(opt.scale) || opt.scale < 0.5 || opt.scale > 3) {
    console.error('--scale 需在 0.5 ~ 3 之间')
    process.exit(1)
  }
  if (!Number.isFinite(opt.timeout) || opt.timeout <= 0) opt.timeout = 60
  opt.bundle = opt.bundle.replace(/\/+$/, '')
  return opt
}

function resolveWorkspace(explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : [path.resolve(__dirname, '..')]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, ...PAGES_DIR)) || fs.existsSync(path.join(dir, '临时文件'))) {
      return dir
    }
  }
  console.error(`无法定位 UI 工作区根目录（尝试过 "${candidates.join('", "')}"）。请用 --workspace 指定，或把本脚本放进工作区的 脚本区/ 目录。`)
  process.exit(1)
}

function sanitizeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'page'
}

function shotOutputPath(wsRoot, opt) {
  const dir = path.join(wsRoot, ...SHOT_DIR_PARTS)
  fs.mkdirSync(dir, { recursive: true })
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const stamp = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return path.join(dir, `${sanitizeFileName(opt.out || opt.page)}_${stamp}_${crypto.randomBytes(2).toString('hex')}.png`)
}

// ---------- 本地数据服务：把工程磁盘文件供给渲染页 ----------

function readStarProjectPath(wsRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(wsRoot, ...PUBLISH_FILE), 'utf8'))
    if (cfg.starProject && fs.existsSync(cfg.starProject)) return cfg.starProject
  } catch { /* 未配置发布目标 → 无字体可用，走系统回退 */ }
  return null
}

function isStandardSfnt(head) {
  if (!head || head.length < 4) return false
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3])
  return magic === 'OTTO' || magic === 'true' || magic === 'ttcf' || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0)
}

// 扫描星火工程字体（对齐编辑器 loadEngineFonts：fontref.txt → family 目录 → 标准 sfnt 文件）
function scanFonts(starRoot) {
  if (!starRoot) return []
  const fontref = path.join(starRoot, 'ref', 'fontref.txt')
  if (!fs.existsSync(fontref)) return []
  const entries = []
  for (const line of fs.readFileSync(fontref, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const family = trimmed.split(/\s+/)[0]
    if (!family) continue
    const dir = path.join(starRoot, ...family.split('/'))
    if (!fs.existsSync(dir)) continue
    const files = []
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(otf|ttf|ttc)$/i.test(f)) continue
      const full = path.join(dir, f)
      let head = null
      try { head = fs.readFileSync(full).subarray(0, 4) } catch { continue }
      if (!isStandardSfnt(head)) continue // 引擎封装格式浏览器无法解析
      files.push({ url: `/fontfile?p=${encodeURIComponent(family + '/' + f)}`, bold: /bold/i.test(f) })
    }
    if (files.length > 0) {
      const last = family.split('/').pop() || family
      entries.push({ family, cssFamily: `djui-${last}`, files })
    }
  }
  return entries
}

function startDataServer(wsRoot, starRoot) {
  const fonts = scanFonts(starRoot)
  const result = { done: false, error: null, data: '' }
  const safeJoin = (root, relPath) => {
    const resolved = path.resolve(root, relPath.replace(/^[/\\]+/, ''))
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
    return resolved
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    // CORS 预检：渲染页与前端 bundle 不同源，POST 回传前会先发 OPTIONS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      })
      res.end()
      return
    }
    const sendJson = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(data))
    }
    const sendFile = (full, mime) => {
      try {
        const data = fs.readFileSync(full)
        res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
        res.end(data)
      } catch {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
        res.end('not found')
      }
    }
    // 渲染页结果回传（大图 base64 走 HTTP，避免 CDP evaluate 大 payload 超时）
    if (url.pathname === '/result' && req.method === 'POST') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (body.error) result.error = String(body.error)
          else result.data = String(body.data || '')
        } catch { result.error = '结果回传解析失败' }
        result.done = true
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' })
        res.end('ok')
      })
      return
    }
    if (url.pathname === '/project.json') {
      return sendFile(safeJoin(wsRoot, path.join('.djui', 'layout', 'project.json')), 'application/json')
    }
    if (url.pathname === '/page') {
      const id = url.searchParams.get('id') || ''
      if (!id || /[\\/]|\.\./.test(id)) return sendJson(400, { error: 'bad page id' })
      const full = safeJoin(wsRoot, path.join(...PAGES_DIR, `${id}.json`))
      if (!full || !fs.existsSync(full)) return sendJson(404, { error: 'page not found' })
      return sendFile(full, 'application/json')
    }
    if (url.pathname === '/asset') {
      const p = url.searchParams.get('path') || ''
      const full = safeJoin(wsRoot, p)
      if (!full) return sendJson(400, { error: 'bad path' })
      const ext = path.extname(full).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'application/octet-stream'
      return sendFile(full, mime)
    }
    if (url.pathname === '/underlays') {
      const full = safeJoin(wsRoot, path.join(...UNDERLAYS_FILE))
      if (!full || !fs.existsSync(full)) return sendJson(200, {})
      try { return sendJson(200, JSON.parse(fs.readFileSync(full, 'utf8')).links ?? {}) } catch { return sendJson(200, {}) }
    }
    if (url.pathname === '/slice-meta') {
      const full = safeJoin(wsRoot, path.join(...SLICE_META_FILE))
      if (!full || !fs.existsSync(full)) return sendJson(200, {})
      try { return sendJson(200, JSON.parse(fs.readFileSync(full, 'utf8'))) } catch { return sendJson(200, {}) }
    }
    if (url.pathname === '/fonts') {
      return sendJson(200, fonts)
    }
    if (url.pathname === '/fontfile') {
      const p = url.searchParams.get('path') || ''
      const full = safeJoin(starRoot || wsRoot, p)
      if (!full || !starRoot) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end('not found') }
      return sendFile(full, 'font/otf')
    }
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
    res.end('not found')
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, fonts: fonts.length, result })))
}

// ---------- 浏览器发现与无头启动 ----------

function findBrowser(explicit) {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit
    console.error(`--browser 指定的浏览器不存在：${explicit}`)
    process.exit(3)
  }
  const locals = process.env.LOCALAPPDATA ? [process.env.LOCALAPPDATA] : []
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ...locals.map(l => path.join(l, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ...locals.map(l => path.join(l, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  console.error('未找到本机 Chrome/Edge。请用 --browser 指定浏览器可执行文件路径（Chromium 内核均可）。')
  process.exit(3)
}

function launchHeadless(browserPath) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'djui-shot-'))
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-timer-throttling', '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ]
  const proc = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let wsUrl = null
    const onData = chunk => {
      const text = chunk.toString()
      const m = text.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f-]+/)
      if (m && !wsUrl) {
        wsUrl = m[0]
        cleanup()
        resolve({ proc, wsUrl, userDataDir })
      }
    }
    const onExit = () => {
      cleanup()
      reject(new Error('浏览器进程提前退出（可能是浏览器版本不支持 --headless=new，或被安全软件拦截）'))
    }
    const timer = setTimeout(() => {
      cleanup()
      try { proc.kill() } catch { /* ignore */ }
      reject(new Error('等待浏览器调试端口超时'))
    }, 15000)
    const cleanup = () => {
      clearTimeout(timer)
      proc.stdout.off('data', onData)
      proc.stderr.off('data', onData)
      proc.off('exit', onExit)
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', onExit)
  })
}

// ---------- 极简 CDP 客户端（原生 WebSocket，零依赖） ----------

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    this.ws = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
      this.ws.onmessage = ev => {
        let msg = null
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve: ok, reject: fail } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) fail(new Error(msg.error.message || String(msg.error)))
          else ok(msg.result)
        } else if (msg.method) {
          const list = this.handlers.get(msg.method)
          if (list) for (const h of list) h(msg.params, msg.sessionId)
        }
      }
    })
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 命令超时：${method}`))
        }
      }, 20000)
    })
  }

  close() {
    try { this.ws?.close() } catch { /* ignore */ }
  }
}

// ---------- 无头直渲染主流程 ----------

async function renderDirect(opt, wsRoot, outPath) {
  if (typeof WebSocket !== 'function') {
    console.error('当前 Node 缺少原生 WebSocket（需要 Node >= 21）。请升级 Node 或改用 --via-editor 模式。')
    process.exit(3)
  }
  const browserPath = findBrowser(opt.browser)
  const starRoot = readStarProjectPath(wsRoot)
  const { server, port, fonts, result } = await startDataServer(wsRoot, starRoot)
  let proc = null
  let cdp = null
  try {
    const launched = await launchHeadless(browserPath)
    proc = launched.proc
    cdp = new Cdp(launched.wsUrl)
    await cdp.connect()

    const hash = `#render?port=${port}&page=${encodeURIComponent(opt.page)}&scale=${opt.scale}&variant=${opt.variant}`
    const target = await cdp.send('Target.createTarget', { url: `${opt.bundle}/${hash}` })
    const session = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
    await cdp.send('Page.enable', {}, session)

    // 结果由渲染页 POST 回本地服务（/result）；这里只轮询服务端状态
    const deadline = Date.now() + opt.timeout * 1000
    while (Date.now() < deadline && !result.done) {
      await new Promise(r => setTimeout(r, 500))
    }
    if (!result.done) {
      throw new Error(`等待出图超时（${opt.timeout}s）。渲染页地址：${opt.bundle}/${hash}。可尝试 --bundle http://localhost:7321 指向本地，或加大 --timeout。`)
    }
    if (result.error) throw new Error(`渲染失败：${result.error}`)
    const dataUrl = result.data
    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('渲染页未返回有效图片数据')
    await fs.promises.writeFile(outPath, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    return { fonts }
  } finally {
    try { if (cdp) await cdp.send('Browser.close').catch(() => {}) } catch { /* ignore */ }
    cdp?.close()
    try { proc?.kill() } catch { /* ignore */ }
    server.close()
  }
}

// ---------- 编辑器文件通道（--via-editor） ----------

const AUTO_DIR_PARTS = ['临时文件', '自动化']
const REQ_NAME = '截图请求.json'
const RESP_NAME = '截图响应.json'

async function renderViaEditor(opt, wsRoot, outPath) {
  const autoDir = path.join(wsRoot, ...AUTO_DIR_PARTS)
  await fs.promises.mkdir(autoDir, { recursive: true })
  const respPath = path.join(autoDir, RESP_NAME)
  const reqPath = path.join(autoDir, REQ_NAME)
  const tmpPath = path.join(autoDir, '截图请求.tmp.json')
  try { await fs.promises.rm(respPath, { force: true }) } catch { /* 忽略 */ }

  const id = crypto.randomBytes(8).toString('hex').slice(0, 8)
  const req = {
    id, action: 'screenshot', page: opt.page, scale: opt.scale,
    variant: opt.variant, out: opt.out ?? undefined, ts: Date.now(),
  }
  await fs.promises.writeFile(tmpPath, JSON.stringify(req, null, 2), 'utf8')
  await fs.promises.rename(tmpPath, reqPath)

  const deadline = Date.now() + opt.timeout * 1000
  let resp = null
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400))
    let text = null
    try { text = await fs.promises.readFile(respPath, 'utf8') } catch { /* 尚未写出 */ }
    if (text === null) continue
    try { resp = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { continue }
    if (!resp || resp.id !== id) { resp = null; continue }
    try { await fs.promises.rm(respPath, { force: true }) } catch { /* 忽略 */ }
    break
  }
  if (!resp) {
    console.error(`等待截图超时（${opt.timeout}s）。请确认：1) DJUI 编辑器已打开；2) 已授权访问该工作区目录。请求文件保留在 ${reqPath}。`)
    process.exit(2)
  }
  if (resp.status !== 'done') {
    console.error(`截图失败：${resp.error ?? '未知错误'}`)
    process.exit(1)
  }
  // 编辑器已按请求出图：把它的产物挪到本命令约定的输出名，保持两种模式输出一致
  const editorPng = path.resolve(wsRoot, resp.file)
  if (fs.existsSync(editorPng)) {
    await fs.promises.rename(editorPng, outPath)
  } else {
    console.error(`编辑器响应成功但找不到产物文件：${editorPng}`)
    process.exit(1)
  }
}

// ---------- 入口 ----------

async function main() {
  const opt = parseArgs(process.argv.slice(2))
  const wsRoot = resolveWorkspace(opt.workspace)
  const outPath = shotOutputPath(wsRoot, opt)
  if (opt.viaEditor) {
    await renderViaEditor(opt, wsRoot, outPath)
  } else {
    const { fonts } = await renderDirect(opt, wsRoot, outPath)
    void fonts
  }
  console.log(outPath)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})

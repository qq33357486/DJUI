#!/usr/bin/env node
// djui-shot — AI/命令行一键截图 DJUI 页面（无需打开浏览器）
//
// 用法（在 UI 工作区的「脚本区」下运行，或用 --workspace 指定工作区根目录）：
//   node djui-shot.mjs <页面ID> [选项]
// 选项：
//   --scale <n>      导出倍率，默认 1（设计分辨率 1:1），如 --scale 2 高清出图
//   --variant <v>    base（默认）| wide 宽屏响应式变体
//   --out <name>     输出文件名前缀（默认页面ID），始终落在 临时文件/截图/ 下
//   --timeout <sec>  等待编辑器响应的超时秒数，默认 120
//   --workspace <p>  UI 工作区根目录（默认：脚本区目录的上一级）
//
// 前提：DJUI 编辑器已打开该工作区且已授权目录访问（渲染在浏览器里完成）。
// 输出：成功时打印 PNG 绝对路径（exit 0）；失败打印原因（exit 1/2）。
//
// 原理：写 临时文件/自动化/截图请求.json → 编辑器轮询发现 → 与主画布同款渲染管线
// 离屏出图 → 写 临时文件/截图/<页面>_<时间>.png → 写 截图响应.json → 本脚本读到响应退出。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function usage(code = 1) {
  const lines = [
    '用法: node djui-shot.mjs <页面ID> [--scale 2] [--variant base|wide] [--out 名字] [--timeout 120] [--workspace 工作区路径]',
    '前提: DJUI 编辑器已打开该工作区并授权目录访问',
  ]
  console.error(lines.join('\n'))
  process.exit(code)
}

function parseArgs(argv) {
  const opt = { page: null, scale: 1, variant: 'base', out: null, timeout: 120, workspace: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') usage(0)
    else if (a === '--scale') opt.scale = Number(argv[++i])
    else if (a === '--variant') opt.variant = argv[++i]
    else if (a === '--out') opt.out = argv[++i]
    else if (a === '--timeout') opt.timeout = Number(argv[++i])
    else if (a === '--workspace') opt.workspace = argv[++i]
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
  if (!Number.isFinite(opt.timeout) || opt.timeout <= 0) opt.timeout = 120
  return opt
}

// 定位工作区根：--workspace 优先，否则取脚本区目录的上一级，并校验特征目录
function resolveWorkspace(explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : [path.resolve(__dirname, '..')]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, '.djui', 'layout', 'pages')) || fs.existsSync(path.join(dir, '临时文件'))) {
      return dir
    }
  }
  const tried = candidates.join('", "')
  console.error(`无法定位 UI 工作区根目录（尝试过 "${tried}"）。请用 --workspace 指定，或把本脚本放进工作区的 脚本区/ 目录。`)
  process.exit(1)
}

const AUTO_DIR_PARTS = ['临时文件', '自动化']
const REQ_NAME = '截图请求.json'
const RESP_NAME = '截图响应.json'

async function pollResponse(wsRoot, id, timeoutMs) {
  const respPath = path.join(wsRoot, ...AUTO_DIR_PARTS, RESP_NAME)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400))
    let text = null
    try { text = await fs.promises.readFile(respPath, 'utf8') } catch { /* 尚未写出 */ }
    if (text === null) continue
    let resp = null
    try { resp = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { continue }
    if (!resp || resp.id !== id) continue
    // id 匹配：消费掉响应文件，避免下次误读
    try { await fs.promises.rm(respPath, { force: true }) } catch { /* 删除失败不影响结果 */ }
    return resp
  }
  return null
}

async function main() {
  const opt = parseArgs(process.argv.slice(2))
  const wsRoot = resolveWorkspace(opt.workspace)
  const autoDir = path.join(wsRoot, ...AUTO_DIR_PARTS)
  await fs.promises.mkdir(autoDir, { recursive: true })

  const respPath = path.join(autoDir, RESP_NAME)
  const reqPath = path.join(autoDir, REQ_NAME)
  const tmpPath = path.join(autoDir, '截图请求.tmp.json')

  // 清掉上一轮遗留响应，防止串号
  try { await fs.promises.rm(respPath, { force: true }) } catch { /* 忽略 */ }

  const id = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  const req = {
    id,
    action: 'screenshot',
    page: opt.page,
    scale: opt.scale,
    variant: opt.variant,
    out: opt.out ?? undefined,
    ts: Date.now(),
  }
  // 先写临时文件再改名，避免编辑器轮询读到半截 JSON
  await fs.promises.writeFile(tmpPath, JSON.stringify(req, null, 2), 'utf8')
  await fs.promises.rename(tmpPath, reqPath)

  const resp = await pollResponse(wsRoot, id, opt.timeout * 1000)
  if (!resp) {
    console.error(`等待截图超时（${opt.timeout}s）。请确认：1) DJUI 编辑器已打开；2) 已授权访问该工作区目录；3) 编辑器左下角无权限提示。请求文件仍保留在 ${reqPath}，编辑器恢复后会自动处理。`)
    process.exit(2)
  }
  if (resp.status !== 'done') {
    console.error(`截图失败：${resp.error ?? '未知错误'}`)
    process.exit(1)
  }
  const absPath = path.resolve(wsRoot, resp.file)
  console.log(absPath)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})

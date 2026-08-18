#!/usr/bin/env node
// 在 UI 工作区执行：node 脚本区/djui-publish.mjs <command> --json
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  PUBLISH_CONFIG_FILE,
  checkRuntimeCore,
  publishCore,
  upgradeRuntimeCore,
  type PublishStore,
  type StoreEntry,
} from '../lib/publishCore'

interface PublishTargetConfig { version: 1; starProjectPath: string }

class NodePublishStore implements PublishStore {
  readonly label: string
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
    this.label = this.root
  }

  private full(path: string): string {
    if (isAbsolute(path)) throw new Error('发布器内部路径不能是绝对路径')
    const target = resolve(this.root, path.replace(/[\\/]/g, sep))
    const rel = relative(this.root, target)
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error(`发布路径越界：${path}`)
    return target
  }

  async fileExists(path: string): Promise<boolean> {
    try { return (await stat(this.full(path))).isFile() } catch { return false }
  }

  async dirExists(path: string): Promise<boolean> {
    try { return (await stat(this.full(path))).isDirectory() } catch { return false }
  }

  async ensureDir(path: string): Promise<void> { await mkdir(this.full(path), { recursive: true }) }

  async listEntries(path: string): Promise<StoreEntry[]> {
    try {
      const entries = await readdir(this.full(path), { withFileTypes: true })
      return entries
        .filter(entry => entry.isFile() || entry.isDirectory())
        .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' as const : 'file' as const }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    } catch { return [] }
  }

  async readText(path: string): Promise<string | null> {
    try { return await readFile(this.full(path), 'utf8') } catch { return null }
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await readFile(this.full(path))) } catch { return null }
  }

  async readJson<T>(path: string): Promise<T | null> {
    const text = await this.readText(path)
    if (text === null) return null
    try { return JSON.parse(text.replace(/^\uFEFF/, '')) as T } catch { return null }
  }

  async writeText(path: string, content: string): Promise<void> {
    const output = this.full(path)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, content, 'utf8')
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    const output = this.full(path)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, content)
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeText(path, JSON.stringify(data, null, 2))
  }

  async remove(path: string, recursive = false): Promise<void> {
    await rm(this.full(path), { recursive, force: true })
  }

  async fileInfo(path: string): Promise<{ size: number; mtime: number } | null> {
    try { const value = await stat(this.full(path)); return value.isFile() ? { size: value.size, mtime: value.mtimeMs } : null } catch { return null }
  }
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : null
}

function output(payload: unknown, asJson: boolean): void {
  if (asJson) console.log(JSON.stringify(payload, null, 2))
  else console.log(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
}

function usage(): string {
  return [
    'DJUI 本地发布器',
    'node 脚本区/djui-publish.mjs configure --star-project <星火工程目录> --json',
    'node 脚本区/djui-publish.mjs status --json',
    'node 脚本区/djui-publish.mjs runtime-status --json',
    'node 脚本区/djui-publish.mjs publish --json',
    'node 脚本区/djui-publish.mjs upgrade-runtime --json',
  ].join('\n')
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'help'
  const asJson = args.includes('--json')
  const workspacePath = optionValue(args, '--workspace') ?? process.cwd()
  const workspace = new NodePublishStore(workspacePath)

  if (command === 'help' || command === '--help' || command === '-h') { output(usage(), asJson); return 0 }
  if (command === 'configure') {
    const starProjectPath = optionValue(args, '--star-project')
    if (!starProjectPath) { output({ ok: false, code: 'MISSING_STAR_PROJECT', error: 'configure 必须提供 --star-project <星火工程目录>' }, asJson); return 2 }
    const absoluteStarPath = resolve(starProjectPath)
    try {
      if (!(await new NodePublishStore(absoluteStarPath).dirExists(''))) throw new Error('目录不存在或无法访问')
      await workspace.writeJson(PUBLISH_CONFIG_FILE, { version: 1, starProjectPath: absoluteStarPath } satisfies PublishTargetConfig)
      output({ ok: true, workspace: resolve(workspacePath), starProjectPath: absoluteStarPath, configFile: PUBLISH_CONFIG_FILE }, asJson)
      return 0
    } catch (error) {
      output({ ok: false, code: 'INVALID_STAR_PROJECT', error: error instanceof Error ? error.message : String(error) }, asJson); return 2
    }
  }

  const config = await workspace.readJson<PublishTargetConfig>(PUBLISH_CONFIG_FILE)
  if (!config || config.version !== 1 || !config.starProjectPath) {
    output({ ok: false, code: 'MISSING_TARGET_CONFIG', error: '尚未配置星火工程目录', userAction: '请向用户索取星火工程目录，然后执行 configure --star-project <路径>。' }, asJson)
    return 10
  }
  const star = new NodePublishStore(config.starProjectPath)
  if (!(await star.dirExists(''))) {
    output({ ok: false, code: 'INVALID_TARGET_CONFIG', error: `星火工程目录无法访问：${config.starProjectPath}`, userAction: '请向用户确认工程目录是否已移动，再重新执行 configure。' }, asJson)
    return 10
  }

  if (command === 'status' || command === 'runtime-status') {
    const runtime = await checkRuntimeCore(star)
    output({ ok: true, workspace: resolve(workspacePath), starProjectPath: config.starProjectPath, runtime }, asJson)
    return runtime.status === 'ok' ? 0 : 20
  }
  if (command === 'upgrade-runtime') {
    output(await upgradeRuntimeCore(star), asJson)
    return 0
  }
  if (command === 'publish') {
    try {
      const result = await publishCore(workspace, star)
      output(result, asJson)
      return result.ok ? 0 : result.code === 'RUNTIME_NOT_READY' ? 20 : 30
    } catch (error) {
      output({ ok: false, code: 'PUBLISH_FAILED', error: error instanceof Error ? error.message : String(error) }, asJson)
      return 40
    }
  }
  output({ ok: false, code: 'UNKNOWN_COMMAND', error: usage() }, asJson)
  return 2
}

main().then(code => { process.exitCode = code }).catch(error => {
  console.log(JSON.stringify({ ok: false, code: 'UNEXPECTED_ERROR', error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exitCode = 40
})

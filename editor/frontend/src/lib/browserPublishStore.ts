import * as fs from '@/fs/fsAccess'
import type { PublishStore, StoreEntry } from './publishCore'

function splitPath(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean)
}

export function createBrowserPublishStore(root: FileSystemDirectoryHandle): PublishStore {
  return {
    label: root.name,
    fileExists: path => fs.fileExists(root, path),
    dirExists: path => fs.dirExists(root, path),
    ensureDir: async path => { await fs.ensureDir(root, path) },
    async listEntries(path: string): Promise<StoreEntry[]> {
      const dir = path ? await fs.getDirHandle(root, path, false) : root
      if (!dir) return []
      const entries: StoreEntry[] = []
      for await (const entry of dir.values()) entries.push({ name: entry.name, kind: entry.kind })
      return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    },
    readText: path => fs.readFileText(root, path),
    async readBytes(path: string): Promise<Uint8Array | null> {
      const data = await fs.readFileArrayBuffer(root, path)
      return data === null ? null : new Uint8Array(data)
    },
    readJson: <T>(path: string) => fs.readFileJson<T>(root, path),
    writeText: (path, content) => fs.writeFileText(root, path, content),
    async writeBytes(path: string, content: Uint8Array): Promise<void> {
      const copy = new Uint8Array(content)
      await fs.writeFileBinary(root, path, copy.buffer as ArrayBuffer)
    },
    writeJson: (path, data) => fs.writeFileJson(root, path, data),
    async remove(path: string, recursive = false): Promise<void> {
      const parts = splitPath(path)
      if (!parts.length) return
      if (recursive) await fs.removeDir(root, path)
      else await fs.removeFile(root, path)
    },
    async fileInfo(path: string): Promise<{ size: number; mtime: number } | null> {
      const handle = await fs.getFileHandle(root, path, false)
      if (!handle) return null
      const file = await handle.getFile()
      return { size: file.size, mtime: file.lastModified }
    },
  }
}

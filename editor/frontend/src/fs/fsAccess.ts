// File System Access API 封装层
// 所有目录/文件操作都通过 FileSystemDirectoryHandle 进行

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.gif', '.bmp']

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase()
  return IMAGE_EXTS.some(ext => lower.endsWith(ext))
}

// 将路径分割为段（处理 / 和 \）
function splitPath(p: string): string[] {
  return p.replace(/\\/g, '/').split('/').filter(Boolean)
}

// 用户选择目录
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('当前浏览器不支持 File System Access API，请使用 Chrome 或 Edge 浏览器')
  }
  return await (window as any).showDirectoryPicker({ mode: 'readwrite' })
}

// 查询权限（无用户手势时可调用）
export async function queryPermission(handle: FileSystemHandle, readWrite = true): Promise<boolean> {
  const opts: any = { mode: readWrite ? 'readwrite' : 'read' }
  if ((handle as any).queryPermission) {
    const result = await (handle as any).queryPermission(opts)
    return result === 'granted'
  }
  return false
}

// 请求权限（必须在用户手势中调用，如按钮点击）
export async function requestPermission(handle: FileSystemHandle, readWrite = true): Promise<boolean> {
  const opts: any = { mode: readWrite ? 'readwrite' : 'read' }
  if ((handle as any).requestPermission) {
    const result = await (handle as any).requestPermission(opts)
    return result === 'granted'
  }
  return false
}

// 递归获取子目录 handle，可选创建
export async function getDirHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemDirectoryHandle | null> {
  const parts = splitPath(path)
  let current = root
  for (const part of parts) {
    try {
      current = await current.getDirectoryHandle(part, { create })
    } catch {
      return null
    }
  }
  return current
}

// 确保目录存在（递归创建），返回 handle
export async function ensureDir(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemDirectoryHandle> {
  const parts = splitPath(path)
  let current = root
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true })
  }
  return current
}

// 获取文件 handle，可选创建
export async function getFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemFileHandle | null> {
  const parts = splitPath(path)
  if (parts.length === 0) return null
  let dir = root
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i], { create })
    } catch {
      return null
    }
  }
  try {
    return await dir.getFileHandle(parts[parts.length - 1], { create })
  } catch {
    return null
  }
}

// 检查文件是否存在
export async function fileExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const handle = await getFileHandle(root, path, false)
  return handle !== null
}

// 检查目录是否存在
export async function dirExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const handle = await getDirHandle(root, path, false)
  return handle !== null
}

// 读取文件文本
export async function readFileText(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  const handle = await getFileHandle(root, path, false)
  if (!handle) return null
  const file = await handle.getFile()
  return await file.text()
}

// 读取文件 JSON
export async function readFileJson<T>(root: FileSystemDirectoryHandle, path: string): Promise<T | null> {
  const text = await readFileText(root, path)
  if (text === null) return null
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T
  } catch {
    return null
  }
}

// 写入文件文本（自动创建父目录）
export async function writeFileText(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string
): Promise<void> {
  const handle = await getFileHandle(root, path, true)
  if (!handle) throw new Error(`无法创建文件: ${path}`)
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

// 写入文件 JSON
export async function writeFileJson(
  root: FileSystemDirectoryHandle,
  path: string,
  data: unknown
): Promise<void> {
  await writeFileText(root, path, JSON.stringify(data, null, 2))
}

// 删除文件
export async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = splitPath(path)
  if (parts.length === 0) return
  let dir = root
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i], { create: false })
    } catch {
      return // 父目录不存在，文件也不存在
    }
  }
  try {
    await dir.removeEntry(parts[parts.length - 1])
  } catch { /* ignore */ }
}

// 递归删除目录
export async function removeDir(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const handle = await getDirHandle(root, path, false)
  if (!handle) return
  const parts = splitPath(path)
  if (parts.length === 0) return
  // 需要从父目录删除
  let parent = root
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      parent = await parent.getDirectoryHandle(parts[i], { create: false })
    } catch {
      return
    }
  }
  try {
    await parent.removeEntry(parts[parts.length - 1], { recursive: true })
  } catch { /* ignore */ }
}

// 列出目录下的子目录和文件
export async function readDirEntries(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<{ dirs: string[]; files: string[] }> {
  const dir = path ? await getDirHandle(root, path, false) : root
  if (!dir) return { dirs: [], files: [] }
  const dirs: string[] = []
  const files: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      dirs.push(entry.name)
    } else if (entry.kind === 'file') {
      files.push(entry.name)
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  files.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return { dirs, files }
}

// 列出目录下的图片文件
export async function readImageEntries(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<{ dirs: string[]; files: string[] }> {
  const dir = path ? await getDirHandle(root, path, false) : root
  if (!dir) return { dirs: [], files: [] }
  const dirs: string[] = []
  const files: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      dirs.push(entry.name)
    } else if (entry.kind === 'file' && isImageFile(entry.name)) {
      files.push(entry.name)
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  files.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return { dirs, files }
}

// 递归遍历所有文件，返回相对路径列表
export async function walkFiles(
  root: FileSystemDirectoryHandle,
  basePath = '',
  extFilter?: string[]
): Promise<string[]> {
  const result: string[] = []
  for await (const entry of root.values()) {
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      const subDir = await root.getDirectoryHandle(entry.name)
      result.push(...await walkFiles(subDir, fullPath, extFilter))
    } else if (entry.kind === 'file') {
      if (!extFilter || extFilter.some(ext => entry.name.toLowerCase().endsWith(ext))) {
        result.push(fullPath)
      }
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

// 递归遍历 JSON 文件
export async function walkJsonFiles(
  root: FileSystemDirectoryHandle,
  basePath = ''
): Promise<string[]> {
  return walkFiles(root, basePath, ['.json'])
}

// 读取图片为 Blob
export async function readImageBlob(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<Blob | null> {
  const handle = await getFileHandle(root, path, false)
  if (!handle) return null
  const file = await handle.getFile()
  return file
}

// 创建图片 Blob URL（带缓存）
const blobUrlCache = new Map<string, string>()

export async function getImageBlobUrl(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<string | null> {
  const cacheKey = `${root.name}/${path}`
  if (blobUrlCache.has(cacheKey)) {
    return blobUrlCache.get(cacheKey)!
  }
  const blob = await readImageBlob(root, path)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  blobUrlCache.set(cacheKey, url)
  return url
}

// 清理 Blob URL 缓存
export function clearBlobUrlCache(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url)
  }
  blobUrlCache.clear()
}

// 复制单个文件
export async function copyFile(
  srcRoot: FileSystemDirectoryHandle,
  srcPath: string,
  dstRoot: FileSystemDirectoryHandle,
  dstPath: string
): Promise<void> {
  const text = await readFileText(srcRoot, srcPath)
  if (text === null) throw new Error(`源文件不存在: ${srcPath}`)
  await writeFileText(dstRoot, dstPath, text)
}

// 复制单个文件（二进制安全）
export async function copyFileBinary(
  srcRoot: FileSystemDirectoryHandle,
  srcPath: string,
  dstRoot: FileSystemDirectoryHandle,
  dstPath: string
): Promise<void> {
  const handle = await getFileHandle(srcRoot, srcPath, false)
  if (!handle) throw new Error(`源文件不存在: ${srcPath}`)
  const file = await handle.getFile()
  const dstHandle = await getFileHandle(dstRoot, dstPath, true)
  if (!dstHandle) throw new Error(`无法创建目标文件: ${dstPath}`)
  const writable = await dstHandle.createWritable()
  const buffer = await file.arrayBuffer()
  await writable.write(buffer)
  await writable.close()
}

// 镜像目录：先清空目标，再递归复制源目录所有内容到目标
// 返回复制的文件数
export async function mirrorDir(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle
): Promise<number> {
  // 清空目标目录现有内容
  for await (const entry of dst.values()) {
    await dst.removeEntry(entry.name, { recursive: true })
  }
  // 递归复制
  return await copyDirRecursive(src, dst)
}

async function copyDirRecursive(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle
): Promise<number> {
  let count = 0
  for await (const entry of src.values()) {
    if (entry.kind === 'file') {
      const srcFile = await src.getFileHandle(entry.name)
      const dstFile = await dst.getFileHandle(entry.name, { create: true })
      const file = await srcFile.getFile()
      const writable = await dstFile.createWritable()
      const buffer = await file.arrayBuffer()
      await writable.write(buffer)
      await writable.close()
      count++
    } else if (entry.kind === 'directory') {
      const srcDir = await src.getDirectoryHandle(entry.name)
      const dstDir = await dst.getDirectoryHandle(entry.name, { create: true })
      count += await copyDirRecursive(srcDir, dstDir)
    }
  }
  return count
}

// 写入 .gitkeep 文件到目录
export async function writeGitKeep(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<void> {
  await writeFileText(root, `${path}/.gitkeep`, '')
}

// IndexedDB 持久化 DirectoryHandle
const DB_NAME = 'djui-fs'
const STORE_NAME = 'handles'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => { db.close(); resolve(req.result ?? null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function clearHandles(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

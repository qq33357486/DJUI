/// <reference types="vite/client" />

// package.json 导入（读取版本号）
declare module '*.json' {
  const value: any
  export default value
}

// Vite ?raw 导入声明
declare module '*?raw' {
  const content: string
  export default content
}

// File System Access API 类型声明（Chrome/Edge）
// TypeScript DOM 库可能不包含这些类型，这里手动声明

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
}

interface FileSystemDirectoryHandleAsyncIterator {
  next(): Promise<{ done: false; value: [string, FileSystemHandle] } | { done: true; value: undefined }>
}

interface FileSystemDirectoryHandleAsyncIterable {
  [Symbol.asyncIterator](): FileSystemDirectoryHandleAsyncIterator
}

interface FileSystemDirectoryHandleIterable {
  entries(): FileSystemDirectoryHandleAsyncIterator
  keys(): AsyncIterableIterator<string>
  values(): AsyncIterableIterator<FileSystemHandle>
  [Symbol.asyncIterator](): FileSystemDirectoryHandleAsyncIterator
}

interface FileSystemDirectoryHandle extends FileSystemHandle, FileSystemDirectoryHandleIterable {
  kind: 'directory'
  name: string
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
}

interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>
  seek(position: number): Promise<void>
  truncate(size: number): Promise<void>
}

interface Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?: (options?: any) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: any) => Promise<FileSystemFileHandle>
}

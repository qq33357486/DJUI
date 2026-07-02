// React hook：异步加载图片 Blob URL
// 替代原有的同步 api.assetFileUrl / api.enginePathToUrl

import { useState, useEffect } from 'react'
import { projectContext } from '@/fs/projectContext'
import * as fs from '@/fs/fsAccess'
import * as api from '@/api/client'

const loadingUrls = new Set<string>()
const urlCache = new Map<string, string | null>()
const subscribers = new Map<string, Set<() => void>>()

function notify(key: string) {
  const subs = subscribers.get(key)
  if (subs) {
    for (const cb of subs) cb()
  }
}

function subscribe(key: string, cb: () => void) {
  if (!subscribers.has(key)) subscribers.set(key, new Set())
  subscribers.get(key)!.add(cb)
  return () => {
    subscribers.get(key)?.delete(cb)
  }
}

// 从工作区素材路径加载
export function useAssetImage(relPath: string | null): string | null {
  const key = `asset:${relPath}`
  const [url, setUrl] = useState<string | null>(urlCache.get(key) ?? null)

  useEffect(() => {
    if (!relPath) { setUrl(null); return }
    const current = urlCache.get(key)
    if (current !== undefined) {
      setUrl(current)
      return
    }

    let cancelled = false
    const cb = () => {
      if (!cancelled) setUrl(urlCache.get(key) ?? null)
    }
    const unsub = subscribe(key, cb)

    if (!loadingUrls.has(key)) {
      loadingUrls.add(key)
      api.assetFileUrl(relPath).then(result => {
        urlCache.set(key, result)
        loadingUrls.delete(key)
        notify(key)
      }).catch(() => {
        urlCache.set(key, null)
        loadingUrls.delete(key)
        notify(key)
      })
    }

    return () => { cancelled = true; unsub() }
  }, [key, relPath])

  return url
}

// 从引擎路径加载（先试工作区成品素材，再试工程 ui/image/djui）
export function useEngineImage(enginePath: string | null): string | null {
  const key = `engine:${enginePath}`
  const [url, setUrl] = useState<string | null>(urlCache.get(key) ?? null)

  useEffect(() => {
    if (!enginePath) { setUrl(null); return }
    const current = urlCache.get(key)
    if (current !== undefined) {
      setUrl(current)
      return
    }

    let cancelled = false
    const cb = () => {
      if (!cancelled) setUrl(urlCache.get(key) ?? null)
    }
    const unsub = subscribe(key, cb)

    if (!loadingUrls.has(key)) {
      loadingUrls.add(key)
      api.enginePathToUrl(enginePath).then(result => {
        urlCache.set(key, result)
        loadingUrls.delete(key)
        notify(key)
      }).catch(() => {
        urlCache.set(key, null)
        loadingUrls.delete(key)
        notify(key)
      })
    }

    return () => { cancelled = true; unsub() }
  }, [key, enginePath])

  return url
}

// 从工作区任意路径加载图片（用于 ReviewPanel 等需要绝对路径的场景）
export function useWorkspaceImage(fullPath: string | null): string | null {
  const key = `ws:${fullPath}`
  const [url, setUrl] = useState<string | null>(urlCache.get(key) ?? null)

  useEffect(() => {
    if (!fullPath) { setUrl(null); return }
    const current = urlCache.get(key)
    if (current !== undefined) {
      setUrl(current)
      return
    }

    let cancelled = false
    const cb = () => {
      if (!cancelled) setUrl(urlCache.get(key) ?? null)
    }
    const unsub = subscribe(key, cb)

    if (!loadingUrls.has(key)) {
      loadingUrls.add(key)
      const ws = projectContext.ws
      if (!ws) {
        urlCache.set(key, null)
        loadingUrls.delete(key)
        notify(key)
      } else {
        fs.getImageBlobUrl(ws, fullPath).then(result => {
          urlCache.set(key, result)
          loadingUrls.delete(key)
          notify(key)
        }).catch(() => {
          urlCache.set(key, null)
          loadingUrls.delete(key)
          notify(key)
        })
      }
    }

    return () => { cancelled = true; unsub() }
  }, [key, fullPath])

  return url
}

// 清理缓存（切换工程时调用）
export function clearImageCache(): void {
  urlCache.clear()
  loadingUrls.clear()
}

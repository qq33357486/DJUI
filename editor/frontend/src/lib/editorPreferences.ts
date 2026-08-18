// 画布显示偏好属于当前浏览器的编辑器体验，不进入页面协议或 Runtime。
const OVERLAY_VISIBLE_KEY = 'djui.canvas.editorOverlayVisible'
const REFERENCE_VISIBLE_KEY_PREFIX = 'djui.canvas.referenceVisible.'

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // 隐私模式或被禁用的存储不应影响正常编辑。
  }
}

export function getEditorOverlayVisible(): boolean {
  return readBoolean(OVERLAY_VISIBLE_KEY, true)
}

export function setEditorOverlayVisible(visible: boolean): void {
  writeBoolean(OVERLAY_VISIBLE_KEY, visible)
}

function referenceVisibleKey(workspaceName: string | undefined, pageId: string): string {
  return `${REFERENCE_VISIBLE_KEY_PREFIX}${encodeURIComponent(workspaceName ?? 'default')}.${encodeURIComponent(pageId)}`
}

export function getReferenceImageVisible(workspaceName: string | undefined, pageId: string): boolean {
  return readBoolean(referenceVisibleKey(workspaceName, pageId), true)
}

export function setReferenceImageVisible(workspaceName: string | undefined, pageId: string, visible: boolean): void {
  writeBoolean(referenceVisibleKey(workspaceName, pageId), visible)
}

// 字体加载桥：把星火工程的字体文件注册到浏览器，使画布能渲染引擎实际字体。
//
// 引擎的字体值是「资源 family 路径」（如 ui/font/regular），运行时由引擎预加载
// 对应 .otf/.ttf 渲染。编辑器画布（Konva/Canvas）只认浏览器已注册的 CSS font-family，
// 而 CSS family 名不能含 '/'。所以这里做一层映射：
//   引擎 family "ui/font/regular"  ↔  CSS family "djui-regular"
// 渲染时（CanvasArea / RightPanel）通过 engineFontToCss() 把引擎 family 转成 CSS family。

import * as fs from '@/fs/fsAccess'
import { projectContext } from '@/fs/projectContext'

// 引擎 family → CSS family 映射表（注册后填充）
const fontMap = new Map<string, string>()
// 已注册的 CSS family 集合（去重）
const registered = new Set<string>()

// 引擎 family（如 "ui/font/regular"）转 CSS family（如 "djui-regular"）
// 未注册的 family 返回 undefined（调用方回退到默认字体）
export function engineFontToCss(engineFamily: string | null | undefined): string | undefined {
  if (!engineFamily) return undefined
  return fontMap.get(engineFamily)
}

// 已注册的所有 CSS family（供调试/检查）
export function getRegisteredCssFonts(): string[] {
  return Array.from(registered)
}

// 把引擎 family 路径转成合法 CSS family 名
// "ui/font/regular" → "djui-regular"；"font/myfont" → "djui-myfont"
function toCssFamily(engineFamily: string): string {
  const segs = engineFamily.split('/')
  const last = segs[segs.length - 1] || engineFamily
  return `djui-${last}`
}

// 加载并注册工程的所有字体到浏览器。
// 返回成功注册的 family 数量。幂等（重复调用只注册新增的）。
export async function loadEngineFonts(): Promise<number> {
  const star = projectContext.star
  if (!star) return 0

  // 1. 读 fontref.txt 拿 family 列表
  const text = await fs.readFileText(star, 'ref/fontref.txt')
  if (!text) return 0

  const families: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const name = trimmed.split(/\s+/)[0]
    if (name) families.push(name)
  }

  let count = 0
  for (const family of families) {
    // 已注册则跳过
    if (fontMap.has(family)) { count++; continue }

    // 2. 解析 family 路径，读对应目录下的字体文件
    //    family 形如 "ui/font/regular" → 目录 "ui/font/regular"
    //    family 形如 "font/myfont" → 目录 "font/myfont"（项目私有，编辑器从 star 工程读）
    const cssFamily = toCssFamily(family)
    const registeredHere = await registerFamilyDir(star, family, cssFamily)
    if (registeredHere) {
      fontMap.set(family, cssFamily)
      registered.add(cssFamily)
      count++
    }
  }
  return count
}

// 注册单个 family 目录下的所有 .otf/.ttf 文件
async function registerFamilyDir(
  root: FileSystemDirectoryHandle,
  familyPath: string,
  cssFamily: string
): Promise<boolean> {
  let entries: { dirs: string[]; files: string[] }
  try {
    entries = await fs.readDirEntries(root, familyPath)
  } catch {
    return false  // 目录不存在（fontref.txt 列了但磁盘没有）→ 跳过
  }
  const fontFiles = entries.files.filter(f => /\.(otf|ttf|ttc)$/i.test(f))
  if (fontFiles.length === 0) return false

  let anyOk = false
  for (const file of fontFiles) {
    const fullPath = `${familyPath}/${file}`
    const buf = await fs.readFileArrayBuffer(root, fullPath)
    if (!buf) continue
    // 粗体识别：文件名含 bold（如 regularbold.otf）
    const isBold = /bold/i.test(file)
    try {
      const face = new FontFace(cssFamily, buf, isBold ? { weight: 'bold' } : {})
      await face.load()
      ;(document as any).fonts?.add(face)
      anyOk = true
    } catch {
      // 单个文件加载失败（格式损坏等）→ 跳过该文件，继续其它
    }
  }
  return anyOk
}

// 重置（切换工程时调用，清空映射以便重新注册新工程的字体）
export function resetFontRegistry(): void {
  fontMap.clear()
  registered.clear()
}

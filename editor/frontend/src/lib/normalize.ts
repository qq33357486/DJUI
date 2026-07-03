// 数据归一化层：将任意 unknown JSON 安全转换为结构完整的 UiPage
//
// 这是磁盘 JSON 进入运行时的唯一关卡。
// 核心原则：宽容输入，严格输出，不抛异常。
//
// 与 patches.ts 的关系：
//   normalizePage  → 结构完整性（children、id、必填字段存在）
//   patchPageData  → 语义迁移（锚点格式升级、音效补齐）
// 两者独立，各管各的事。

import { UiNode, UiPage, StarType } from '@/types/layout'

const VALID_STAR_TYPES: readonly StarType[] = [
  'Panel', 'Button', 'Label', 'Input', 'Progress',
  'SpacingPanel', 'PanelScrollable', 'TemplateInstance',
]

let fallbackIdCounter = 0
function generateFallbackId(): string {
  return `_fallback_${Date.now()}_${++fallbackIdCounter}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 递归归一化单个节点，确保结构完整
export function normalizeNode(raw: unknown): UiNode {
  if (!isRecord(raw)) {
    return { id: generateFallbackId(), starType: 'Panel', name: '(已修复)', children: [] }
  }

  // id：必须有
  const id = typeof raw.id === 'string' && raw.id ? raw.id : generateFallbackId()

  // starType：必须是合法值，否则回退到 Panel
  const rawStarType = typeof raw.starType === 'string' ? raw.starType : ''
  const starType: StarType = (VALID_STAR_TYPES as readonly string[]).includes(rawStarType)
    ? (rawStarType as StarType)
    : 'Panel'

  // children：必须是数组，递归归一化
  let children: UiNode[]
  if (Array.isArray(raw.children)) {
    children = raw.children.map(normalizeNode)
  } else {
    children = []
  }

  // 组装安全节点，保留所有已知可选字段的原值（不做类型强制转换，只兜底缺失）
  const node: UiNode = {
    id,
    starType,
    children,
  }

  // 保留可选字段（只要原值是 object 就透传，渲染层各自兜底）
  if (typeof raw.name === 'string') node.name = raw.name
  if (isRecord(raw.basic)) node.basic = raw.basic as UiNode['basic']
  if (isRecord(raw.transform)) node.transform = raw.transform as UiNode['transform']
  if (isRecord(raw.appearance)) node.appearance = raw.appearance as UiNode['appearance']
  if (isRecord(raw.layout)) node.layout = raw.layout as UiNode['layout']
  if (isRecord(raw.interaction)) node.interaction = raw.interaction as UiNode['interaction']
  if (isRecord(raw.effects)) node.effects = raw.effects as UiNode['effects']
  if (isRecord(raw.text)) node.text = raw.text as UiNode['text']
  if (isRecord(raw.button)) node.button = raw.button as UiNode['button']
  if (raw.progress !== undefined) node.progress = raw.progress as UiNode['progress']
  if (raw.anchor !== undefined && raw.anchor !== null) node.anchor = raw.anchor as UiNode['anchor']
  if (raw.stretch !== undefined && raw.stretch !== null) node.stretch = raw.stretch as UiNode['stretch']
  if (raw.aspectRatio !== undefined && raw.aspectRatio !== null) node.aspectRatio = raw.aspectRatio as UiNode['aspectRatio']
  if (typeof raw.templateRef === 'string' || raw.templateRef === null) node.templateRef = raw.templateRef as string | null
  if (raw.templateOverrides !== undefined) node.templateOverrides = raw.templateOverrides as UiNode['templateOverrides']
  if (typeof raw.widthStretchRatio === 'number' || raw.widthStretchRatio === null) node.widthStretchRatio = raw.widthStretchRatio as number | null
  if (typeof raw.heightStretchRatio === 'number' || raw.heightStretchRatio === null) node.heightStretchRatio = raw.heightStretchRatio as number | null
  if (typeof raw.widthCompactRatio === 'number' || raw.widthCompactRatio === null) node.widthCompactRatio = raw.widthCompactRatio as number | null
  if (typeof raw.heightCompactRatio === 'number' || raw.heightCompactRatio === null) node.heightCompactRatio = raw.heightCompactRatio as number | null
  if (isRecord(raw.djui)) node.djui = raw.djui as UiNode['djui']
  if (typeof raw.editorLocked === 'boolean') node.editorLocked = raw.editorLocked
  if (typeof raw.editorHidden === 'boolean') node.editorHidden = raw.editorHidden

  return node
}

// 页面级归一化：unknown → 结构安全的 UiPage | null
export function normalizePage(raw: unknown): UiPage | null {
  if (!isRecord(raw)) return null

  // root 是最关键的字段，必须存在且归一化
  const root = normalizeNode(raw.root)

  const version = typeof raw.version === 'number' ? raw.version : 5

  const pageId = typeof raw.pageId === 'string' && raw.pageId ? raw.pageId : 'unknown'

  const designWidth = typeof raw.designWidth === 'number' && raw.designWidth > 0 ? raw.designWidth : 1080
  const designHeight = typeof raw.designHeight === 'number' && raw.designHeight > 0 ? raw.designHeight : 1920

  const nodeKind = raw.nodeKind === 'template' ? 'template' : 'window'

  const page: UiPage = {
    version,
    pageId,
    designWidth,
    designHeight,
    root,
    nodeKind,
  }

  // 可选字段透传
  if (typeof raw.referenceImage === 'string' || raw.referenceImage === null) {
    page.referenceImage = raw.referenceImage as string | null
  }
  if (typeof raw.referenceOpacity === 'number') page.referenceOpacity = raw.referenceOpacity
  if (typeof raw.referenceVisible === 'boolean') page.referenceVisible = raw.referenceVisible
  if (raw.windowMode !== undefined) page.windowMode = raw.windowMode as UiPage['windowMode']
  if (raw.transition !== undefined) page.transition = raw.transition as UiPage['transition']

  return page
}

// 检测归一化是否修改了数据（用于决定是否需要持久化修复）
export function normalizeDetectChanges(raw: unknown): boolean {
  if (!isRecord(raw)) return true

  // 检查 root
  if (!isRecord(raw.root)) return true

  // 递归检查节点树
  return detectNodeChanges(raw.root)
}

function detectNodeChanges(raw: unknown): boolean {
  if (!isRecord(raw)) return true

  // id 缺失
  if (typeof raw.id !== 'string' || !raw.id) return true

  // starType 不合法
  const rawStarType = typeof raw.starType === 'string' ? raw.starType : ''
  if (!(VALID_STAR_TYPES as readonly string[]).includes(rawStarType)) return true

  // children 缺失或非数组
  if (!Array.isArray(raw.children)) return true

  // 递归检查子节点
  return raw.children.some(detectNodeChanges)
}

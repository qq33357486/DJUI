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

// layout 排列字段的枚举白名单（结构归一化用；旧值语义迁移如 spacing 单值→二元组在 patches.ts，职责不混）
const LAYOUT_FLOW_ORIENTATIONS: readonly string[] = ['None', 'Horizontal', 'Vertical', 'Grid']
const LAYOUT_GRID_FLOWS: readonly string[] = ['Horizontal', 'Vertical']
const LAYOUT_CHILD_ORDERS: readonly string[] = ['Default', 'ByName']

function isEnumString(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value)
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
  if (isRecord(raw.transform)) {
    // 深拷贝 transform，兜底 opacity 范围到 0-1
    const t = { ...raw.transform } as Record<string, unknown>
    if (typeof t.opacity === 'number') {
      t.opacity = Math.max(0, Math.min(1, t.opacity))
    }
    node.transform = t as UiNode['transform']
  }
  if (isRecord(raw.appearance)) node.appearance = raw.appearance as UiNode['appearance']
  if (isRecord(raw.layout)) {
    // 浅拷贝后对排列字段做类型兜底（已有字段 padding/margin/autoSize/对齐保持原透传行为不变，避免存量回归）
    const l = { ...raw.layout } as Record<string, unknown>
    if (l.flowOrientation !== undefined && l.flowOrientation !== null && !isEnumString(l.flowOrientation, LAYOUT_FLOW_ORIENTATIONS)) delete l.flowOrientation
    // spacing 必须为 [number, number] 二元组（=[水平间距, 垂直间距]）；正常链路旧单值已在迁移层转好，
    // 丢弃非法结构是 normalize 的终极防御（语义迁移不在此做）
    if (l.spacing !== undefined && l.spacing !== null) {
      const sp = l.spacing
      const isTuple = Array.isArray(sp) && sp.length === 2 && typeof sp[0] === 'number' && typeof sp[1] === 'number'
      if (!isTuple) l.spacing = null
    }
    if (l.gridFlow !== undefined && l.gridFlow !== null && !isEnumString(l.gridFlow, LAYOUT_GRID_FLOWS)) delete l.gridFlow
    // gridCount 字段语义为正整数：非整数（如 0.5）属类型不符，会让 C# int? 反序列化炸掉，防线必须落在数据边界；
    // 值域 ≥1 的钳制由排列算法负责，normalize 只管类型
    if (l.gridCount !== undefined && l.gridCount !== null && !(typeof l.gridCount === 'number' && Number.isInteger(l.gridCount))) delete l.gridCount
    if (l.childOrder !== undefined && l.childOrder !== null && !isEnumString(l.childOrder, LAYOUT_CHILD_ORDERS)) delete l.childOrder
    if (l.autoRelayout !== undefined && l.autoRelayout !== null && typeof l.autoRelayout !== 'boolean') delete l.autoRelayout
    node.layout = l as UiNode['layout']
  }
  if (isRecord(raw.interaction)) node.interaction = raw.interaction as UiNode['interaction']
  if (isRecord(raw.effects)) node.effects = raw.effects as UiNode['effects']
  if (isRecord(raw.text)) node.text = raw.text as UiNode['text']
  if (isRecord(raw.button)) node.button = raw.button as UiNode['button']
  if (raw.progress !== undefined) node.progress = raw.progress as UiNode['progress']
  if (raw.anchor !== undefined && raw.anchor !== null) node.anchor = raw.anchor as UiNode['anchor']
  if (raw.stretch !== undefined && raw.stretch !== null) node.stretch = raw.stretch as UiNode['stretch']
  if (raw.aspectRatio !== undefined && raw.aspectRatio !== null) node.aspectRatio = raw.aspectRatio as UiNode['aspectRatio']
  if (isRecord(raw.sceneFrame)) node.sceneFrame = raw.sceneFrame as unknown as UiNode['sceneFrame']
  if (typeof raw.templateRef === 'string' || raw.templateRef === null) node.templateRef = raw.templateRef as string | null
  if (raw.templateOverrides !== undefined) node.templateOverrides = raw.templateOverrides as UiNode['templateOverrides']
  if (typeof raw.widthStretchRatio === 'number' || raw.widthStretchRatio === null) node.widthStretchRatio = raw.widthStretchRatio as number | null
  if (typeof raw.heightStretchRatio === 'number' || raw.heightStretchRatio === null) node.heightStretchRatio = raw.heightStretchRatio as number | null
  if (typeof raw.widthCompactRatio === 'number' || raw.widthCompactRatio === null) node.widthCompactRatio = raw.widthCompactRatio as number | null
  if (typeof raw.heightCompactRatio === 'number' || raw.heightCompactRatio === null) node.heightCompactRatio = raw.heightCompactRatio as number | null
  if (isRecord(raw.djui)) node.djui = raw.djui as UiNode['djui']
  if (typeof raw.editorLocked === 'boolean') node.editorLocked = raw.editorLocked
  if (typeof raw.editorLockAspect === 'boolean') node.editorLockAspect = raw.editorLockAspect

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

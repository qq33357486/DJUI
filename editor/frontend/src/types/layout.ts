// 布局 JSON 协议 v4 类型定义

export type StarType =
  | 'Panel' | 'Button' | 'Label' | 'Input' | 'Progress'
  | 'SpacingPanel' | 'PanelScrollable'
  | 'TemplateInstance'

export interface DjuiBasic {
  visible?: boolean
  disabled?: boolean
  isStatic?: boolean
}

export interface DjuiTransform {
  positionType?: 'Absolute' | 'Relative'
  x?: number
  y?: number
  width?: number
  height?: number
  widthStretchRatio?: number
  heightStretchRatio?: number
  rotation?: number
  scale?: [number, number]
  opacity?: number
  zIndex?: number
  // ★ 中心点（缩放/旋转围绕），0~1，(0.5,0.5)=几何中心
  pivot?: { x: number; y: number }
}

export interface DjuiAppearance {
  image?: string | null
  /** 图片在节点矩形内的绘制方式；九宫格图片固定按 stretch 处理 */
  imageFit?: 'stretch' | 'contain' | 'cover'
  /** cover/contain 焦点，0=左/上，0.5=中，1=右/下 */
  focalX?: number
  focalY?: number
  /** Runtime fallback because StarEngine exposes only a texture path, not synchronous intrinsic dimensions. */
  sourceSize?: { width: number; height: number } | null
  background?: string | null
  /** 图片染色（乘算 tint）：图片像素×颜色，白色素材=变成该色，透明区保持透明；仅在有图时生效 */
  imageTint?: string | null
  borderThickness?: number | null
  borderColor?: string | null
  imageMask?: string | null
  imageFlipX?: boolean
  imageFlipY?: boolean
  imageBlurLevel?: number
  cornerRadius?: number
  clipContent?: boolean
  desaturated?: boolean
}

export interface DjuiLayout {
  margin?: [number, number, number, number]
  padding?: [number, number, number, number]
  /** 父控件按子控件边界自适应尺寸 */
  autoSize?: 'None' | 'Width' | 'Height' | 'Both' | null
  /** 排列模式：None=手动摆放；Vertical/Horizontal=列表堆叠；Grid=网格排列 */
  flowOrientation?: 'None' | 'Horizontal' | 'Vertical' | 'Grid' | null
  /** 子控件间距二元组 [水平间距, 垂直间距]（列表/Grid 排列生效；旧单值 number 由 patches 迁移为 [v, v]） */
  spacing?: [number, number] | null
  /** 网格排列方向：Horizontal=水平优先（每行 N 个放满换行）；Vertical=垂直优先（每列 N 个放满换列） */
  gridFlow?: 'Horizontal' | 'Vertical' | null
  /** 网格每行/每列个数 N（正整数：非整数在 normalize 数据边界拦截，<1 由排列算法钳制为 1） */
  gridCount?: number | null
  /** 子项参与排列的顺序：Default=children 文档顺序；ByName=按 name 码点升序（无名按空串排最前，稳定排序）。只影响排列计算顺序，不改动 children 数组 */
  childOrder?: 'Default' | 'ByName' | null
  /** 自动重排开关（null/缺省=true）：开启后增删子项、调整顺序、撤销/重做时容器自动重排 */
  autoRelayout?: boolean | null
  horizontalAlignment?: 'Left' | 'Center' | 'Right' | 'Stretch' | null
  verticalAlignment?: 'Top' | 'Center' | 'Bottom' | 'Stretch' | null
  horizontalContentAlignment?: 'Left' | 'Center' | 'Right' | 'Stretch' | null
  verticalContentAlignment?: 'Top' | 'Center' | 'Bottom' | 'Stretch' | null
}

export interface DjuiInteraction {
  routedEvents?: string
  allowDrag?: boolean
  allowDrop?: boolean
  behaviors?: TouchBehaviorDef[]
}

export interface TouchBehaviorDef {
  type: 'TouchBehavior'
  scaleFactor?: number
  enablePressAnimation?: boolean
  enableLongPress?: boolean
}

export interface DjuiEffects {
  preset?: string | null
  customParams?: Record<string, unknown> | null
}

export type DjuiTextOverflow = 'None' | 'Clip' | 'Ellipsis' | 'Shrink'

export interface DjuiText {
  text?: string | null
  fontSize?: number | null
  textColor?: string | null
  strokeSize?: number | null
  strokeColor?: string | null
  bold?: boolean | null
  font?: string | null
  textWrap?: boolean | null
  textOverflow?: DjuiTextOverflow | null
}

export interface DjuiButton {
  imageHover?: string | null
  imagePressed?: string | null
  imageDisabled?: string | null
}

export interface DjuiProgress {
  value?: number
  progressionMode?: 'LeftToRight' | 'RightToLeft' | 'TopToBottom' | 'BottomToTop' | 'Clockwise' | 'CounterClockwise'
  rotation?: number
}

export interface DjuiExtensions {
  action?: string | null
  clickSoundId?: string | null
  bindings?: Record<string, string>
  locked?: boolean
}

export type DjuiWindowMode = 'fullscreen' | 'popup'

export interface DjuiTransition {
  open?: string | null
  close?: string | null
}

// 锚点：只管位置（NGUI UIAnchor 风格，9-way）
export interface DjuiAnchor {
  // 锚定目标：父节点 / 屏幕 / 安全区；父级局部绝对定位使用 side=None
  target?: 'screen' | 'parent' | 'safe' | 'image'
  safeEdges?: Array<'left' | 'top' | 'right' | 'bottom'>
  // 9-way 锚点位置（决定控件相对父/屏幕的对齐基准点）
  side?: 'None' | 'TopLeft' | 'Top' | 'TopRight' | 'Left' | 'Center' | 'Right' | 'BottomLeft' | 'Bottom' | 'BottomRight'
  // === 向后兼容旧字段（自动迁移用，新代码不写）===
  preset?: string
  horizontalAlignment?: string
  verticalAlignment?: string
  left?: number
  top?: number
  right?: number
  bottom?: number
  anchorMin?: { x: number; y: number }
  anchorMax?: { x: number; y: number }
}

// 拉伸：只管大小（NGUI UIStretch 风格）
export interface DjuiStretch {
  // 拉伸风格
  style?: 'None' | 'Horizontal' | 'Vertical' | 'Both'
  // 拉伸边距（像素），仅拉伸轴生效
  margins?: { left: number; right: number; top: number; bottom: number }
}

export interface DjuiAspectRatio {
  // 宽高比模式（对应 uGUI AspectRatioFitter）
  mode?: 'None' | 'WidthControlsHeight' | 'HeightControlsWidth' | 'FitInParent' | 'EnvelopeParent'
  // 宽 / 高（如 16:9 = 1.7778）
  ratio?: number
}

/**
 * 场景画板：容器自身先锚定到指定背景的完整 cover 图帧，子树再按 artboard
 * 坐标等比映射。它与普通 screen/safe UI 坐标系严格分离。
 */
export interface DjuiSceneFrame {
  backgroundId: string
  artboard: { width: number; height: number }
}

export interface UiNode {
  id: string
  starType: StarType
  name?: string
  basic?: DjuiBasic
  transform?: DjuiTransform
  appearance?: DjuiAppearance
  layout?: DjuiLayout
  interaction?: DjuiInteraction
  effects?: DjuiEffects
  text?: DjuiText
  button?: DjuiButton
  progress?: DjuiProgress | null
  anchor?: DjuiAnchor | null
  stretch?: DjuiStretch | null
  aspectRatio?: DjuiAspectRatio | null
  sceneFrame?: DjuiSceneFrame | null
  /** 模板引用，仅 starType === 'TemplateInstance' 生效 */
  templateRef?: string | null
  /** 模板实例覆盖：按模板子节点 name 定位，字段路径到覆盖值 */
  templateOverrides?: Record<string, Record<string, unknown>> | null
  /** Flex 增长比例（0~1，占据父容器剩余空间的比例） */
  widthStretchRatio?: number | null
  heightStretchRatio?: number | null
  /** Flex 收缩比例（0~1，空间不足时收缩的比例） */
  widthCompactRatio?: number | null
  heightCompactRatio?: number | null
  djui?: DjuiExtensions
  // 编辑器专用（不序列化到运行时 JSON）
  editorLocked?: boolean    // 锁定：无法在画布选中
  editorLockAspect?: boolean  // 锁定宽高比：拖拽缩放与 W/H 输入时保持当前比例
  children: UiNode[]
}

export interface UiPage {
  version: number
  pageId: string
  designWidth: number
  designHeight: number
  referenceImage?: string | null
  /** 参考效果图透明度（0~1，编辑器专用） */
  referenceOpacity?: number
  /** 参考效果图是否显示（编辑器专用） */
  referenceVisible?: boolean
  root: UiNode
  /** 节点类型：窗口（注册为可打开的 UI 页面）或模板（可复用的预制件） */
  nodeKind: 'window' | 'template'
  /** 窗口模式：全屏窗口或弹窗。影响默认开关动效。 */
  windowMode?: DjuiWindowMode | null
  /** 窗口入场/出场动效预设。为空时使用 Runtime 默认值。 */
  transition?: DjuiTransition | null
  /** v6 宽屏层字段覆盖，编辑器加载/保存必须无损保留 */
  responsive?: { wide: { overrides: Record<string, Record<string, unknown>> } }
}

export interface ProjectConfig {
  starProjectPath: string      // 星火工程目录名（显示用，来自 DirectoryHandle.name）
  workspacePath: string        // UI 工作区目录名（显示用，来自 DirectoryHandle.name）
  orientation: 'landscape' | 'portrait'
  designWidth: number
  designHeight: number
  // ★ Canvas Scaler（全局适配，对应 uGUI CanvasScaler）
  canvasScaler?: {
    mode: 'ScaleWithScreenSize' | 'ConstantPixelSize'
    match?: number
  }
  canvasMode?: 'Contain' | 'MatchWidth' | 'MatchHeight'
  wideRatio?: number
  /** 全局默认字体（未单独设字体的 Label/Input 使用） */
  defaultFont?: string | null
  /** 窗口保留池钉住白名单（关闭后常驻复用、永不淘汰；发布到 project.json 的 retainedPages） */
  retainedPages?: string[]
  /** 窗口保留池容量（非钉住页面数上限，0＝纯钉住模式；发布到 project.json 的 poolCapacity） */
  poolCapacity?: number
}

// 组件库定义
export interface ComponentDef {
  label: string
  starType: StarType
  icon: string
  defaultProps: Partial<UiNode>
}

export const COMPONENT_LIBRARY: ComponentDef[] = [
  {
    label: '容器',
    starType: 'Panel',
    icon: '▭',
    defaultProps: {
      starType: 'Panel',
      basic: { visible: true, disabled: false, isStatic: false },
      transform: { positionType: 'Absolute', width: 200, height: 150 },
      appearance: { background: '#00000000' },
    },
  },
  {
    label: '图片',
    starType: 'Panel',
    icon: '🖼',
    defaultProps: {
      starType: 'Panel',
      name: '图片',
      basic: { visible: true, isStatic: true },
      transform: { positionType: 'Absolute', width: 100, height: 100 },
    },
  },
  {
    label: '按钮',
    starType: 'Button',
    icon: '🔘',
    defaultProps: {
      starType: 'Button',
      basic: { visible: true, disabled: false },
      transform: { positionType: 'Absolute', width: 120, height: 48 },
      interaction: { routedEvents: 'AllPointerEvents' },
      effects: { preset: 'button_default' },
    },
  },
  {
    label: '文本',
    starType: 'Label',
    icon: '📝',
    defaultProps: {
      starType: 'Label',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 100, height: 24 },
      text: { text: '文本', fontSize: 16, textColor: '#FFFFFF', bold: false, textWrap: false, textOverflow: 'None' },
    },
  },
  {
    label: '输入框',
    starType: 'Input',
    icon: '✏️',
    defaultProps: {
      starType: 'Input',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 200, height: 36 },
    },
  },
  {
    // NGUI 风格：外层 Panel 容器 + 背景/滑块双子节点。
    // 子节点 id 用占位符，createNode 克隆后会递归重分配（见 editorStore.cloneWithNewIds）
    label: '进度条',
    starType: 'Panel',
    icon: '📊',
    defaultProps: {
      starType: 'Panel',
      name: '进度条',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 200, height: 14 },
      children: [
        // 子节点1：背景图（先渲染，在下层）。贴图后做九宫格背景。
        { id: '__GEN__', starType: 'Panel', name: '背景', basic: { isStatic: true }, transform: { positionType: 'Absolute', width: 200, height: 14, x: 0, y: 0 }, stretch: { style: 'Both', margins: { left: 0, right: 0, top: 0, bottom: 0 } }, children: [] },
        // 子节点2：滑块（后渲染，在上层）。引擎 Progress 类按 value 裁剪自身 image。
        { id: '__GEN__', starType: 'Progress', name: '滑块', basic: { visible: true }, transform: { positionType: 'Absolute', width: 200, height: 14, x: 0, y: 0 }, stretch: { style: 'Both', margins: { left: 0, right: 0, top: 0, bottom: 0 } }, progress: { value: 0.5, progressionMode: 'LeftToRight' }, children: [] },
      ],
    },
  },
  {
    label: '模板引用',
    starType: 'TemplateInstance',
    icon: '📦',
    defaultProps: {
      starType: 'TemplateInstance',
      name: '模板引用',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 200, height: 100 },
      templateRef: null,
      templateOverrides: {},
      children: [],
    },
  },
  {
    label: '滚动容器',
    starType: 'PanelScrollable',
    icon: '📜',
    defaultProps: {
      starType: 'PanelScrollable',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 300, height: 400 },
    },
  },
  // 「流式容器」(SpacingPanel) 已并入普通容器（0.29.0 起组件库移除，存量节点由 patches 迁移为 Panel）；
  // StarType 联合与 normalize/schemaV6 白名单仍保留 'SpacingPanel' 以读旧数据
]

// 动效预设（从后端读取，初始硬编码）
export const DEFAULT_EFFECT_PRESETS = [
  { id: 'button_default', category: '组合', label: '标准按钮', desc: '按压+悬停' },
  { id: 'press_scale_92', category: '按压', label: '按压 0.92', desc: '轻按缩放' },
  { id: 'press_scale_85_bounce', category: '按压', label: '重按+弹回', desc: '缩到0.85' },
  { id: 'hover_scale_105', category: '悬停', label: '悬停 1.05', desc: '悬停放大' },
  { id: 'fade_in', category: '出现', label: '淡入', desc: '透明度渐显' },
  { id: 'fade_out', category: '消失', label: '淡出', desc: '透明度渐隐' },
  { id: 'scale_in', category: '出现', label: '缩放出现', desc: 'Scale 0→1' },
  { id: 'slide_in_bottom', category: '出现', label: '底部滑入', desc: '从下滑入' },
  { id: 'loop_pulse', category: '循环', label: '脉冲', desc: '持续缩放' },
  { id: 'loop_floating', category: '循环', label: '浮动', desc: '上下浮动' },
]

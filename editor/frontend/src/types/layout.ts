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
  background?: string | null
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
  flowOrientation?: 'None' | 'Horizontal' | 'Vertical' | null
  /** 子控件间距（SpacingPanel.Spacing） */
  spacing?: number | null
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
  bold?: boolean | null
  font?: string | null
  textWrap?: boolean | null
  textOverflow?: DjuiTextOverflow | null
}

export interface DjuiButton {
  imageHover?: string | null
  imagePressed?: string | null
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
  // 锚定目标：屏幕 / 父节点
  target?: 'screen' | 'parent' | 'none'
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
  editorHidden?: boolean    // 隐藏：画布不渲染
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
    // 0=按宽匹配，1=按高匹配，0.5=平衡
    match?: number
  }
  /** 全局默认字体（未单独设字体的 Label/Input 使用） */
  defaultFont?: string | null
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
      text: { text: '文本', fontSize: 16, textColor: '#FFFFFF', bold: false, textWrap: false, textOverflow: 'Shrink' },
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
    label: '进度条',
    starType: 'Progress',
    icon: '📊',
    defaultProps: {
      starType: 'Progress',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 200, height: 12 },
      progress: { value: 0.5, progressionMode: 'LeftToRight' },
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
  {
    label: '流式容器',
    starType: 'SpacingPanel',
    icon: '📋',
    defaultProps: {
      starType: 'SpacingPanel',
      basic: { visible: true },
      transform: { positionType: 'Absolute', width: 300, height: 200 },
    },
  },
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

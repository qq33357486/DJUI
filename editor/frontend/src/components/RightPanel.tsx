import { Collapse, Empty, Input, InputNumber, Select, Switch, Button, Space, ColorPicker, Tooltip, Slider } from 'antd'
import { DeleteOutlined, ColumnHeightOutlined, PictureOutlined } from '@ant-design/icons'
import { useEditorStore, findNode } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'
import { DEFAULT_EFFECT_PRESETS, COMPONENT_LIBRARY, UiPage } from '@/types/layout'
import { useState, useEffect, useRef } from 'react'
import AssetPickerModal from './AssetPickerModal'
import SliceEditorModal from './SliceEditorModal'
import * as api from '@/api/client'
import { ANCHOR_SIDES, getAnchorSide, DEFAULT_ANCHOR_SIDE, DEFAULT_PIVOT, STRETCH_STYLES } from '@/utils/anchorPresets'
import { collectAutoSizeConflicts } from '@/utils/layoutSolver'

const TEXT_OVERFLOW_OPTIONS = [
  { value: 'None', label: '无（溢出显示）' },
  { value: 'Clip', label: '裁剪' },
  { value: 'Ellipsis', label: '省略号' },
  { value: 'Shrink', label: '缩放适配' },
]

const WINDOW_MODE_OPTIONS = [
  { value: 'fullscreen', label: '全屏窗口（默认淡入/淡出）' },
  { value: 'popup', label: '弹窗（默认弹入/弹出）' },
]

const WINDOW_OPEN_TRANSITION_OPTIONS = [
  { value: 'none', label: '无动效' },
  { value: 'fade_in', label: '淡入' },
  { value: 'pop_in', label: '弹入' },
  { value: 'slide_up_in', label: '向上滑入' },
]

const WINDOW_CLOSE_TRANSITION_OPTIONS = [
  { value: 'none', label: '无动效' },
  { value: 'fade_out', label: '淡出' },
  { value: 'pop_out', label: '弹出' },
  { value: 'slide_down_out', label: '向下滑出' },
]

export default function RightPanel() {
  const { page, allPages, selectedIds, updateNodeField, removeNode, updatePageMeta, applyFlexLayout, setActivePage } = useEditorStore()
  const { config, setLastPage } = useProjectStore()
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [assetPickerField, setAssetPickerField] = useState('')
  const [fittingSize, setFittingSize] = useState(false)
  const [sliceEditorOpen, setSliceEditorOpen] = useState(false)
  const [sliceMeta, setSliceMeta] = useState<Record<string, api.SliceEdges>>({})
  const [soundConfig, setSoundConfig] = useState<api.DjuiSoundConfig>({ version: 2, defaultButtonSoundId: null, sounds: [] })

  const selectedId = selectedIds[selectedIds.length - 1]
  const node = page && selectedId ? findNode(page.root, selectedId) : null

  // 加载九宫格元数据（路径参数已忽略）
  useEffect(() => {
    if (config?.workspacePath) {
      api.getSliceMeta().then(setSliceMeta)
    }
  }, [config?.workspacePath])

  useEffect(() => {
    if (!config?.starProjectPath) {
      setSoundConfig({ version: 2, defaultButtonSoundId: null, sounds: [] })
      return
    }

    const loadSounds = () => {
      api.getSoundConfig()
        .then(setSoundConfig)
        .catch(() => setSoundConfig({ version: 2, defaultButtonSoundId: null, sounds: [] }))
    }

    loadSounds()
    window.addEventListener('djui:soundsChanged', loadSounds)
    return () => window.removeEventListener('djui:soundsChanged', loadSounds)
  }, [config?.starProjectPath])

  // 打开素材选择
  const openAssetPicker = (fieldPath: string) => {
    setAssetPickerField(fieldPath)
    setAssetPickerOpen(true)
  }

  // 根据图片实际像素尺寸，调整控件宽高
  const fitToImageSize = async () => {
    if (!node?.appearance?.image || !config?.workspacePath) return
    setFittingSize(true)
    try {
      // 异步获取图片 URL（pure-frontend FS API）
      const url = await api.enginePathToUrl(node.appearance.image)
      if (!url) return
      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const im = new window.Image()
        im.crossOrigin = 'anonymous'
        im.onload = () => resolve(im)
        im.onerror = () => resolve(null)
        im.src = url
      })
      if (img && img.naturalWidth > 0) {
        updateNodeField(node.id, 'transform.width', img.naturalWidth)
        updateNodeField(node.id, 'transform.height', img.naturalHeight)
      }
    } finally {
      setFittingSize(false)
    }
  }

  const handleAssetSelected = (assetPath: string) => {
    if (!assetPickerField) return
    if (assetPickerField === '__referenceImage') {
      // 直接从 store 获取最新 page，避免闭包问题
      const activePage = useEditorStore.getState().page
      const activePageId = useEditorStore.getState().activePageId
      if (activePageId) updatePageMeta(activePageId, { referenceImage: assetPath })
    } else if (node) {
      updateNodeField(node.id, assetPickerField, assetPath)
    }
  }

  // 拖拽
  const handleDragStart = (e: React.DragEvent, label: string) => {
    e.dataTransfer.setData('text/plain', label)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 上半：组件库 */}
      <div style={{ flex: '0 0 auto', borderBottom: '1px solid #2a3142' }}>
        <div style={{
          padding: '10px 12px 6px', fontSize: 13, fontWeight: 600, color: '#9aa3b4',
        }}>
          组件库 (Library)
        </div>
        <div style={{
          padding: '0 8px 10px',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px',
        }}>
          {COMPONENT_LIBRARY.map(comp => (
            <div
              key={comp.label}
              draggable
              onDragStart={(e) => handleDragStart(e, comp.label)}
              style={{
                padding: '8px 6px', background: '#1d2230', border: '1px solid #2a3142',
                borderRadius: 6, cursor: 'grab', textAlign: 'center', fontSize: 13,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#252b3d')}
              onMouseLeave={e => (e.currentTarget.style.background = '#1d2230')}
            >
              <div style={{ fontSize: 20 }}>{comp.icon}</div>
              <div style={{ color: '#9aa3b4', marginTop: 2 }}>{comp.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 下半：属性面板 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{
          padding: '10px 12px 6px', fontSize: 13, fontWeight: 600, color: '#9aa3b4',
        }}>
          属性 (Inspector)
        </div>

        {!node ? (
          <PageInspector
            page={page}
            updatePageMeta={updatePageMeta}
            openAssetPicker={openAssetPicker}
          />
        ) : (
          <InspectorContent
            node={node}
            updateNodeField={updateNodeField}
            removeNode={removeNode}
            openAssetPicker={openAssetPicker}
            onFitToImageSize={fitToImageSize}
            fittingSize={fittingSize}
            sliceMeta={sliceMeta}
            onOpenSliceEditor={() => {
              if (node?.appearance?.image) setSliceEditorOpen(true)
            }}
            applyFlexLayout={applyFlexLayout}
            allPages={allPages}
            setActivePage={(pageId) => { setActivePage(pageId); setLastPage(pageId) }}
            soundConfig={soundConfig}
          />
        )}
      </div>

      <AssetPickerModal
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        onSelect={handleAssetSelected}
        customRootDir={assetPickerField === '__referenceImage' ? '.' : undefined}
        rawAbsolutePath={assetPickerField === '__referenceImage'}
        storageKey={assetPickerField}
      />
      {node?.appearance?.image && (
        <SliceEditorModal
          open={sliceEditorOpen}
          onClose={() => setSliceEditorOpen(false)}
          image={node.appearance.image}
          onSaved={() => {
            if (config?.workspacePath) {
              api.getSliceMeta().then(setSliceMeta)
            }
            window.dispatchEvent(new CustomEvent('djui:sliceMetaChanged'))
          }}
        />
      )}
    </div>
  )
}

// === 属性面板内容 ===
function InspectorContent({ node, updateNodeField, removeNode, openAssetPicker, onFitToImageSize, fittingSize, sliceMeta, onOpenSliceEditor, applyFlexLayout, allPages, setActivePage, soundConfig }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
  removeNode: (id: string) => void
  openAssetPicker: (field: string) => void
  onFitToImageSize: () => void
  fittingSize: boolean
  sliceMeta: Record<string, api.SliceEdges>
  onOpenSliceEditor: () => void
  applyFlexLayout: (parentId: string) => void
  allPages: Record<string, UiPage>
  setActivePage: (pageId: string) => void
  soundConfig: api.DjuiSoundConfig
}) {
  const t = node.transform ?? {}
  const app = node.appearance ?? {}
  const basic = node.basic ?? {}
  const txt = node.text ?? {}
  const anchor = node.anchor ?? {}
  const layout = node.layout ?? {}
  const aspectRatio = node.aspectRatio ?? {}
  const autoSizeMode = layout.autoSize ?? 'None'
  const autoWidth = autoSizeMode === 'Width' || autoSizeMode === 'Both'
  const autoHeight = autoSizeMode === 'Height' || autoSizeMode === 'Both'
  const stretchStyle = node.stretch?.style ?? 'None'
  const stretchWidth = stretchStyle === 'Horizontal' || stretchStyle === 'Both'
  const stretchHeight = stretchStyle === 'Vertical' || stretchStyle === 'Both'
  const xLabel = anchor.target === 'none' ? (stretchWidth ? '基准X' : 'X') : (stretchWidth ? '基准X' : '偏移X')
  const yLabel = anchor.target === 'none' ? (stretchHeight ? '基准Y' : 'Y') : (stretchHeight ? '基准Y' : '偏移Y')
  const templateOptions = Object.values(allPages)
    .filter(p => p.nodeKind === 'template')
    .map(p => ({ value: p.pageId, label: `${p.pageId} (${p.designWidth}×${p.designHeight})` }))
  const currentTemplate = node.templateRef ? allPages[node.templateRef] : null
  const soundOptions = soundConfig.sounds
    .filter(sound => (sound.controlTypes?.length ?? 0) === 0 || sound.controlTypes.includes(node.starType))
    .map(sound => ({
      value: sound.id,
      label: `${sound.id === soundConfig.defaultButtonSoundId ? '默认 · ' : ''}${sound.name}${sound.category ? `（${sound.category}）` : ''}`,
    }))
  const isButton = node.starType === 'Button'
  const clickSoundValue = node.djui?.clickSoundId ?? (isButton ? soundConfig.defaultButtonSoundId ?? undefined : undefined)

  return (
    <div style={{ padding: '4px 8px 16px' }}>
      {/* 节点信息 */}
      <div style={{ marginBottom: 8, padding: '8px', background: '#1d2230', borderRadius: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#5ab9ff', fontSize: 14 }}>{node.name || '未命名'}</div>
            <div style={{ color: '#5b6378', fontSize: 11 }}>{node.starType}</div>
          </div>
          <Button danger icon={<DeleteOutlined />} size="small" onClick={() => removeNode(node.id)} />
        </div>
      </div>

      <Collapse
        defaultActiveKey={['common', 'template', 'geometry', 'anchor', 'appearance', 'text', 'interaction']}
        ghost
        size="small"
        items={filterItems([
          {
            key: 'common', label: '常用',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="名称">
                  <Input size="small" value={node.name ?? ''} onChange={e => updateNodeField(node.id, 'name', e.target.value)} />
                </FieldRow>
                <FieldRow label="可见">
                  <Switch size="small" checked={basic.visible ?? true} onChange={v => updateNodeField(node.id, 'basic.visible', v)} />
                </FieldRow>
                <FieldRow label="禁用">
                  <Switch size="small" checked={basic.disabled ?? false} onChange={v => updateNodeField(node.id, 'basic.disabled', v)} />
                </FieldRow>
                <FieldRow label="静态">
                  <Switch size="small" checked={basic.isStatic ?? false} onChange={v => updateNodeField(node.id, 'basic.isStatic', v)} />
                </FieldRow>
              </Space>
            ),
          },
          node.starType === 'TemplateInstance' ? {
            key: 'template', label: '模板引用',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="模板">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder="选择模板"
                    value={node.templateRef ?? undefined}
                    options={templateOptions}
                    onChange={v => {
                      updateNodeField(node.id, 'templateRef', v ?? null)
                      if (v && !node.templateRef) {
                        const tpl = allPages[v]
                        if (tpl) {
                          updateNodeField(node.id, 'transform.width', tpl.designWidth)
                          updateNodeField(node.id, 'transform.height', tpl.designHeight)
                        }
                      }
                    }}
                  />
                </FieldRow>
                {currentTemplate && (
                  <FieldRow label="源尺寸">
                    <span style={{ fontSize: 12, color: '#9aa3b4' }}>
                      {currentTemplate.designWidth} × {currentTemplate.designHeight}
                    </span>
                  </FieldRow>
                )}
                <Button
                  size="small"
                  block
                  disabled={!node.templateRef || !allPages[node.templateRef]}
                  onClick={() => node.templateRef && setActivePage(node.templateRef)}
                >
                  进入模板编辑
                </Button>
                <TemplateOverridesEditor
                  nodeId={node.id}
                  overrides={node.templateOverrides ?? {}}
                  updateNodeField={updateNodeField}
                />
              </Space>
            ),
          } : null,
          {
            key: 'geometry', label: '位置尺寸',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <ScrubField label={xLabel} value={t.x ?? 0} onChange={v => updateNodeField(node.id, 'transform.x', v)} />
                <ScrubField label={yLabel} value={t.y ?? 0} onChange={v => updateNodeField(node.id, 'transform.y', v)} />
                <ScrubField label={(autoWidth || stretchWidth) ? '基准宽' : '宽'} value={t.width ?? 100} onChange={v => updateNodeField(node.id, 'transform.width', v)} min={1} />
                <ScrubField label={(autoHeight || stretchHeight) ? '基准高' : '高'} value={t.height ?? 100} onChange={v => updateNodeField(node.id, 'transform.height', v)} min={1} />
                {(stretchWidth || stretchHeight) && (
                  <div style={{ fontSize: 10, color: '#5b6378', paddingLeft: 64 }}>
                    拉伸轴由边距控制；画布拖拽和缩放会更新「锚点与拉伸」里的边距。
                  </div>
                )}
                {(autoWidth || autoHeight) && (
                  <div style={{ fontSize: 10, color: '#5b6378', paddingLeft: 64 }}>
                    自适应轴会按子控件边界计算；这里的数值作为空容器或冲突回退尺寸。
                  </div>
                )}
                <ScrubField label="旋转" value={t.rotation ?? 0} onChange={v => updateNodeField(node.id, 'transform.rotation', v)} />
                <ScrubField label="整体透明度" value={Math.round((t.opacity ?? 1) * 100)} onChange={v => updateNodeField(node.id, 'transform.opacity', v / 100)} step={1} min={0} max={100} suffix="%" />
                <ScrubField label="Z层级" value={t.zIndex ?? 0} onChange={v => updateNodeField(node.id, 'transform.zIndex', v)} />
                <PivotEditor node={node} updateNodeField={updateNodeField} />
              </Space>
            ),
          },
          {
            key: 'appearance', label: '外观',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {node.starType === 'Progress' && (() => {
                  const prog = node.progress ?? {}
                  const PROG_MODES = [
                    { value: 'LeftToRight', label: '←→' },
                    { value: 'RightToLeft', label: '→←' },
                    { value: 'TopToBottom', label: '↑↓' },
                    { value: 'BottomToTop', label: '↓↑' },
                    { value: 'Clockwise', label: '顺时针' },
                    { value: 'CounterClockwise', label: '逆时针' },
                  ]
                  const isRotary = prog.progressionMode === 'Clockwise' || prog.progressionMode === 'CounterClockwise'
                  return (
                    <>
                      <FieldRow label="方向">
                        <Select
                          size="small" style={{ width: '100%' }}
                          value={prog.progressionMode ?? 'LeftToRight'}
                          onChange={v => updateNodeField(node.id, 'progress.progressionMode', v)}
                          options={PROG_MODES}
                        />
                      </FieldRow>
                      <ScrubField label="进度" value={prog.value ?? 0.5} onChange={v => updateNodeField(node.id, 'progress.value', v)} step={0.01} min={0} max={1} />
                      {isRotary && (
                        <ScrubField label="起始角" value={prog.rotation ?? 0} onChange={v => updateNodeField(node.id, 'progress.rotation', v)} suffix="°" />
                      )}
                      <div style={{ fontSize: 10, color: '#5b6378' }}>
                        进度条用 Image 做前景遮罩，背景需另加 Panel 放后面。
                      </div>
                      <div style={{ borderTop: '1px solid #2a3142', margin: '2px 0' }} />
                    </>
                  )
                })()}
                <FieldRow label="背景图">
                  <Button size="small" block onClick={() => openAssetPicker('appearance.image')}>
                    {app.image ? `📷 ${app.image.split('/').pop()}` : '📷 选择图片'}
                  </Button>
                </FieldRow>
                {app.image && (
                  <FieldRow label="适配尺寸">
                    <Button
                      size="small"
                      block
                      icon={<ColumnHeightOutlined />}
                      loading={fittingSize}
                      onClick={onFitToImageSize}
                    >
                      按素材实际尺寸
                    </Button>
                  </FieldRow>
                )}
                <FieldRow label="背景色">
                  <PaletteColorPicker
                    value={app.background || '#00000000'}
                    onChange={hex => updateNodeField(node.id, 'appearance.background', hex)}
                  />
                </FieldRow>
                <AlphaField
                  label="背景透明度"
                  value={app.background || '#00000000'}
                  onChange={hex => updateNodeField(node.id, 'appearance.background', hex)}
                />
                <ScrubField label="圆角" value={app.cornerRadius ?? 0} onChange={v => updateNodeField(node.id, 'appearance.cornerRadius', v)} min={0} />
                <FieldRow label="裁剪">
                  <Switch size="small" checked={app.clipContent ?? false} onChange={v => updateNodeField(node.id, 'appearance.clipContent', v)} />
                </FieldRow>
                <FieldRow label="灰度">
                  <Switch size="small" checked={app.desaturated ?? false} onChange={v => updateNodeField(node.id, 'appearance.desaturated', v)} />
                </FieldRow>
                <FieldRow label="翻转X">
                  <Switch size="small" checked={app.imageFlipX ?? false} onChange={v => updateNodeField(node.id, 'appearance.imageFlipX', v)} />
                </FieldRow>
                <FieldRow label="翻转Y">
                  <Switch size="small" checked={app.imageFlipY ?? false} onChange={v => updateNodeField(node.id, 'appearance.imageFlipY', v)} />
                </FieldRow>
                {app.image && (
                  <FieldRow label="九宫格">
                    <Button
                      size="small"
                      block
                      onClick={onOpenSliceEditor}
                      style={sliceMeta[app.image] ? { color: '#5ab9ff', borderColor: '#5ab9ff' } : {}}
                    >
                      {sliceMeta[app.image] ? '✂ 已设置切片' : '✂ 编辑九宫格'}
                    </Button>
                  </FieldRow>
                )}
              </Space>
            ),
          },
          (node.starType === 'Label' || node.starType === 'Button' || node.starType === 'Input') ? {
            key: 'text', label: '文本',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="文本">
                  <Input size="small" value={txt.text ?? ''} onChange={e => updateNodeField(node.id, 'text.text', e.target.value)} />
                </FieldRow>
                <FieldRow label="字体">
                  <FontSelect node={node} updateNodeField={updateNodeField} />
                </FieldRow>
                <ScrubField label="字号" value={txt.fontSize ?? 16} onChange={v => updateNodeField(node.id, 'text.fontSize', v)} min={1} />
                <FieldRow label="颜色">
                  <PaletteColorPicker
                    value={txt.textColor || '#FFFFFF'}
                    onChange={hex => updateNodeField(node.id, 'text.textColor', hex)}
                  />
                </FieldRow>
                <AlphaField
                  label="文字透明度"
                  value={txt.textColor || '#FFFFFF'}
                  onChange={hex => updateNodeField(node.id, 'text.textColor', hex)}
                />
                <FieldRow label="粗体">
                  <Switch size="small" checked={txt.bold ?? false} onChange={v => updateNodeField(node.id, 'text.bold', v)} />
                </FieldRow>
                {node.starType === 'Label' && (
                  <>
                    <FieldRow label="自动换行">
                      <Switch size="small" checked={txt.textWrap ?? false} onChange={v => updateNodeField(node.id, 'text.textWrap', v)} />
                    </FieldRow>
                    <FieldRow label="超出处理">
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={txt.textOverflow ?? 'Shrink'}
                        onChange={v => updateNodeField(node.id, 'text.textOverflow', v)}
                        options={TEXT_OVERFLOW_OPTIONS}
                      />
                    </FieldRow>
                  </>
                )}
              </Space>
            ),
          } : null,
          {
            key: 'interaction', label: '交互',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="事件路由">
                  <Select
                    size="small" style={{ width: '100%' }}
                    value={node.interaction?.routedEvents ?? 'None'}
                    onChange={v => updateNodeField(node.id, 'interaction.routedEvents', v)}
                    options={[
                      { value: 'None', label: '默认（冒泡）' },
                      { value: 'AllPointerEvents', label: '全拦截' },
                      { value: 'PointerClicked', label: '仅拦截点击' },
                      { value: 'All', label: '拦截全部' },
                    ]}
                  />
                </FieldRow>
                <FieldRow label="允许拖拽">
                  <Switch size="small" checked={node.interaction?.allowDrag ?? false} onChange={v => updateNodeField(node.id, 'interaction.allowDrag', v)} />
                </FieldRow>
                <FieldRow label="允许放置">
                  <Switch size="small" checked={node.interaction?.allowDrop ?? false} onChange={v => updateNodeField(node.id, 'interaction.allowDrop', v)} />
                </FieldRow>
                <FieldRow label="Action">
                  <Input size="small" placeholder="home.openFilming" value={node.djui?.action ?? ''} onChange={e => updateNodeField(node.id, 'djui.action', e.target.value || null)} />
                </FieldRow>
              </Space>
            ),
          },
          {
            key: 'feedback', label: '反馈效果',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="动效">
                  <Select
                    size="small" style={{ width: '100%' }} allowClear placeholder="选择动效"
                    value={node.effects?.preset ?? undefined}
                    onChange={v => updateNodeField(node.id, 'effects.preset', v ?? null)}
                    options={DEFAULT_EFFECT_PRESETS.map(p => ({ value: p.id, label: `[${p.category}] ${p.label}` }))}
                  />
                </FieldRow>
                <FieldRow label="点击音效">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    allowClear={!isButton}
                    disabled={soundOptions.length === 0}
                    placeholder={soundOptions.length === 0 ? '未配置可用音效' : isButton ? '选择按钮音效' : '不播放'}
                    value={clickSoundValue}
                    options={soundOptions}
                    onChange={v => updateNodeField(node.id, 'djui.clickSoundId', v ?? (isButton ? soundConfig.defaultButtonSoundId : null))}
                  />
                </FieldRow>
                {soundOptions.length === 0 && (
                  <div style={{ fontSize: 10, color: '#5b6378' }}>可在“编辑 / 声音配置”中添加适用于当前控件的音效。</div>
                )}
              </Space>
            ),
          },
          {
            key: 'anchor', label: '锚点与拉伸',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                <AnchorEditor node={node} updateNodeField={updateNodeField} />
                <div style={{ borderTop: '1px solid #2a3142', margin: '2px 0' }} />
                <StretchEditor node={node} updateNodeField={updateNodeField} />
              </Space>
            ),
          },
          {
            key: 'autoLayout', label: '自动布局',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                <AutoLayoutPanel node={node} updateNodeField={updateNodeField} applyFlexLayout={applyFlexLayout} />
                <div style={{ borderTop: '1px solid #2a3142', margin: '2px 0' }} />
                <SectionTitle>对齐</SectionTitle>
                <AlignmentEditor node={node} updateNodeField={updateNodeField} />
              </Space>
            ),
          },
          {
            key: 'aspectRatio', label: '宽高比',
            children: (
              <AspectRatioEditor node={node} updateNodeField={updateNodeField} />
            ),
          },
        ])}
      />
    </div>
  )
}

function TemplateOverridesEditor({ nodeId, overrides, updateNodeField }: {
  nodeId: string
  overrides: Record<string, Record<string, unknown>>
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(overrides, null, 2))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(JSON.stringify(overrides, null, 2))
    setError(null)
  }, [nodeId, overrides])

  const apply = () => {
    try {
      const trimmed = draft.trim()
      const parsed = trimmed ? JSON.parse(trimmed) : {}
      updateNodeField(nodeId, 'templateOverrides', parsed)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON 格式错误')
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <FieldRow label="覆盖JSON">
        <Input.TextArea
          rows={6}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={apply}
          placeholder={'{\n  "文本": {\n    "text.text": "确认"\n  }\n}'}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </FieldRow>
      {error && <div style={{ color: '#ff6b6b', fontSize: 12 }}>{error}</div>}
      <Button size="small" block onClick={apply}>应用覆盖</Button>
    </Space>
  )
}

// === NGUI 风格锚点编辑器（9-way 位置选择器 + 无锚点）===
function AnchorEditor({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const anchor = node.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const currentSide = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const isNone = target === 'none'

  // 选择具体锚点：重置偏移为 0（让控件跳到锚点位置）
  const applySide = (sideId: string) => {
    updateNodeField(node.id, 'anchor.side', sideId)
    if (sideId !== 'None') {
      updateNodeField(node.id, 'transform.x', 0)
      updateNodeField(node.id, 'transform.y', 0)
    }
  }

  // 切换目标：选 none 时设置 side=None；选 parent/screen 时恢复默认锚点
  const handleTargetChange = (v: string) => {
    updateNodeField(node.id, 'anchor.target', v)
    if (v === 'none') {
      updateNodeField(node.id, 'anchor.side', 'None')
    } else if (currentSide === 'None') {
      // 从无锚点切回来时恢复默认
      updateNodeField(node.id, 'anchor.side', DEFAULT_ANCHOR_SIDE)
      updateNodeField(node.id, 'transform.x', 0)
      updateNodeField(node.id, 'transform.y', 0)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {/* 锚定目标（含无锚点选项） */}
      <FieldRow label="目标">
        <Select
          size="small" style={{ width: '100%' }}
          value={target}
          onChange={handleTargetChange}
          options={[
            { value: 'parent', label: '父节点' },
            { value: 'screen', label: '屏幕（全屏）' },
            { value: 'none', label: '无锚点（绝对定位）' },
          ]}
        />
      </FieldRow>

      {/* 3×3 网格选择器（无锚点时隐藏） */}
      {!isNone && (
      <div style={{
        padding: 10,
        background: '#0f1117',
        border: '1px solid #2a3142',
        borderRadius: 6,
      }}>
        <div style={{ fontSize: 10, color: '#5b6378', marginBottom: 8, textAlign: 'center' }}>
          锚点只管位置 · {target === 'screen' ? '屏幕' : '父节点'}内
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          gap: 4,
          width: '100%',
          maxWidth: 140,
          margin: '0 auto',
        }}>
          {ANCHOR_SIDES.map(s => (
            <AnchorSideIcon
              key={s.id}
              side={s}
              active={currentSide === s.id}
              onClick={() => applySide(s.id)}
            />
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#5ab9ff', textAlign: 'center', marginTop: 6 }}>
          {getAnchorSide(currentSide)?.label ?? '自定义'}
        </div>
      </div>
      )}

      {!isNone && (
      <div style={{ fontSize: 10, color: '#5b6378' }}>
        控件位置 = 锚点 + 偏移(X/Y)。要跟随父级缩放请用「拉伸」。
      </div>
      )}
    </Space>
  )
}

// 9-way 锚点位置图标（SVG，显示父框 + 锚点标记）
function AnchorSideIcon({ side, active, onClick }: {
  side: typeof ANCHOR_SIDES[0]
  active: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const bg = active ? '#15293d' : hover ? '#1d2a3f' : 'transparent'
  const border = active ? '#5ab9ff' : '#2a3142'
  const fg = active ? '#5ab9ff' : hover ? '#9aa3b4' : '#5b6378'

  // SVG 内部锚点位置（3×3 → 16×16 SVG 内的坐标）
  // col 0→3, 1→7.5, 2→12; row 0→3, 1→7.5, 2→12（row 0=顶）
  const positions = [
    [3, 3], [7.5, 3], [12, 3],
    [3, 7.5], [7.5, 7.5], [12, 7.5],
    [3, 12], [7.5, 12], [12, 12],
  ]
  const idx = side.row * 3 + side.col
  const [px, py] = positions[idx]

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      title={side.label}
      style={{
        aspectRatio: '1 / 1',
        cursor: 'pointer',
        transition: 'all 0.1s',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" style={{ display: 'block' }}>
        {/* 外框 */}
        <rect x={2} y={2} width={12} height={12}
          fill="none" stroke={fg} strokeWidth="0.8" opacity="0.5" />
        {/* 锚点标记（十字 + 圆点） */}
        <line x1={px - 2} y1={py} x2={px + 2} y2={py} stroke={fg} strokeWidth="0.8" />
        <line x1={px} y1={py - 2} x2={px} y2={py + 2} stroke={fg} strokeWidth="0.8" />
        <circle cx={px} cy={py} r="1.5" fill={fg} />
      </svg>
    </div>
  )
}

// === NGUI 风格拉伸编辑器（UIStretch）===
function StretchEditor({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const stretch = node.stretch ?? {}
  const style = stretch.style ?? 'None'
  const margins = stretch.margins ?? { left: 0, right: 0, top: 0, bottom: 0 }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <FieldRow label="模式">
        <Select
          size="small" style={{ width: '100%' }}
          value={style}
          onChange={v => updateNodeField(node.id, 'stretch.style', v)}
          options={STRETCH_STYLES.map(s => ({ value: s.id, label: s.label }))}
        />
      </FieldRow>

      {style !== 'None' && (
        <>
          <div style={{ fontSize: 11, color: '#9aa3b4', marginTop: 2 }}>拉伸边距（像素）</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(style === 'Horizontal' || style === 'Both') && (
              <>
                <ScrubField label="左" value={margins.left ?? 0} onChange={v => updateNodeField(node.id, 'stretch.margins', { ...margins, left: v })} />
                <ScrubField label="右" value={margins.right ?? 0} onChange={v => updateNodeField(node.id, 'stretch.margins', { ...margins, right: v })} />
              </>
            )}
            {(style === 'Vertical' || style === 'Both') && (
              <>
                <ScrubField label="上" value={margins.top ?? 0} onChange={v => updateNodeField(node.id, 'stretch.margins', { ...margins, top: v })} />
                <ScrubField label="下" value={margins.bottom ?? 0} onChange={v => updateNodeField(node.id, 'stretch.margins', { ...margins, bottom: v })} />
              </>
            )}
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: '#5b6378' }}>
        {style === 'None' && '拉伸管大小。启用后控件宽/高跟随父级减去边距。位置仍由锚点控制。'}
        {style === 'Horizontal' && '宽度 = 父宽 - 左右边距。高度不变。'}
        {style === 'Vertical' && '高度 = 父高 - 上下边距。宽度不变。'}
        {style === 'Both' && '宽高均跟随父级（减去边距）。'}
      </div>
    </Space>
  )
}

// === 宽高比编辑器（uGUI AspectRatioFitter 风格） ===
function AspectRatioEditor({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const ar = node.aspectRatio ?? {}
  const mode = ar.mode ?? 'None'
  const ratio = ar.ratio ?? 1
  const t = node.transform ?? {}

  const setMode = (m: string) => {
    updateNodeField(node.id, 'aspectRatio.mode', m)
  }

  const setRatio = (r: number) => {
    updateNodeField(node.id, 'aspectRatio.ratio', r)
  }

  // 从当前控件宽高算出原始比例
  const computeFromSize = () => {
    const w = t.width ?? 100
    const h = t.height ?? 100
    if (h > 0) setRatio(Math.round((w / h) * 10000) / 10000)
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <FieldRow label="模式">
        <Select
          size="small" style={{ width: '100%' }}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'None', label: '禁用' },
            { value: 'WidthControlsHeight', label: '宽控高（高跟随宽）' },
            { value: 'HeightControlsWidth', label: '高控宽（宽跟随高）' },
            { value: 'FitInParent', label: '适配父内（不超出）' },
            { value: 'EnvelopeParent', label: '覆盖父（撑满父）' },
          ]}
        />
      </FieldRow>

      {mode !== 'None' && (
        <>
          <FieldRow label="比例">
            <InputNumber
              size="small" min={0.01} step={0.1} value={ratio}
              onChange={v => setRatio(v ?? 1)}
              style={{ width: '100%' }}
              addonAfter="W/H"
            />
          </FieldRow>

          {/* 快速比例 */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[
              { label: '1:1', r: 1 },
              { label: '4:3', r: 4 / 3 },
              { label: '3:4', r: 3 / 4 },
              { label: '16:9', r: 16 / 9 },
              { label: '9:16', r: 9 / 16 },
              { label: '原始', r: null },
            ].map(p => (
              <div
                key={p.label}
                onClick={() => p.r === null ? computeFromSize() : setRatio(p.r)}
                style={{
                  flex: '1 1 0', minWidth: 50, cursor: 'pointer', textAlign: 'center',
                  padding: '4px 0', fontSize: 11,
                  background: '#1d2230', border: '1px solid #2a3142', borderRadius: 4,
                  color: '#9aa3b4',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#5ab9ff'; e.currentTarget.style.color = '#5ab9ff' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3142'; e.currentTarget.style.color = '#9aa3b4' }}
              >
                {p.label}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: '#5b6378', marginTop: 2 }}>
            {mode === 'WidthControlsHeight' && '高 = 宽 / 比例，宽跟随父级或拉伸'}
            {mode === 'HeightControlsWidth' && '宽 = 高 × 比例，高跟随父级或拉伸'}
            {mode === 'FitInParent' && '在父级内等比缩放，可能留空白'}
            {mode === 'EnvelopeParent' && '等比缩放覆盖父级，可能溢出'}
          </div>
        </>
      )}
    </Space>
  )
}

// === Pivot（中心点）编辑器 ===
function PivotEditor({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const pivot = node.transform?.pivot ?? DEFAULT_PIVOT
  // 9 宫格定位（0/0.5/1 三档映射到行/列 0/1/2）
  const toCell = (v: number) => v < 0.25 ? 0 : v > 0.75 ? 2 : 1
  const activeRow = toCell(pivot.y)
  const activeCol = toCell(pivot.x)
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null)

  const setPivot = (row: number, col: number) => {
    const x = col === 0 ? 0 : col === 2 ? 1 : 0.5
    // 注意：pivot Y 朝下（与屏幕一致，0=顶 1=底），与 uGUI Y 朝上相反
    // 但 pivot 本身用屏幕坐标更直观：row 0 = 顶
    const y = row === 0 ? 0 : row === 2 ? 1 : 0.5
    updateNodeField(node.id, 'transform.pivot', { x, y })
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, color: '#9aa3b4', marginBottom: 4 }}>中心点（Pivot）· 旋转/缩放围绕点</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* 3×3 mini 网格 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 14px)',
          gridTemplateRows: 'repeat(3, 14px)',
          gap: 2,
        }}>
          {Array.from({ length: 9 }, (_, i) => {
            const row = Math.floor(i / 3)
            const col = i % 3
            const active = activeRow === row && activeCol === col
            const hovered = hoverCell && hoverCell[0] === row && hoverCell[1] === col
            return (
              <div
                key={i}
                onMouseEnter={() => setHoverCell([row, col])}
                onMouseLeave={() => setHoverCell(null)}
                onClick={() => setPivot(row, col)}
                title={row === 0 ? '顶' : row === 2 ? '底' : '中'}
                style={{
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                  background: active ? '#5ab9ff' : hovered ? '#2a5a8a' : '#1d2230',
                  border: active ? '1px solid #5ab9ff' : '1px solid #2a3142',
                  borderRadius: 2,
                }}
              />
            )
          })}
        </div>
        {/* 数值显示 */}
        <div style={{ fontSize: 10, color: '#5b6378' }}>
          X: {pivot.x.toFixed(2)} Y: {pivot.y.toFixed(2)}
        </div>
      </div>
    </div>
  )
}

// === 页面级属性面板（无控件选中时显示）===
function PageInspector({ page, updatePageMeta, openAssetPicker }: {
  page: UiPage | null
  updatePageMeta: (pageId: string, updates: Partial<UiPage>) => void
  openAssetPicker: (fieldPath: string) => void
}) {
  if (!page) {
    return <div style={{ padding: '16px' }}><Empty description="请选择窗口" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
  }

  const refImg = page.referenceImage ?? null
  const refOpacity = page.referenceOpacity ?? 0.5
  const refVisible = page.referenceVisible ?? true
  const isTemplate = page.nodeKind === 'template'
  const isWindow = page.nodeKind === 'window'

  const updateTransition = (field: 'open' | 'close', value: string | null) => {
    updatePageMeta(page.pageId, {
      transition: {
        ...(page.transition ?? {}),
        [field]: value,
      },
    })
  }

  return (
    <div style={{ padding: '4px 8px 16px' }}>
      <Collapse
        defaultActiveKey={['page', 'window', 'pageFeedback', 'refImage']}
        ghost
        size="small"
        items={filterItems([
          {
            key: 'page', label: '页面',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="名称">
                  <Input size="small" value={page.pageId} disabled />
                </FieldRow>
                <FieldRow label="类型">
                  <Select
                    size="small" style={{ width: '100%' }}
                    value={page.nodeKind}
                    onChange={v => updatePageMeta(page.pageId, { nodeKind: v })}
                    options={[
                      { value: 'window', label: '窗口' },
                      { value: 'template', label: '模板' },
                    ]}
                  />
                </FieldRow>
                <FieldRow label="分辨率">
                  {isTemplate ? (
                    <Space.Compact style={{ width: '100%' }}>
                      <InputNumber
                        size="small"
                        min={1}
                        value={page.designWidth}
                        onChange={v => updatePageMeta(page.pageId, { designWidth: v ?? 1 })}
                        style={{ width: '50%' }}
                      />
                      <InputNumber
                        size="small"
                        min={1}
                        value={page.designHeight}
                        onChange={v => updatePageMeta(page.pageId, { designHeight: v ?? 1 })}
                        style={{ width: '50%' }}
                      />
                    </Space.Compact>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9aa3b4' }}>
                      {page.designWidth} x {page.designHeight}
                    </span>
                  )}
                </FieldRow>
              </Space>
            ),
          },
          isWindow ? {
            key: 'window', label: '窗口',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="窗口模式">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={page.windowMode ?? 'fullscreen'}
                    onChange={v => updatePageMeta(page.pageId, { windowMode: v })}
                    options={WINDOW_MODE_OPTIONS}
                  />
                </FieldRow>
              </Space>
            ),
          } : null,
          isWindow ? {
            key: 'pageFeedback', label: '反馈效果',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="入场动效">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder={page.windowMode === 'popup' ? '默认：弹入' : '默认：淡入'}
                    value={page.transition?.open ?? undefined}
                    onChange={v => updateTransition('open', v ?? null)}
                    options={WINDOW_OPEN_TRANSITION_OPTIONS}
                  />
                </FieldRow>
                <FieldRow label="出场动效">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder={page.windowMode === 'popup' ? '默认：弹出' : '默认：淡出'}
                    value={page.transition?.close ?? undefined}
                    onChange={v => updateTransition('close', v ?? null)}
                    options={WINDOW_CLOSE_TRANSITION_OPTIONS}
                  />
                </FieldRow>
                <div style={{ fontSize: 10, color: '#5b6378' }}>
                  不选择具体动效时，Runtime 会按窗口模式使用默认值。
                </div>
              </Space>
            ),
          } : null,
          {
            key: 'refImage', label: '参考图',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <FieldRow label="图片">
                  <Space.Compact style={{ width: '100%' }}>
                    <Button
                      size="small"
                      block
                      icon={<PictureOutlined />}
                      onClick={() => openAssetPicker('__referenceImage')}
                    >
                      {refImg ? refImg.split('/').pop() : '选择效果图'}
                    </Button>
                    {refImg && (
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => updatePageMeta(page.pageId, { referenceImage: null })}
                        danger
                      />
                    )}
                  </Space.Compact>
                </FieldRow>

                {refImg && (
                  <>
                    <FieldRow label="透明度">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Slider
                          min={0} max={1} step={0.05}
                          value={refOpacity}
                          onChange={v => updatePageMeta(page.pageId, { referenceOpacity: v })}
                          style={{ flex: 1, margin: 0 }}
                        />
                        <span style={{ fontSize: 11, color: '#9aa3b4', width: 32, textAlign: 'right' }}>
                          {Math.round(refOpacity * 100)}%
                        </span>
                      </div>
                    </FieldRow>
                    <FieldRow label="显示">
                      <Switch
                        size="small"
                        checked={refVisible}
                        onChange={v => updatePageMeta(page.pageId, { referenceVisible: v })}
                      />
                    </FieldRow>
                  </>
                )}

                <div style={{ fontSize: 10, color: '#5b6378' }}>
                  效果图以半透明叠加在画布上，不拦截交互，用于对齐素材位置和大小。
                </div>
              </Space>
            ),
          },
        ])}
      />
    </div>
  )
}

// === 字体中文名映射 ===
const FONT_CN_MAP: Record<string, string> = {
  'regular': '常规体',
  'bold': '粗体',
  'medium': '中黑体',
  'light': '细体',
  'thin': '极细体',
  'black': '特粗体',
  'songti': '宋体',
  'heiti': '黑体',
  'kaiti': '楷体',
  'fangsong': '仿宋',
  'yahei': '雅黑',
  'simsun': '宋体',
  'simhei': '黑体',
  'arial': 'Arial',
  'helvetica': 'Helvetica',
}
function fontDisplayName(fontId: string): string {
  const cn = FONT_CN_MAP[fontId.toLowerCase()]
  return cn ? `${cn} (${fontId})` : fontId
}

// === 字体选择器 ===
function FontSelect({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const { config } = useProjectStore()
  const [fonts, setFonts] = useState<string[]>([])
  const [warning, setWarning] = useState(false)

  useEffect(() => {
    if (!config?.starProjectPath) return
    api.getFonts().then(list => setFonts(list))
  }, [config?.starProjectPath])

  const currentFont = node.text?.font ?? null
  const globalFont = config?.defaultFont ?? null
  useEffect(() => {
    if (currentFont && fonts.length > 0 && !fonts.includes(currentFont)) {
      setWarning(true)
    } else {
      setWarning(false)
    }
  }, [currentFont, fonts])

  return (
    <>
      <Select
        size="small" style={{ width: '100%' }}
        value={currentFont}
        onChange={v => updateNodeField(node.id, 'text.font', v || null)}
        allowClear
        placeholder={globalFont ? `全局: ${fontDisplayName(globalFont)}` : '默认引擎字体'}
        options={fonts.map(f => ({ value: f, label: fontDisplayName(f) }))}
      />
      {!currentFont && globalFont && (
        <div style={{ fontSize: 10, color: '#5b6378', marginTop: 2 }}>
          使用全局默认字体: {fontDisplayName(globalFont)}
        </div>
      )}
      {warning && (
        <div style={{ fontSize: 10, color: '#ff9800', marginTop: 2 }}>
          ⚠ 该字体不在 ref/fontref.txt 中，可能无法渲染
        </div>
      )}
    </>
  )
}

// === 项目色盘 + 最近颜色 ===
const PALETTE_STORAGE_KEY = 'djui-recent-colors'
const MAX_RECENT = 12

interface ParsedColor {
  r: number
  g: number
  b: number
  a: number
}

function clampByte(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clampAlpha(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function byteToHex(value: number) {
  return clampByte(value).toString(16).padStart(2, '0').toUpperCase()
}

function parseColorValue(raw?: string | null): ParsedColor {
  if (!raw) return { r: 0, g: 0, b: 0, a: 0 }

  const value = raw.trim()
  if (!value || value.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(ch => ch + ch).join('')
    }

    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      if ([r, g, b, a].every(Number.isFinite)) {
        return { r, g, b, a: clampAlpha(a) }
      }
    }
  }

  const rgbMatch = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgbMatch) {
    const r = clampByte(parseFloat(rgbMatch[1]))
    const g = clampByte(parseFloat(rgbMatch[2]))
    const b = clampByte(parseFloat(rgbMatch[3]))
    const alphaRaw = rgbMatch[4] === undefined ? 1 : parseFloat(rgbMatch[4])
    const a = alphaRaw <= 1 ? alphaRaw : alphaRaw / 255
    return { r, g, b, a: clampAlpha(a) }
  }

  return { r: 0, g: 0, b: 0, a: 1 }
}

function formatRgbHex(color: ParsedColor) {
  return `#${byteToHex(color.r)}${byteToHex(color.g)}${byteToHex(color.b)}`
}

function formatRgbaHex(color: ParsedColor) {
  return `${formatRgbHex(color)}${byteToHex(color.a * 255)}`
}

function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveRecentColor(color: string) {
  const list = loadRecentColors().filter(c => c !== color)
  list.unshift(color)
  const trimmed = list.slice(0, MAX_RECENT)
  localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(trimmed))
}

function PaletteColorPicker({ value, onChange }: {
  value: string
  onChange: (hex: string) => void
}) {
  const { config } = useProjectStore()
  const [palette, setPalette] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])

  const wsPath = config?.workspacePath ?? ''
  useEffect(() => {
    if (!wsPath) return
    api.getPalette().then(setPalette)
  }, [wsPath])

  useEffect(() => {
    setRecent(loadRecentColors())
  }, [])

  const parsedValue = parseColorValue(value)
  const pickerValue = formatRgbHex(parsedValue)

  const handleChange = (hex: string) => {
    const picked = parseColorValue(hex)
    // 选颜色时保留当前 alpha（不强制改成不透明）
    const fixed = formatRgbaHex({ ...picked, a: parsedValue.a })
    onChange(fixed)
    saveRecentColor(fixed)
    setRecent(loadRecentColors())
  }

  const addToPalette = async (color: string) => {
    if (!wsPath) return
    await api.addPaletteColor('', color)
    setPalette(prev => [...prev, color])
  }

  const removeFromPalette = async (color: string) => {
    if (!wsPath) return
    await api.removePaletteColor('', color)
    setPalette(prev => prev.filter(c => c !== color))
  }

  const currentAlpha = parsedValue.a

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ColorPicker
          size="small"
          value={pickerValue}
          onChange={(_, hex) => handleChange(hex)}
          showText
          disabledAlpha
        />
      </div>
    </div>
  )
}

// === 独立透明度滑块（PS 风格 0-100%）===
function AlphaField({ label, value, onChange }: {
  label?: string
  value: string
  onChange: (hex: string) => void
}) {
  const parsed = parseColorValue(value)
  const alpha = parsed.a

  const handleAlphaChange = (a: number) => {
    onChange(formatRgbaHex({ ...parseColorValue(value), a: clampAlpha(a) }))
  }

  return (
    <FieldRow label={label ?? '透明度'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={alpha}
          onChange={handleAlphaChange}
          style={{ flex: 1, margin: 0 }}
          tooltip={{ formatter: v => `${Math.round((v ?? 0) * 100)}%` }}
        />
        <InputNumber
          size="small"
          min={0}
          max={100}
          value={Math.round(alpha * 100)}
          onChange={v => handleAlphaChange((v ?? 0) / 100)}
          formatter={v => `${v}%`}
          parser={v => v?.replace('%', '') as unknown as number}
          style={{ width: 64 }}
        />
      </div>
    </FieldRow>
  )
}

// === 辅助组件 ===
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 56, textAlign: 'right', fontSize: 12, color: '#9aa3b4', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid #2a3142', paddingTop: 8, fontSize: 11, color: '#9aa3b4' }}>
      {children}
    </div>
  )
}

// === NGUI 风格拖拽改值组件 ===
// 标签可拖拽（左右滑动改值），InputNumber 可手动输入
function ScrubField({ label, value, onChange, step = 1, min, max, suffix }: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null)
  const inputRef = useRef<any>(null)

  const handleScrubStart = (e: React.MouseEvent) => {
    // 仅左键
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startVal: value }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      let speed = 1
      if (ev.shiftKey) speed = 0.1
      else if (ev.ctrlKey || ev.metaKey) speed = 10
      const raw = dragRef.current.startVal + dx * speed
      const rounded = step >= 1 ? Math.round(raw) : Math.round(raw * 100) / 100
      if (min !== undefined && rounded < min) { onChange(min); return }
      if (max !== undefined && rounded > max) { onChange(max); return }
      onChange(rounded)
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        onMouseDown={handleScrubStart}
        onDoubleClick={() => inputRef.current?.focus?.()}
        title="拖动调整 · Shift精细 · Ctrl粗略 · 双击输入"
        style={{
          width: 56, textAlign: 'right', fontSize: 12,
          color: '#9aa3b4', flexShrink: 0, cursor: 'ew-resize',
          userSelect: 'none',
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1 }}>
        <InputNumber
          ref={inputRef}
          size="small"
          value={value}
          onChange={v => onChange(v ?? 0)}
          step={step}
          min={min}
          max={max}
          addonAfter={suffix}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  )
}

function filterItems(items: any[]) {
  return items.filter(Boolean)
}

// === 自动布局编辑器（FlowOrientation + Spacing + Flex）===
function AutoLayoutPanel({ node, updateNodeField, applyFlexLayout }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
  applyFlexLayout: (parentId: string) => void
}) {
  const layout = node.layout ?? {}
  const isContainer = ['Panel', 'SpacingPanel', 'PanelScrollable'].includes(node.starType)
  const autoSize = layout.autoSize ?? 'None'
  const autoSizeConflicts = autoSize === 'None' ? [] : collectAutoSizeConflicts(node)

  const handleAutoSizeChange = (v: string) => {
    updateNodeField(node.id, 'layout.autoSize', v === 'None' ? null : v)
  }

  const handleFlowChange = (v: string) => {
    updateNodeField(node.id, 'layout.flowOrientation', v)
    // 开启自动布局时，立即把 flex 结果写回子控件坐标
    if (v === 'Vertical' || v === 'Horizontal') {
      // 延迟一帧等 store 更新完 flowOrientation
      setTimeout(() => applyFlexLayout(node.id), 0)
    }
  }

  const handleSpacingChange = (v: number) => {
    updateNodeField(node.id, 'layout.spacing', v)
    // 间距变化时重新排列
    if (layout.flowOrientation === 'Vertical' || layout.flowOrientation === 'Horizontal') {
      setTimeout(() => applyFlexLayout(node.id), 0)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {isContainer ? (
        <>
          <FieldRow label="自适应">
            <Select
              size="small" style={{ width: '100%' }}
              value={autoSize}
              onChange={handleAutoSizeChange}
              options={[
                { value: 'None', label: '固定宽高' },
                { value: 'Width', label: '自动宽' },
                { value: 'Height', label: '自动高' },
                { value: 'Both', label: '自动宽高' },
              ]}
            />
          </FieldRow>
          {autoSize !== 'None' && (
            <div style={{ fontSize: 10, color: autoSizeConflicts.length ? '#d89614' : '#5b6378' }}>
              {autoSizeConflicts.length
                ? `检测到 ${autoSizeConflicts.length} 个依赖父尺寸的布局，冲突轴会回退到基准尺寸。`
                : '自动尺寸按可见子控件边界计算，隐藏节点不参与。'}
            </div>
          )}
          <FieldRow label="布局模式">
            <Select
              size="small" style={{ width: '100%' }}
              value={layout.flowOrientation ?? 'None'}
              onChange={handleFlowChange}
              options={[
                { value: 'None', label: '无（手动定位）' },
                { value: 'Vertical', label: '垂直堆叠 ↓' },
                { value: 'Horizontal', label: '水平堆叠 →' },
              ]}
            />
          </FieldRow>
          {layout.flowOrientation && layout.flowOrientation !== 'None' && (
            <>
              <ScrubField label="间距" value={layout.spacing ?? 0} onChange={handleSpacingChange} min={0} />
              <Button size="small" block onClick={() => applyFlexLayout(node.id)}>
                重新排列子控件
              </Button>
            </>
          )}
        </>
      ) : (
        <div style={{ fontSize: 10, color: '#5b6378' }}>仅容器类型支持自动布局</div>
      )}
      <div style={{ borderTop: '1px solid #2a3142', margin: '4px 0', paddingTop: 4 }}>
        <div style={{ fontSize: 11, color: '#9aa3b4', marginBottom: 4 }}>弹性尺寸（Flex）</div>
      </div>
      <ScrubField label="水平增长" value={node.widthStretchRatio ?? 0} onChange={v => updateNodeField(node.id, 'widthStretchRatio', v)} step={0.05} min={0} max={1} />
      <ScrubField label="垂直增长" value={node.heightStretchRatio ?? 0} onChange={v => updateNodeField(node.id, 'heightStretchRatio', v)} step={0.05} min={0} max={1} />
      <ScrubField label="水平收缩" value={node.widthCompactRatio ?? 0} onChange={v => updateNodeField(node.id, 'widthCompactRatio', v)} step={0.05} min={0} max={1} />
      <ScrubField label="垂直收缩" value={node.heightCompactRatio ?? 0} onChange={v => updateNodeField(node.id, 'heightCompactRatio', v)} step={0.05} min={0} max={1} />
      {layout.flowOrientation && layout.flowOrientation !== 'None' && (
        <div style={{ fontSize: 10, color: '#5b6378' }}>
          增长=占据父容器剩余空间比例 · 收缩=空间不足时缩小比例
        </div>
      )}
    </Space>
  )
}

// === 内容对齐编辑器（HorizontalContentAlignment / VerticalContentAlignment）===
const H_ALIGN_OPTIONS = [
  { value: 'Left', label: '左' },
  { value: 'Center', label: '中' },
  { value: 'Right', label: '右' },
  { value: 'Stretch', label: '拉伸' },
]
const V_ALIGN_OPTIONS = [
  { value: 'Top', label: '上' },
  { value: 'Center', label: '中' },
  { value: 'Bottom', label: '下' },
  { value: 'Stretch', label: '拉伸' },
]
function AlignmentEditor({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const layout = node.layout ?? {}
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <FieldRow label="水平">
        <Select
          size="small" style={{ width: '100%' }}
          value={layout.horizontalContentAlignment ?? null}
          onChange={v => updateNodeField(node.id, 'layout.horizontalContentAlignment', v)}
          options={H_ALIGN_OPTIONS}
          allowClear
          placeholder="默认 Center"
        />
      </FieldRow>
      <FieldRow label="垂直">
        <Select
          size="small" style={{ width: '100%' }}
          value={layout.verticalContentAlignment ?? null}
          onChange={v => updateNodeField(node.id, 'layout.verticalContentAlignment', v)}
          options={V_ALIGN_OPTIONS}
          allowClear
          placeholder="默认 Center"
        />
      </FieldRow>
    </Space>
  )
}

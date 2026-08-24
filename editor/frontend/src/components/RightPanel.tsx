import { Collapse, Empty, Input, InputNumber, Select, Switch, Button, Space, ColorPicker, Tooltip, Slider, message } from 'antd'
import { DeleteOutlined, ColumnHeightOutlined, PictureOutlined } from '@ant-design/icons'
import { useEditorStore, findNode } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'
import { DEFAULT_EFFECT_PRESETS, COMPONENT_LIBRARY, UiPage, DjuiAnchor } from '@/types/layout'
import { useState, useEffect, useRef } from 'react'
import AssetPickerModal from './AssetPickerModal'
import SliceEditorModal from './SliceEditorModal'
import * as api from '@/api/client'
import { ANCHOR_SIDES, getAnchorSide, DEFAULT_ANCHOR_SIDE, DEFAULT_PIVOT, STRETCH_STYLES } from '@/utils/anchorPresets'
import { collectAutoSizeConflicts } from '@/utils/layoutSolver'
import { findUnderlayCycle } from '@/lib/pageUnderlays'
import { getReferenceImageVisible, setReferenceImageVisible } from '@/lib/editorPreferences'

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
  const { page, allPages, selectedIds, updateNodeField, batchUpdateNode, removeNode, updatePageMeta, applyFlexLayout, setActivePage, responsiveVariant, clearResponsiveOverrides } = useEditorStore()
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
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        updateNodeField(node.id, 'appearance.sourceSize', { width: img.naturalWidth, height: img.naturalHeight })
        updateNodeField(node.id, 'transform.width', img.naturalWidth)
        updateNodeField(node.id, 'transform.height', img.naturalHeight)
      }
    } finally {
      setFittingSize(false)
    }
  }

  const handleAssetSelected = async (assetPath: string) => {
    if (!assetPickerField) return
    if (assetPickerField === '__referenceImage') {
      // 直接从 store 获取最新 page，避免闭包问题
      const activePage = useEditorStore.getState().page
      const activePageId = useEditorStore.getState().activePageId
      if (activePageId) updatePageMeta(activePageId, { referenceImage: assetPath })
    } else if (node) {
      updateNodeField(node.id, assetPickerField, assetPath)
      if (assetPickerField === 'appearance.image') {
        const url = await api.enginePathToUrl(assetPath)
        if (!url) return
        const img = await new Promise<HTMLImageElement | null>((resolve) => {
          const im = new window.Image()
          im.onload = () => resolve(im)
          im.onerror = () => resolve(null)
          im.src = url
        })
        if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
          updateNodeField(node.id, 'appearance.sourceSize', { width: img.naturalWidth, height: img.naturalHeight })
        }
      }
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
            batchUpdateNode={batchUpdateNode}
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
            responsiveVariant={responsiveVariant}
            clearResponsiveOverrides={clearResponsiveOverrides}
            selectedIds={selectedIds}
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
function InspectorContent({ node, updateNodeField, batchUpdateNode, removeNode, openAssetPicker, onFitToImageSize, fittingSize, sliceMeta, onOpenSliceEditor, applyFlexLayout, allPages, setActivePage, soundConfig, responsiveVariant, clearResponsiveOverrides, selectedIds }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
  batchUpdateNode: (id: string, updates: Record<string, unknown>) => void
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
  responsiveVariant: 'base' | 'wide'
  clearResponsiveOverrides: (nodeId: string) => void
  selectedIds: string[]
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
  // 锁定宽高比：拉伸轴下尺寸由父容器决定，锁形无意义，禁用
  const aspectLockDisabled = stretchWidth || stretchHeight
  const aspectLocked = node.editorLockAspect === true && !aspectLockDisabled
  const aspectRatioWH = (t.width ?? 100) / (t.height ?? 100)  // 当前 W:H
  const xLabel = anchor.side === 'None' ? (stretchWidth ? '基准X' : 'X') : (stretchWidth ? '基准X' : '偏移X')
  const yLabel = anchor.side === 'None' ? (stretchHeight ? '基准Y' : 'Y') : (stretchHeight ? '基准Y' : '偏移Y')
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
  const canUseBorder = node.starType !== 'TemplateInstance'
  const canUseTextStroke = node.starType === 'Label' || node.starType === 'Button'
  const borderThickness = typeof app.borderThickness === 'number' ? Math.max(0, app.borderThickness) : 0
  const textStrokeSize = typeof txt.strokeSize === 'number' ? Math.max(0, txt.strokeSize) : 0

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

      {responsiveVariant === 'wide' && (
        <div style={{ marginBottom: 8, padding: 8, border: '1px solid #5c4218', borderRadius: 6, background: '#2a1f0f', color: '#ffaa44', fontSize: 12 }}>
          正在编辑宽屏覆盖层
          <Button size="small" style={{ float: 'right' }} onClick={() => clearResponsiveOverrides(node.id)}>清除此节点覆盖</Button>
        </div>
      )}

      <Collapse
        defaultActiveKey={['common', 'template', 'geometry', 'anchor', 'appearance', 'buttonStates', 'text', 'interaction']}
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
                <ScrubField
                  label={(autoWidth || stretchWidth) ? '基准宽' : '宽'}
                  value={t.width ?? 100}
                  onChange={v => {
                    // 锁形开启且比例有效：同时按当前 W:H 反算高
                    if (aspectLocked && aspectRatioWH > 0) {
                      batchUpdateNode(node.id, { 'transform.width': v, 'transform.height': Math.max(1, Math.round(v / aspectRatioWH)) })
                    } else {
                      updateNodeField(node.id, 'transform.width', v)
                    }
                  }}
                  min={1}
                />
                {/* 锁链 toggle：保持当前宽高比 */}
                <div style={{ display: 'flex', justifyContent: 'center', margin: '-2px 0' }}>
                  <span
                    onClick={() => { if (!aspectLockDisabled) updateNodeField(node.id, 'editorLockAspect', !aspectLocked) }}
                    title={aspectLockDisabled ? '拉伸轴下尺寸由父容器决定，无法锁定比例' : (aspectLocked ? '已锁定宽高比，点击解锁' : '锁定宽高比')}
                    style={{
                      fontSize: 14,
                      cursor: aspectLockDisabled ? 'not-allowed' : 'pointer',
                      color: aspectLockDisabled ? '#3a4156'
                        : aspectLocked ? '#5ab9ff'
                        : '#5b6378',
                      userSelect: 'none',
                      opacity: aspectLockDisabled ? 0.5 : 1,
                      transition: 'color 0.15s',
                    }}
                  >
                    {aspectLocked ? '🔒' : '🔓'}
                  </span>
                </div>
                <ScrubField
                  label={(autoHeight || stretchHeight) ? '基准高' : '高'}
                  value={t.height ?? 100}
                  onChange={v => {
                    // 锁形开启且比例有效：同时按当前 W:H 反算宽
                    if (aspectLocked && aspectRatioWH > 0) {
                      batchUpdateNode(node.id, { 'transform.height': v, 'transform.width': Math.max(1, Math.round(v * aspectRatioWH)) })
                    } else {
                      updateNodeField(node.id, 'transform.height', v)
                    }
                  }}
                  min={1}
                />
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
                      <ScrubField label="进度" value={prog.value ?? 0.5} onChange={v => updateNodeField(node.id, 'progress.value', v)} step={0.01} min={0} max={1} dragSensitivity={0.005} />
                      {isRotary && (
                        <ScrubField label="起始角" value={prog.rotation ?? 0} onChange={v => updateNodeField(node.id, 'progress.rotation', v)} suffix="°" />
                      )}
                      <div style={{ borderTop: '1px solid #2a3142', margin: '2px 0' }} />
                    </>
                  )
                })()}
                <FieldRow label={node.starType === 'Progress' ? '进度图' : '背景图'}>
                  <Button size="small" block onClick={() => openAssetPicker('appearance.image')}>
                    {app.image ? `📷 ${app.image.split('/').pop()}` : `📷 选择${node.starType === 'Progress' ? '进度' : '背景'}图`}
                  </Button>
                </FieldRow>
                {app.image && (
                  <FieldRow label="图片铺放">
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      value={app.imageFit ?? 'stretch'}
                      disabled={!!sliceMeta[app.image]}
                      onChange={v => updateNodeField(node.id, 'appearance.imageFit', v)}
                      options={[
                        { value: 'stretch', label: '拉伸填满' },
                        { value: 'contain', label: '完整显示' },
                        { value: 'cover', label: '等比铺满' },
                      ]}
                    />
                  </FieldRow>
                )}
                {app.image && (
                  <FieldRow label="素材尺寸">
                    <Space.Compact style={{ width: '100%' }}>
                      <InputNumber size="small" min={1} placeholder="宽" value={app.sourceSize?.width} onChange={v => updateNodeField(node.id, 'appearance.sourceSize.width', v)} style={{ width: '50%' }} />
                      <InputNumber size="small" min={1} placeholder="高" value={app.sourceSize?.height} onChange={v => updateNodeField(node.id, 'appearance.sourceSize.height', v)} style={{ width: '50%' }} />
                    </Space.Compact>
                  </FieldRow>
                )}
                {app.image && ['contain', 'cover'].includes(app.imageFit ?? 'stretch') && !(app.sourceSize?.width > 0 && app.sourceSize?.height > 0) && (
                  <div style={{ color: '#ff7875', fontSize: 11 }}>完整显示/等比铺满必须填写素材原始尺寸。</div>
                )}
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
                <FieldRow label="透明度">
                  <OpacitySlider value={(t.opacity ?? 1)} onChange={v => updateNodeField(node.id, 'transform.opacity', v)} />
                </FieldRow>
                {canUseBorder && (
                  <>
                    <ScrubField label="边框" value={borderThickness} onChange={v => updateNodeField(node.id, 'appearance.borderThickness', v)} min={0} />
                    {borderThickness > 0 && (
                      <>
                        <FieldRow label="边框色">
                          <PaletteColorPicker
                            value={app.borderColor || '#FFFFFFFF'}
                            onChange={hex => updateNodeField(node.id, 'appearance.borderColor', hex)}
                          />
                        </FieldRow>
                        <FieldRow label="边框透明">
                          <AlphaSlider value={app.borderColor || '#FFFFFFFF'} onChange={hex => updateNodeField(node.id, 'appearance.borderColor', hex)} />
                        </FieldRow>
                      </>
                    )}
                  </>
                )}
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
          node.starType === 'Button' ? {
            key: 'buttonStates', label: '按钮状态',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <ButtonStatePreview node={node} />
                {(() => {
                  const btn = node.button ?? {}
                  const rows = [
                    { label: '悬停图', field: 'button.imageHover', value: btn.imageHover },
                    { label: '按下图', field: 'button.imagePressed', value: btn.imagePressed },
                    { label: '禁用图', field: 'button.imageDisabled', value: btn.imageDisabled },
                  ] as const
                  return rows.map(row => (
                    <FieldRow key={row.field} label={row.label}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Button size="small" style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }} onClick={() => openAssetPicker(row.field)}>
                          {row.value ? `📷 ${String(row.value).split('/').pop()}` : '📷 选择图片'}
                        </Button>
                        {row.value && (
                          <Button size="small" icon={<DeleteOutlined />} title="清除" onClick={() => updateNodeField(node.id, row.field, null)} />
                        )}
                      </Space.Compact>
                    </FieldRow>
                  ))
                })()}
                <div style={{ fontSize: 10, color: '#5b6378', lineHeight: 1.6 }}>
                  悬停/按下未设置图时保持正常图；禁用未设置图时运行时自动灰化变淡。素材建议按 btn_功能_状态 同尺寸成套。
                </div>
              </Space>
            ),
          } : null,
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
                <FieldRow label="透明度">
                  <AlphaSlider value={txt.textColor || '#FFFFFF'} onChange={hex => updateNodeField(node.id, 'text.textColor', hex)} />
                </FieldRow>
                {canUseTextStroke && (
                  <>
                    <ScrubField label="描边" value={textStrokeSize} onChange={v => updateNodeField(node.id, 'text.strokeSize', v)} min={0} />
                    {textStrokeSize > 0 && (
                      <>
                        <FieldRow label="描边色">
                          <PaletteColorPicker
                            value={txt.strokeColor || '#000000FF'}
                            onChange={hex => updateNodeField(node.id, 'text.strokeColor', hex)}
                          />
                        </FieldRow>
                        <FieldRow label="描边透明">
                          <AlphaSlider value={txt.strokeColor || '#000000FF'} onChange={hex => updateNodeField(node.id, 'text.strokeColor', hex)} />
                        </FieldRow>
                      </>
                    )}
                  </>
                )}
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
                <AnchorEditor node={node} selectedIds={selectedIds} />
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

// === 按钮状态图（hover/pressed/disabled）迷你预览 ===
function ButtonStateThumb({ label, path, fallbackPath, grayFallback }: { label: string; path?: string | null; fallbackPath?: string | null; grayFallback?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const resolvedPath = path || fallbackPath || null
  useEffect(() => {
    let alive = true
    if (resolvedPath) {
      api.enginePathToUrl(resolvedPath)
        .then(u => { if (alive) setUrl(u) })
        .catch(() => { if (alive) setUrl(null) })
    } else {
      setUrl(null)
    }
    return () => { alive = false }
  }, [resolvedPath])
  const showFallbackLook = !!grayFallback && !path && !!url
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        height: 34, borderRadius: 4, border: '1px solid #2a3142', background: '#171b26',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative',
      }}>
        {url ? (
          <img
            src={url}
            alt={label}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              filter: showFallbackLook ? 'grayscale(1)' : undefined,
              opacity: showFallbackLook ? 0.5 : 1,
            }}
          />
        ) : (
          <span style={{ fontSize: 10, color: '#5b6378' }}>未设置</span>
        )}
        {showFallbackLook && (
          <span style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 9, color: '#c0c6d4', background: 'rgba(30,34,46,0.85)', padding: '0 2px', borderRadius: 2 }}>自动</span>
        )}
      </div>
      <div style={{ fontSize: 10, color: '#9aa3b4', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function ButtonStatePreview({ node }: { node: any }) {
  const app = node.appearance ?? {}
  const btn = node.button ?? {}
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
      <ButtonStateThumb label="正常" path={app.image} />
      <ButtonStateThumb label="悬停" path={btn.imageHover} />
      <ButtonStateThumb label="按下" path={btn.imagePressed} />
      <ButtonStateThumb label="禁用" path={btn.imageDisabled} fallbackPath={app.image} grayFallback />
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
function AnchorEditor({ node, selectedIds }: {
  node: any
  selectedIds: string[]
}) {
  const anchor = node.anchor ?? {}
  const target = anchor.target ?? 'parent'
  const currentSide = anchor.side ?? DEFAULT_ANCHOR_SIDE
  const isNone = currentSide === 'None'

  // 锚点更改由画布按当前视觉矩形反算；多选时对所有选中节点原子提交。
  const reanchor = (changes: {
    side?: DjuiAnchor['side']
    target?: 'parent' | 'screen' | 'safe' | 'image'
    safeEdges?: Array<'left' | 'top' | 'right' | 'bottom'>
  }) => {
    window.dispatchEvent(new CustomEvent('djui:reanchor', {
      detail: { ids: selectedIds.length > 0 ? selectedIds : [node.id], ...changes },
    }))
  }

  const applySide = (sideId: DjuiAnchor['side']) => {
    reanchor({ side: sideId })
  }

  const handleTargetChange = (v: string) => {
    reanchor({
      target: v as 'parent' | 'screen' | 'safe' | 'image',
      ...(v === 'safe' && !anchor.safeEdges?.length
        ? { safeEdges: ['left', 'top', 'right', 'bottom'] as Array<'left' | 'top' | 'right' | 'bottom'> }
        : {}),
    })
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
            { value: 'safe', label: '安全区' },
            { value: 'image', label: '背景图帧' },
          ]}
        />
      </FieldRow>

      {target === 'safe' && (
        <FieldRow label="安全边">
          <Space wrap size={4}>
            {[['left', '左'], ['top', '上'], ['right', '右'], ['bottom', '下']].map(([edge, label]) => {
              const selected = (anchor.safeEdges ?? ['left', 'top', 'right', 'bottom']).includes(edge)
              return (
                <Button
                  key={edge}
                  size="small"
                  type={selected ? 'primary' : 'default'}
                  onClick={() => {
                    const current = anchor.safeEdges ?? ['left', 'top', 'right', 'bottom']
                    const next = selected ? current.filter((item: string) => item !== edge) : [...current, edge]
                    reanchor({ safeEdges: next as Array<'left' | 'top' | 'right' | 'bottom'> })
                  }}
                >{label}</Button>
              )
            })}
          </Space>
        </FieldRow>
      )}

      {/* 3×3 网格选择器；side=None 表示父级局部绝对定位 */}
      {!isNone && (
      <div style={{
        padding: 10,
        background: '#0f1117',
        border: '1px solid #2a3142',
        borderRadius: 6,
      }}>
        <div style={{ fontSize: 10, color: '#5b6378', marginBottom: 8, textAlign: 'center' }}>
          锚点只管位置 · {target === 'screen' ? '屏幕' : target === 'safe' ? '安全区' : target === 'image' ? '背景图帧' : '父节点'}内
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
  const { allPages, pageUnderlays, setPageUnderlays } = useEditorStore()
  const { config } = useProjectStore()
  const underlaySaveRevision = useRef(0)
  if (!page) {
    return <div style={{ padding: '16px' }}><Empty description="请选择窗口" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
  }

  const refImg = page.referenceImage ?? null
  const refOpacity = page.referenceOpacity ?? 0.5
  const refVisible = page.referenceVisible ?? getReferenceImageVisible(config?.workspacePath, page.pageId)
  const isTemplate = page.nodeKind === 'template'
  const isWindow = page.nodeKind === 'window'
  const underlayPageId = pageUnderlays[page.pageId]
  const underlayOptions = Object.values(allPages)
    .filter(candidate => candidate.nodeKind === 'window' && candidate.pageId !== page.pageId)
    .map(candidate => {
      const proposed = { ...pageUnderlays, [page.pageId]: candidate.pageId }
      const cycle = findUnderlayCycle(proposed, page.pageId, candidate.pageId)
      return {
        value: candidate.pageId,
        label: cycle ? `${candidate.pageId}（会形成循环关联）` : candidate.pageId,
        disabled: !!cycle,
      }
    })

  const updateUnderlay = async (value: string | undefined) => {
    const previous = pageUnderlays
    const revision = ++underlaySaveRevision.current
    const next = { ...pageUnderlays }
    if (value) {
      next[page.pageId] = value
      const cycle = findUnderlayCycle(next, page.pageId, value)
      if (cycle) {
        message.error(`不能形成循环后景：${cycle.join(' → ')}`)
        return
      }
    } else {
      delete next[page.pageId]
    }
    setPageUnderlays(next)
    try {
      await api.savePageUnderlays(next)
    } catch (error) {
      // 连续选择后旧请求失败不能回滚用户较新的选择。
      if (revision === underlaySaveRevision.current) {
        setPageUnderlays(previous)
        message.error(error instanceof Error ? `保存后景关联失败：${error.message}` : '保存后景关联失败')
      }
    }
  }

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
                <FieldRow label="后景页面">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder="不叠加后景页面"
                    value={underlayPageId}
                    onChange={value => { void updateUnderlay(value) }}
                    options={underlayOptions}
                  />
                </FieldRow>
                <div style={{ fontSize: 10, color: '#5b6378' }}>
                  编辑此页时，后景页会以只读方式完整置于画布底层；该设置不发布到 Runtime。
                </div>
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
                        onChange={v => {
                          updatePageMeta(page.pageId, { referenceVisible: v })
                          setReferenceImageVisible(config?.workspacePath, page.pageId, v)
                        }}
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
  'msyh': '微软雅黑',
  'seguiemj': '系统表情字体',
  'notoemoji': 'Noto 表情字体',
  'noteemoji': '手写表情字体',
  'nowarrounded': '圆体 NoWarRounded',
  'lxgwwenkai': '霞鹜文楷',
  'alimama': '阿里妈妈体',
  'sourcehanserif': '思源宋体',
  'chillkai': '楷体 ChillKai',
  'simkai': '楷体',
  'firamono': '等宽 FiraMono',
}
function fontDisplayName(fontId: string): string {
  const lastSeg = fontId.split('/').pop()?.toLowerCase() ?? fontId.toLowerCase()
  const cn = FONT_CN_MAP[lastSeg]
  return cn ? `${cn} (${fontId})` : fontId
}

// === 字体选择器 ===
// 字体下拉的「字体管理」哨兵值（选中它时不写入节点，而是打开字体管理弹窗）
export const FONT_MANAGE_VALUE = '__djui_font_manager__'
// 「引擎默认」哨兵值（写入节点时转为 null = 不设字体，跟随引擎默认字体）
export const ENGINE_DEFAULT_FONT_VALUE = '__djui_engine_default__'

// 字体下拉只有两类选项：引擎默认 + 用户导入的字体（画布与引擎加载同一文件，完全一致）
export function buildFontSelectOptions(fonts: string[], fontInfos: { family: string; imported: boolean }[]) {
  const importedSet = new Set(fontInfos.filter(f => f.imported).map(f => f.family))
  const imported = fonts.filter(f => importedSet.has(f)).map(f => ({ value: f, label: fontDisplayName(f) }))
  return [
    { value: ENGINE_DEFAULT_FONT_VALUE, label: '引擎默认' },
    ...(imported.length > 0 ? [{ label: '已导入字体', options: imported }] : []),
    { label: '', options: [{ value: FONT_MANAGE_VALUE, label: '⚙ 导入新字体…' }] },
  ]
}

function FontSelect({ node, updateNodeField }: {
  node: any
  updateNodeField: (id: string, path: string, value: unknown) => void
}) {
  const { fonts, fontInfos, setFontManagerOpen } = useProjectStore()
  const [warning, setWarning] = useState(false)

  const currentFont = node.text?.font ?? null
  const selectValue = currentFont ?? ENGINE_DEFAULT_FONT_VALUE
  useEffect(() => {
    if (currentFont && fonts.length > 0 && !fonts.includes(currentFont)) {
      setWarning(true)
    } else {
      setWarning(false)
    }
  }, [currentFont, fonts])

  const options = buildFontSelectOptions(fonts, fontInfos)

  return (
    <>
      <Select
        size="small" style={{ width: '100%' }}
        value={selectValue}
        onChange={v => {
          if (v === FONT_MANAGE_VALUE) { setFontManagerOpen(true); return }
          updateNodeField(node.id, 'text.font', v === ENGINE_DEFAULT_FONT_VALUE ? null : (v || null))
        }}
        options={options}
      />
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

  // 屏幕取色管（EyeDropper API）：从屏幕任意位置拾取颜色
  const handlePickFromScreen = async () => {
    const EyeDropperCtor = window.EyeDropper
    if (!EyeDropperCtor) {
      message.warning('当前浏览器不支持屏幕取色，请使用 Chrome / Edge')
      return
    }
    try {
      const result = await new EyeDropperCtor().open()
      handleChange(result.sRGBHex)
    } catch {
      // 用户取消取色（按 Esc 等），静默忽略
    }
  }

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
        <Tooltip title="屏幕取色">
          <Button
            size="small"
            type="text"
            onClick={handlePickFromScreen}
            style={{ padding: '0 4px', display: 'inline-flex', alignItems: 'center', color: '#9aa3b4' }}
            aria-label="屏幕取色"
          >
            {/* 滴管图标（Antd Icons 无现成 eyedropper，使用内联 SVG） */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.13 1.587a.5.5 0 0 1 .708 0l2.575 2.575a.5.5 0 0 1 0 .708l-1.06 1.06.707.708a.5.5 0 0 1 0 .707l-1.061 1.06a.5.5 0 0 1-.707 0l-.707-.707-5.969 5.969a1.5 1.5 0 0 1-.722.394l-2.18.484a.5.5 0 0 1-.592-.592l.484-2.18a1.5 1.5 0 0 1 .394-.722l5.969-5.969-.707-.707a.5.5 0 0 1 0-.707l1.06-1.061a.5.5 0 0 1 .708 0l.707.707 1.06-1.06zM10.425 4l-5.96 5.96a.5.5 0 0 0-.13.24l-.305 1.375 1.375-.305a.5.5 0 0 0 .24-.13L11.6 5.175 10.425 4z"/>
            </svg>
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

// === 控件整体透明度滑块（0-1 float，绑定 transform.opacity）===
function OpacitySlider({ value, onChange }: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Slider
        min={0} max={1} step={0.01}
        value={value}
        onChange={onChange}
        style={{ flex: 1, margin: 0 }}
        tooltip={{ formatter: v => `${Math.round((v ?? 0) * 100)}%` }}
      />
      <span style={{ fontSize: 11, color: '#9aa3b4', width: 36, textAlign: 'right', flexShrink: 0 }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

// === 颜色 alpha 透明度滑块（绑定 hex 的 alpha 通道）===
function AlphaSlider({ value, onChange }: {
  value: string
  onChange: (hex: string) => void
}) {
  const alpha = parseColorValue(value).a
  const handleChange = (a: number) => {
    onChange(formatRgbaHex({ ...parseColorValue(value), a: clampAlpha(a) }))
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Slider
        min={0} max={1} step={0.01}
        value={alpha}
        onChange={handleChange}
        style={{ flex: 1, margin: 0 }}
        tooltip={{ formatter: v => `${Math.round((v ?? 0) * 100)}%` }}
      />
      <span style={{ fontSize: 11, color: '#9aa3b4', width: 36, textAlign: 'right', flexShrink: 0 }}>
        {Math.round(alpha * 100)}%
      </span>
    </div>
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
function ScrubField({ label, value, onChange, step = 1, min, max, suffix, dragSensitivity }: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  dragSensitivity?: number
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
      let speed = dragSensitivity ?? 1
      if (ev.shiftKey) speed *= 0.1
      else if (ev.ctrlKey || ev.metaKey) speed *= 10
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

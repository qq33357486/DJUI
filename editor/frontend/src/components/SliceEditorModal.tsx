import { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, InputNumber, Button, Space } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import * as api from '@/api/client'
import { useProjectStore } from '@/store/projectStore'

interface SliceEditorModalProps {
  open: boolean
  onClose: () => void
  image: string
  onSaved?: () => void
}

interface Edges { left: number; top: number; right: number; bottom: number }

export default function SliceEditorModal({ open, onClose, image, onSaved }: SliceEditorModalProps) {
  const { config } = useProjectStore()
  const workspacePath = config?.workspacePath ?? ''
  const projectPath = config?.starProjectPath ?? ''

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [edges, setEdges] = useState<Edges>({ left: 0, top: 0, right: 0, bottom: 0 })
  const [imgUrl, setImgUrl] = useState<string>('')
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ which: 'v1' | 'v2' | 'h1' | 'h2'; startX: number; startY: number; startVal: number } | null>(null)

  // 加载图片和已有元数据
  useEffect(() => {
    if (!open || !image) return
    const url = api.enginePathToUrl(image, workspacePath, projectPath)
    setImgUrl(url)
    const im = new window.Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => {
      setImgSize({ w: im.naturalWidth, h: im.naturalHeight })
    }
    im.src = url
    // 加载已有元数据
    if (workspacePath) {
      api.getSliceMeta(workspacePath).then(meta => {
        const e = meta[image]
        if (e) setEdges(e)
        else setEdges({ left: 0, top: 0, right: 0, bottom: 0 })
      })
    }
  }, [open, image, workspacePath, projectPath])

  // 计算缩放比例（适配弹窗）
  useEffect(() => {
    if (!imgSize || !containerRef.current) return
    const maxW = containerRef.current.clientWidth - 4
    const maxH = 400
    const s = Math.min(maxW / imgSize.w, maxH / imgSize.h, 1)
    setScale(s)
  }, [imgSize])

  const displayW = imgSize ? imgSize.w * scale : 0
  const displayH = imgSize ? imgSize.h * scale : 0

  // 拖拽参考线
  const startDrag = useCallback((which: 'v1' | 'v2' | 'h1' | 'h2', e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startVal = which === 'v1' ? edges.left : which === 'v2' ? edges.right : which === 'h1' ? edges.top : edges.bottom
    dragRef.current = { which, startX: e.clientX, startY: e.clientY, startVal }
  }, [edges])

  useEffect(() => {
    if (!open) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !imgSize) return
      const { which, startX, startY, startVal } = dragRef.current
      const dx = (e.clientX - startX) / scale
      const dy = (e.clientY - startY) / scale
      setEdges(prev => {
        const next = { ...prev }
        if (which === 'v1') next.left = Math.max(0, Math.min(startVal + dx, imgSize.w - next.right - 1))
        if (which === 'v2') next.right = Math.max(0, Math.min(startVal - dx, imgSize.w - next.left - 1))
        if (which === 'h1') next.top = Math.max(0, Math.min(startVal + dy, imgSize.h - next.bottom - 1))
        if (which === 'h2') next.bottom = Math.max(0, Math.min(startVal - dy, imgSize.h - next.top - 1))
        return next
      })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [open, scale, imgSize])

  const handleSave = async () => {
    if (!workspacePath) return
    const hasValue = edges.left || edges.top || edges.right || edges.bottom
    await api.setSliceMeta(workspacePath, image, hasValue ? edges : null)
    onSaved?.()
    onClose()
  }

  const handleClear = () => setEdges({ left: 0, top: 0, right: 0, bottom: 0 })

  const v1X = edges.left * scale
  const v2X = displayW - edges.right * scale
  const h1Y = edges.top * scale
  const h2Y = displayH - edges.bottom * scale

  return (
    <Modal
      title={`九宫格编辑 - ${image.split('/').pop()}`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      width={680}
      destroyOnClose
    >
      <div ref={containerRef} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* 图片 + 参考线 */}
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          {imgUrl && (
            <img
              src={imgUrl}
              alt="slice"
              style={{ display: 'block', maxWidth: '100%', userSelect: 'none', border: '1px solid #3a4258' }}
              width={displayW || undefined}
              height={displayH || undefined}
            />
          )}
          {/* 参考线 */}
          {imgSize && (
            <>
              {/* v1 左竖线 */}
              <div
                onMouseDown={(e) => startDrag('v1', e)}
                style={{
                  position: 'absolute', left: v1X, top: 0, bottom: 0, width: 2,
                  background: '#5ab9ff', cursor: 'ew-resize',
                }}
              >
                <div style={{ position: 'absolute', top: 0, left: -6, width: 14, height: 14, background: '#5ab9ff', borderRadius: 2, cursor: 'ew-resize' }} />
              </div>
              {/* v2 右竖线 */}
              <div
                onMouseDown={(e) => startDrag('v2', e)}
                style={{
                  position: 'absolute', left: v2X, top: 0, bottom: 0, width: 2,
                  background: '#5ab9ff', cursor: 'ew-resize',
                }}
              >
                <div style={{ position: 'absolute', top: 0, left: -6, width: 14, height: 14, background: '#5ab9ff', borderRadius: 2, cursor: 'ew-resize' }} />
              </div>
              {/* h1 上横线 */}
              <div
                onMouseDown={(e) => startDrag('h1', e)}
                style={{
                  position: 'absolute', top: h1Y, left: 0, right: 0, height: 2,
                  background: '#5ab9ff', cursor: 'ns-resize',
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: -6, width: 14, height: 14, background: '#5ab9ff', borderRadius: 2, cursor: 'ns-resize' }} />
              </div>
              {/* h2 下横线 */}
              <div
                onMouseDown={(e) => startDrag('h2', e)}
                style={{
                  position: 'absolute', top: h2Y, left: 0, right: 0, height: 2,
                  background: '#5ab9ff', cursor: 'ns-resize',
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: -6, width: 14, height: 14, background: '#5ab9ff', borderRadius: 2, cursor: 'ns-resize' }} />
              </div>
            </>
          )}
        </div>

        {/* 右侧：数值 + 预览 */}
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          {imgSize && (
            <div style={{ fontSize: 11, color: '#5b6378', marginBottom: 8 }}>
              图片尺寸: {imgSize.w} x {imgSize.h}
            </div>
          )}
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 32, fontSize: 12, color: '#9aa3b4' }}>左</span>
              <InputNumber size="small" value={edges.left} onChange={v => setEdges(prev => ({ ...prev, left: v ?? 0 }))} style={{ flex: 1 }} min={0} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 32, fontSize: 12, color: '#9aa3b4' }}>上</span>
              <InputNumber size="small" value={edges.top} onChange={v => setEdges(prev => ({ ...prev, top: v ?? 0 }))} style={{ flex: 1 }} min={0} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 32, fontSize: 12, color: '#9aa3b4' }}>右</span>
              <InputNumber size="small" value={edges.right} onChange={v => setEdges(prev => ({ ...prev, right: v ?? 0 }))} style={{ flex: 1 }} min={0} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 32, fontSize: 12, color: '#9aa3b4' }}>下</span>
              <InputNumber size="small" value={edges.bottom} onChange={v => setEdges(prev => ({ ...prev, bottom: v ?? 0 }))} style={{ flex: 1 }} min={0} />
            </div>
            <Button size="small" icon={<DeleteOutlined />} onClick={handleClear} block>清除</Button>
          </Space>

          {/* 九宫格拉伸预览 */}
          {imgSize && (edges.left || edges.top || edges.right || edges.bottom) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#5b6378', marginBottom: 4 }}>拉伸预览 (2x)</div>
              <SlicePreview imgUrl={imgUrl} imgW={imgSize.w} imgH={imgSize.h} edges={edges} scale={scale} displayW={displayW * 1.5} displayH={displayH * 1.5} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// 九宫格拉伸预览：用 CSS border-image 模拟
function SlicePreview({ imgUrl, imgW, imgH, edges, displayW, displayH }: {
  imgUrl: string
  imgW: number
  imgH: number
  edges: Edges
  scale: number
  displayW: number
  displayH: number
}) {
  const sliceStr = `${edges.top / imgH * 100}% ${edges.right / imgW * 100}% ${edges.bottom / imgH * 100}% ${edges.left / imgW * 100}%`
  return (
    <div style={{
      width: Math.min(displayW, 240),
      height: Math.min(displayH, 160),
      borderImage: `url(${imgUrl}) ${sliceStr} fill`,
      borderStyle: 'solid',
      borderWidth: 0,
      background: 'transparent',
    }} />
  )
}

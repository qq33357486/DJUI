import { useRef, useState } from 'react'

interface ResizeHandleProps {
  /** 拖拽开始（指针按下）时触发，用于记录起始宽度 */
  onDragStart?: () => void
  /** 拖拽中持续触发（dx 为相对起点的水平位移，向右为正） */
  onDrag: (dx: number) => void
  /** 拖拽结束（松手）时触发，携带总位移 */
  onDragEnd: (dx: number) => void
  /** 双击手柄：恢复默认宽度 */
  onReset?: () => void
  /** 手柄贴在面板哪条边（只决定视觉位置，拖拽方向由消费方按语义计算） */
  edge?: 'right' | 'left'
}

/**
 * 面板宽度拖拽手柄：贴在面板左右边缘、骑缝 8px 命中区（样式见 index.css 的 .djui-resize-handle）。
 * 用 pointer capture 保证拖到画布/其它元素上方也不丢事件；悬停和拖拽时显示蓝色指示线。
 */
export default function ResizeHandle({ onDragStart, onDrag, onDragEnd, onReset, edge = 'right' }: ResizeHandleProps) {
  const startX = useRef(0)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 指针已失效时跳过，拖拽仍可用 */ }
    startX.current = e.clientX
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    onDragStart?.()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    onDrag(e.clientX - startX.current)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    onDragEnd(e.clientX - startX.current)
  }

  return (
    <div
      className={`djui-resize-handle ${edge === 'right' ? 'is-right' : 'is-left'}${dragging ? ' is-dragging' : ''}`}
      title={onReset ? '拖拽调整宽度，双击恢复默认' : '拖拽调整宽度'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onReset?.()}
    />
  )
}

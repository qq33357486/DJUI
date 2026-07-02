import { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Checkbox, Badge, Empty, Spin, message } from 'antd'
import { CheckOutlined, DeleteOutlined } from '@ant-design/icons'
import * as api from '@/api/client'
import { useProjectStore } from '@/store/projectStore'

interface ReviewPanelProps {
  open: boolean
  onClose: () => void
}

export default function ReviewPanel({ open, onClose }: ReviewPanelProps) {
  const { config } = useProjectStore()
  const workspacePath = config?.workspacePath ?? ''
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    try {
      const g = await api.getPendingReview(workspacePath)
      setGroups(g)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const allFiles = Object.values(groups).flat()
  const totalCount = allFiles.length

  const toggle = (file: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const toggleCategory = (cat: string) => {
    const catFiles = groups[cat] || []
    const allSelected = catFiles.every(f => selected.has(f))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) {
        catFiles.forEach(f => next.delete(f))
      } else {
        catFiles.forEach(f => next.add(f))
      }
      return next
    })
  }

  const handleApprove = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      const result = await api.approveFiles(workspacePath, Array.from(selected))
      message.success(`已审批通过 ${result.moved} 个素材`)
      setSelected(new Set())
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      const result = await api.rejectFiles(workspacePath, Array.from(selected))
      message.success(`已拒绝 ${result.deleted} 个素材`)
      setSelected(new Set())
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>待审核素材</span>
          {totalCount > 0 && <Badge count={totalCount} style={{ backgroundColor: '#faad14' }} />}
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={
        totalCount > 0 ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#5b6378', lineHeight: '32px' }}>
              已选 {selected.size} / {totalCount}
            </span>
            <div>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleReject}
                disabled={selected.size === 0}
                style={{ marginRight: 8 }}
              >
                拒绝选中
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleApprove}
                disabled={selected.size === 0}
              >
                批准选中
              </Button>
            </div>
          </div>
        ) : null
      }
      width={760}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {totalCount === 0 ? (
          <Empty description="没有待审核的素材" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '40px 0' }} />
        ) : (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {Object.entries(groups).map(([cat, files]) => {
              const catFiles = files || []
              const allSel = catFiles.every(f => selected.has(f))
              return (
                <div key={cat} style={{ marginBottom: 16 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}
                    onClick={() => toggleCategory(cat)}
                  >
                    <Checkbox checked={allSel} />
                    <span style={{ fontWeight: 600, color: '#9aa3b4' }}>{cat}</span>
                    <Badge count={catFiles.length} style={{ backgroundColor: '#2a3142' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, paddingLeft: 24 }}>
                    {catFiles.map(f => {
                      const fileName = f.split('/').pop() || f
                      const url = api.assetFileUrl(`${workspacePath}/${f}`.replace(/\\/g, '/'))
                      const isSel = selected.has(f)
                      return (
                        <div
                          key={f}
                          onClick={() => toggle(f)}
                          style={{
                            cursor: 'pointer',
                            border: isSel ? '2px solid #5ab9ff' : '2px solid #2a3142',
                            borderRadius: 6,
                            padding: 4,
                            background: '#1a1d28',
                            overflow: 'hidden',
                          }}
                        >
                          <img
                            src={url}
                            alt={fileName}
                            style={{ width: '100%', height: 72, objectFit: 'contain', display: 'block' }}
                          />
                          <div style={{ fontSize: 10, color: '#5b6378', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {fileName}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Spin>
    </Modal>
  )
}

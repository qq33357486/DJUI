// 页面外部修改冲突处理弹窗（检测到磁盘被 AI 等外部工具改写、且编辑器内存有未保存修改时弹出）
// focus 模式：回到编辑器时的同步提醒；publish 模式：发布前的强制门禁
import { Button, Modal, Space } from 'antd'
import { FileSyncOutlined, WarningOutlined } from '@ant-design/icons'
import type { ExternalChange } from '@/lib/pageSync'

export type ConflictResolution = 'disk' | 'local'

interface SyncConflictModalProps {
  open: boolean
  mode: 'focus' | 'publish'
  conflicts: ExternalChange[]
  resolving?: boolean
  onResolve: (resolution: ConflictResolution) => void
  onClose: () => void
}

function describeConflict(change: ExternalChange): string {
  if (change.type === 'deleted') {
    return `页面「${change.pageId}」已被外部删除，但编辑器中有未保存的修改`
  }
  return `页面「${change.pageId}」在磁盘上被外部修改（可能是 AI 直接编辑），编辑器中也有未保存的修改`
}

export default function SyncConflictModal(props: SyncConflictModalProps) {
  const { open, mode, conflicts, resolving, onResolve, onClose } = props
  if (conflicts.length === 0) return null
  const isPublish = mode === 'publish'

  return (
    <Modal
      open={open}
      title={
        <span>
          <FileSyncOutlined style={{ color: '#ff8c42', marginRight: 8 }} />
          {isPublish ? '发布前需处理被外部修改的页面' : '检测到页面被外部修改'}
        </span>
      }
      closable={!resolving}
      maskClosable={false}
      width={520}
      onCancel={() => { if (!resolving) onClose() }}
      footer={
        <Space>
          <Button disabled={resolving} onClick={onClose}>
            {isPublish ? '取消发布' : '稍后处理'}
          </Button>
          <Button disabled={resolving} onClick={() => onResolve('local')}>
            {isPublish ? '以编辑器版本发布' : '保留我的版本'}
          </Button>
          <Button type="primary" loading={resolving} onClick={() => onResolve('disk')}>
            {isPublish ? '以磁盘版本发布' : '采用磁盘版本'}
          </Button>
        </Space>
      }
    >
      <div style={{ fontSize: 13 }}>
        <ul style={{ paddingLeft: 18, margin: '4px 0 12px' }}>
          {conflicts.map(change => (
            <li key={change.pageId + ':' + change.type} style={{ marginBottom: 4 }}>
              {describeConflict(change)}
            </li>
          ))}
        </ul>
        <div style={{ padding: '8px 10px', borderRadius: 6, background: '#f6f8fa', color: '#5b6378', fontSize: 12 }}>
          <p style={{ margin: 0 }}>
            <WarningOutlined style={{ color: '#ff8c42', marginRight: 6 }} />
            {isPublish
              ? '「以磁盘版本发布」将丢弃这些页面的本地修改，全部按磁盘内容发布；「以编辑器版本发布」中，当前打开的页面会覆盖磁盘上的外部修改，未打开页面的本地修改不写入磁盘，发布仍使用其磁盘版本。'
              : '「采用磁盘版本」将丢弃编辑器中这些页面的未保存修改；「保留我的版本」保留编辑器内容，下次保存时会覆盖磁盘上的外部修改。'}
          </p>
        </div>
      </div>
    </Modal>
  )
}

import { Modal, Timeline, Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  BugOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'
import { CHANGELOG, APP_VERSION } from '@/lib/changelog'
import { useEffect, useRef } from 'react'

const { Text } = Typography

const LAST_SEEN_KEY = 'djui.lastSeenVersion'

// 分类 → 图标 + 颜色
const CATEGORY_STYLE: Record<string, { icon: React.ReactNode; color: string }> = {
  '新增': { icon: <CheckCircleOutlined />, color: '#52c41a' },
  '修复': { icon: <BugOutlined />, color: '#ff4d4f' },
  '优化': { icon: <ThunderboltOutlined />, color: '#5ab9ff' },
  '破坏性变更': { icon: <WarningOutlined />, color: '#fa8c16' },
  '移除': { icon: <MinusCircleOutlined />, color: '#8c8c8c' },
}

interface WhatsNewModalProps {
  open: boolean
  onClose: () => void
}

export default function WhatsNewModal({ open, onClose }: WhatsNewModalProps) {
  const latestVersion = CHANGELOG[0]?.version
  const isLatest = (version: string) => version === latestVersion
  const highlightRef = useRef<HTMLDivElement>(null)

  // 高亮闪烁动画：打开时滚动到最新版本并触发 CSS 动画
  useEffect(() => {
    if (open && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [open])

  const handleClose = () => {
    localStorage.setItem(LAST_SEEN_KEY, APP_VERSION)
    onClose()
  }

  return (
    <Modal
      title={`更新公告 - v${APP_VERSION}`}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={580}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      <Timeline
        items={CHANGELOG.map((entry) => {
          const latest = isLatest(entry.version)
          return {
            color: latest ? 'blue' : 'gray',
            children: (
              <div
                ref={latest ? highlightRef : undefined}
                className={latest ? 'djui-whats-new-highlight' : undefined}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  marginBottom: 4,
                  background: latest ? 'rgba(90, 185, 255, 0.08)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 15 }}>
                    v{entry.version}
                  </Text>
                  {entry.date && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {entry.date}
                    </Text>
                  )}
                  {latest && (
                    <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', margin: 0, padding: '0 4px' }}>
                      最新
                    </Tag>
                  )}
                </div>
                {entry.sections.map((section, si) => {
                  const style = CATEGORY_STYLE[section.category]
                  return (
                    <div key={si} style={{ marginBottom: si < entry.sections.length - 1 ? 6 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ color: style?.color ?? '#5b6378', fontSize: 13 }}>
                          {style?.icon}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: style?.color ?? '#5b6378' }}>
                          {section.category}
                        </span>
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 22, listStyleType: 'disc' }}>
                        {section.items.map((item, ii) => (
                          <li key={ii} style={{ fontSize: 13, color: '#dfe2e8', lineHeight: 1.6, marginBottom: 2 }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            ),
          }
        })}
      />
    </Modal>
  )
}

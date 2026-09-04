import { useState } from 'react'
import { Modal, InputNumber, Switch, Empty, Spin, message } from 'antd'
import { useProjectStore } from '@/store/projectStore'
import { useEditorStore } from '@/store/editorStore'

/**
 * 窗口池配置（编辑菜单 → 窗口池配置）。
 * 常驻复用的统一管理入口：清单式展示所有窗口页面（已开启排前），逐页开关即时保存；
 * 窗口池容量控制非常驻页面的保留数量。数据落 project.json（retainedPages / poolCapacity），
 * 与各页面属性栏「窗口」分组里的「常驻复用」开关同源。
 */
export default function PoolConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { config, setConfig } = useProjectStore()
  const allPages = useEditorStore(state => state.allPages)
  const [saving, setSaving] = useState(false)

  const retained = config?.retainedPages ?? []
  const windowPages = Object.values(allPages)
    .filter(page => page.nodeKind === 'window')
    .sort((a, b) => {
      const ra = retained.includes(a.pageId) ? 0 : 1
      const rb = retained.includes(b.pageId) ? 0 : 1
      return ra - rb || a.pageId.localeCompare(b.pageId, 'zh-Hans-CN')
    })

  const save = async (patch: { retainedPages?: string[]; poolCapacity?: number }) => {
    if (!config) return
    setSaving(true)
    try {
      await setConfig({ ...config, ...patch })
    } catch (error) {
      message.error(error instanceof Error ? `保存窗口池配置失败：${error.message}` : '保存窗口池配置失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleRetained = (pageId: string, checked: boolean) => {
    const list = new Set(retained)
    if (checked) list.add(pageId)
    else list.delete(pageId)
    void save({ retainedPages: [...list] })
  }

  return (
    <Modal
      title="窗口池配置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={540}
      destroyOnClose={false}
    >
      <div style={{ fontSize: 12, color: '#5b6378', marginBottom: 16, lineHeight: 1.7 }}>
        开启「常驻复用」的页面关闭后不销毁、常驻隐藏池，重开直接复用不重建（适合确认框等连开连关的高频页）。
        未开启的页面进入窗口池按容量先进先出复用，池满淘汰最久未用的页面。
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>窗口池容量</span>
        <InputNumber
          min={0}
          max={100}
          precision={0}
          step={1}
          style={{ width: 120 }}
          value={config?.poolCapacity ?? 5}
          onChange={value => {
            if (typeof value === 'number') void save({ poolCapacity: value })
          }}
        />
        <span style={{ fontSize: 12, color: '#9aa3b4' }}>0＝只有常驻复用页面会保留</span>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        常驻复用页面
        {saving && <Spin size="small" style={{ marginLeft: 8 }} />}
      </div>
      {windowPages.length === 0 ? (
        <Empty description="暂无窗口页面" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e5e9f0', borderRadius: 8, padding: '4px 12px' }}>
          {windowPages.map(page => {
            const on = retained.includes(page.pageId)
            return (
              <div
                key={page.pageId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 0', borderBottom: '1px solid #f0f2f6',
                }}
              >
                <span style={{ fontSize: 13, color: on ? '#1f2733' : '#5b6378', fontWeight: on ? 600 : 400 }}>
                  {page.pageId}
                </span>
                <Switch size="small" checked={on} onChange={checked => toggleRetained(page.pageId, checked)} />
              </div>
            )
          })}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#9aa3b4', marginTop: 10 }}>
        也可以在各页面右侧属性栏「窗口」分组里单独勾选，两处配置同源。
      </div>
    </Modal>
  )
}

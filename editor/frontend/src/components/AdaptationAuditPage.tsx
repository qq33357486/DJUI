import { useMemo, useState } from 'react'
import { Button, Empty, Tag } from 'antd'
import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import { useEditorStore } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'
import { devicePresetsForOrientationV6, type DevicePresetV6 } from '@/lib/devicePresetsV6'
import { auditPageAdaptation, computeImageFrameForAudit, type AdaptationAuditResult } from '@/utils/adaptationAudit'
import { createCanvasPlanV6 } from '@/utils/viewportV6'
import { StaticViewportPreview } from '@/components/CanvasArea'
import * as api from '@/api/client'
import type { UiNode } from '@/types/layout'

interface AdaptationAuditPageProps {
  onBack: () => void
}

function applyFieldPath(target: Record<string, unknown>, fieldPath: string, value: unknown) {
  const parts = fieldPath.split('.')
  let obj = target
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index]
    const next = obj[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) obj[key] = {}
    obj = obj[key] as Record<string, unknown>
  }
  obj[parts[parts.length - 1]] = value
}

function cloneWideRoot(root: UiNode, overrides?: Record<string, Record<string, unknown>>): UiNode {
  const cloned: UiNode = JSON.parse(JSON.stringify(root))
  const visit = (node: UiNode) => {
    for (const [fieldPath, value] of Object.entries(overrides?.[node.id] ?? {})) {
      applyFieldPath(node as unknown as Record<string, unknown>, fieldPath, value)
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(cloned)
  return cloned
}

function issueCounts(result: AdaptationAuditResult) {
  return {
    errors: result.issues.filter(issue => issue.level === 'error').length,
    warnings: result.issues.filter(issue => issue.level === 'warning').length,
  }
}

function issueColor(result: AdaptationAuditResult) {
  const counts = issueCounts(result)
  return counts.errors > 0 ? '#ff7875' : counts.warnings > 0 ? '#f4b400' : '#52c41a'
}

export default function AdaptationAuditPage({ onBack }: AdaptationAuditPageProps) {
  const page = useEditorStore(state => state.page)
  const config = useProjectStore(state => state.config)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rows = useMemo(() => {
    if (!page || !config) return []
    const project = api.createProjectFileV6(config)
    const wideRoot = cloneWideRoot(page.root, page.responsive?.wide.overrides)
    return devicePresetsForOrientationV6(config.orientation).map(device => {
      const plan = createCanvasPlanV6(device.widthPx, device.heightPx, device.safeInsetsPx, project)
      const root = plan.wide ? wideRoot : page.root
      const frame = computeImageFrameForAudit(root, plan.canvasRect, plan.safeRect)
      const result = auditPageAdaptation(root, plan.canvasRect, plan.safeRect, device, frame)
      return { device, wide: plan.wide, root, result }
    })
  }, [page, config])

  const selected = rows.find(row => row.device.id === selectedId) ?? rows[0]

  const viewOnCanvas = (device: DevicePresetV6, wide: boolean) => {
    window.dispatchEvent(new CustomEvent('djui:selectDevicePreview', {
      detail: { presetId: device.id, variant: wide ? 'wide' : 'base' },
    }))
    onBack()
  }

  if (!page || !config) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: '#0f1117' }}><Empty description="请先打开一个页面和工程配置" /></div>
  }

  return (
    <div style={{ height: '100%', minHeight: 0, background: '#0f1117', color: '#dfe7f5', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px', borderBottom: '1px solid #2a3142' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回编辑</Button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>适配审计</div>
          <div style={{ color: '#9aa3b4', marginTop: 3, fontSize: 12 }}>
            {page.pageId} · {config.orientation === 'portrait' ? '竖屏项目' : '横屏项目'} · 只展示同方向设备画像
          </div>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)' }}>
        <aside style={{ minHeight: 0, overflow: 'auto', padding: 14, borderRight: '1px solid #2a3142', background: '#121621' }}>
          <div style={{ color: '#9aa3b4', fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
            同一比例只保留一个布局画像；只有安全区或硬件遮挡不同，才单列设备。
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map(row => {
              const counts = issueCounts(row.result)
              const active = row.device.id === selected?.device.id
              return (
                <button
                  key={row.device.id}
                  onClick={() => setSelectedId(row.device.id)}
                  style={{ textAlign: 'left', cursor: 'pointer', color: '#dfe7f5', background: active ? '#1e3048' : '#151924', border: '1px solid ' + (active ? '#5ab9ff' : '#2a3142'), borderRadius: 8, padding: '10px 11px' }}
                >
                  <strong style={{ display: 'block', fontSize: 12, lineHeight: 1.45 }}>{row.device.label}</strong>
                  <span style={{ display: 'block', marginTop: 5, fontSize: 11, color: issueColor(row.result) }}>
                    {counts.errors} 错误 / {counts.warnings} 警告
                  </span>
                </button>
              )
            })}
          </div>

          {selected && (
            <section style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #2a3142' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{selected.device.label}</strong>
                <Button size="small" icon={<EyeOutlined />} onClick={() => viewOnCanvas(selected.device, selected.wide)}>画布</Button>
              </div>
              <div style={{ marginTop: 8 }}><Tag color={selected.wide ? 'orange' : 'blue'}>{selected.wide ? '宽屏层' : '基础层'}</Tag></div>
              <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
                {selected.result.issues.length === 0 ? (
                  <span style={{ color: '#83d9b4', fontSize: 12 }}>未发现确定的几何风险。</span>
                ) : selected.result.issues.map((issue, index) => (
                  <div key={issue.nodeId + '-' + index} style={{ borderLeft: '3px solid ' + (issue.level === 'error' ? '#ff7875' : '#f4b400'), background: '#10141d', padding: '7px 8px', borderRadius: 3, fontSize: 12 }}>
                    <strong style={{ color: issue.level === 'error' ? '#ff9c9c' : '#ffd36a' }}>{issue.nodeName}</strong><br />
                    <span style={{ color: '#c4ccda' }}>{issue.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>

        <main style={{ minWidth: 0, minHeight: 0, overflow: 'auto', padding: 18 }}>
          <div style={{ color: '#9aa3b4', fontSize: 12, marginBottom: 14 }}>
            全部预览：绿色虚线为安全区；红色为刘海/摄像孔，黄色为系统手势或曲面触控边缘。点击窗口可查看该设备的风险明细。
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 14, alignItems: 'start' }}>
            {rows.map(row => {
              const counts = issueCounts(row.result)
              const active = row.device.id === selected?.device.id
              const viewportHeight = row.device.orientation === 'portrait' ? 310 : 175
              return (
                <button
                  key={row.device.id}
                  onClick={() => setSelectedId(row.device.id)}
                  style={{ cursor: 'pointer', textAlign: 'left', color: '#dfe7f5', background: '#151924', border: '1px solid ' + (active ? '#5ab9ff' : issueColor(row.result)), borderRadius: 10, overflow: 'hidden', padding: 0 }}
                >
                  <div style={{ height: viewportHeight, background: '#0d0f15', display: 'grid', placeItems: 'center' }}>
                    <StaticViewportPreview root={row.root} config={config} device={row.device} workspacePath={config.workspacePath} projectPath={config.starProjectPath} width={225} height={viewportHeight} />
                  </div>
                  <div style={{ padding: '9px 10px 10px' }}>
                    <strong style={{ display: 'block', fontSize: 12 }}>{row.device.label}</strong>
                    <span style={{ display: 'block', marginTop: 5, color: issueColor(row.result), fontSize: 11 }}>{counts.errors} 错误 / {counts.warnings} 警告</span>
                  </div>
                </button>
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
}

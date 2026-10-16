// 静态点击不可达确认弹窗（手动保存 / 冲突覆盖保存 / 批量重存 / 发布 共用）：
// 「绑定动作 + 静态」的节点渲染正常、动作也绑定成功，但引擎不派发点击——真人点击无响应
// （2026-10-16 阵容页事故防线）。只警示不阻塞：可「仍要保存/仍要发布」或「返回修改」。
import { Modal } from 'antd'
import type { StaticClickPageReport } from '@/api/client'

export function confirmStaticClickBlock(reports: StaticClickPageReport[], scope: 'save' | 'publish'): Promise<boolean> {
  const total = reports.reduce((sum, report) => sum + report.issues.length, 0)
  // 文案区分语境：发布=「发布范围内」；批量保存多页=「本次批量保存的页面中」；单页保存=「当前页面」
  const scopeText = scope === 'publish' ? '发布范围内' : reports.length > 1 ? '本次批量保存的页面中' : '当前页面'
  return new Promise<boolean>(resolve => {
    Modal.confirm({
      title: '绑定动作的节点被设为「静态」，点击将无响应',
      content: (
        <div style={{ fontSize: 13 }}>
          <p>
            {reports.length > 1
              ? `${scopeText} ${reports.length} 个页面共有 ${total} 个绑定动作的节点被设为静态，真人点击将无响应。`
              : `${scopeText}有 ${total} 个绑定动作的节点被设为静态，真人点击将无响应。`}
          </p>
          <ul style={{ margin: '8px 0', paddingLeft: 20, maxHeight: 200, overflow: 'auto' }}>
            {/* 单页保存展示节点路径明细（含 id，便于精确定位）；发布/批量多页按页面汇总防刷屏 */}
            {reports.length > 1 || scope === 'publish'
              ? reports.map(report => (
                <li key={report.file}>
                  「{report.displayName}」{report.issues.length} 个：
                  {report.issues.slice(0, 3).map(issue => `「${issue.nodeName}」`).join('、')}
                  {report.issues.length > 3 ? ` 等 ${report.issues.length} 个节点` : ''}
                </li>
              ))
              : (reports[0]?.issues ?? []).map(issue => (
                <li key={issue.nodeId || issue.path}>
                  {issue.path}
                  {issue.nodeId ? <span style={{ color: '#888' }}>（id: {issue.nodeId}）</span> : null}
                </li>
              ))}
          </ul>
          <p style={{ color: '#888', fontSize: 12 }}>
            需要响应点击的节点，请在右侧属性面板「基础 → 静态」关闭后再保存；图片组件默认是静态，绑定动作后记得关闭。
          </p>
        </div>
      ),
      okText: scope === 'publish' ? '仍要发布' : '仍要保存',
      cancelText: '返回修改',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

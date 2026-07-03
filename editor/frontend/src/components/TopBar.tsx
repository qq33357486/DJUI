import { Button, Space, Tooltip, Modal, message, Tag, Dropdown, Badge, Select } from 'antd'
import type { MenuProps } from 'antd'
import {
  UndoOutlined, RedoOutlined, SaveOutlined,
  FileAddOutlined, CloudUploadOutlined, FolderOpenOutlined,
  SettingOutlined, ZoomInOutlined, ZoomOutOutlined, ExpandOutlined,
  InfoCircleOutlined, SyncOutlined, CheckCircleOutlined, FontSizeOutlined,
  SoundOutlined, BellOutlined,
} from '@ant-design/icons'
import { useEditorStore } from '@/store/editorStore'
import { useProjectStore } from '@/store/projectStore'
import SoundConfigModal from './SoundConfigModal'
import * as api from '@/api/client'
import { APP_VERSION } from '@/lib/changelog'
import { useState, useCallback, useEffect, useMemo } from 'react'

interface TopBarProps {
  soundSetup: api.SoundSetupStatus | null
  onOpenConfig: () => void
  onNewProject: () => void   // 新建工程（清配置重开）
  onOpenProject: () => void  // 打开工程（选目录）
}

// VS Code 风格菜单栏的单项样式
const menuItemStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '2px 10px',
  cursor: 'default',
  userSelect: 'none',
  lineHeight: '30px',
}

// 带快捷键的菜单项 label
function menuLabel(text: string, shortcut?: string) {
  if (!shortcut) return text
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 160 }}>
      <span>{text}</span>
      <span style={{ color: '#5b6378', fontSize: 11, marginLeft: 24 }}>{shortcut}</span>
    </span>
  )
}

export default function TopBar(props: TopBarProps) {
  const { soundSetup, onOpenConfig, onNewProject, onOpenProject } = props
  const { page, undo, redo, undoStack, redoStack } = useEditorStore()
  const { config, agents, scripts, refreshAgents, refreshScripts } = useProjectStore()
  const [publishing, setPublishing] = useState(false)
  const [updatingAgents, setUpdatingAgents] = useState(false)
  const [updatingScripts, setUpdatingScripts] = useState(false)
  const [globalFontOpen, setGlobalFontOpen] = useState(false)
  const [unifyFontOpen, setUnifyFontOpen] = useState(false)
  const [soundConfigOpen, setSoundConfigOpen] = useState(false)
  const [fontList, setFontList] = useState<string[]>([])
  const [globalFontValue, setGlobalFontValue] = useState<string | null>(null)
  const [unifyFontValue, setUnifyFontValue] = useState<string | null>(null)

  useEffect(() => {
    const openSoundConfig = () => setSoundConfigOpen(true)
    window.addEventListener('djui:openSoundConfig', openSoundConfig)
    return () => window.removeEventListener('djui:openSoundConfig', openSoundConfig)
  }, [])

  const agentsOutdated = agents.status === 'outdated' || agents.status === 'missing'
  const scriptsOutdated = scripts.status === 'outdated' || scripts.status === 'missing'
  const scriptsAvailable = scripts.status !== 'unavailable' && scripts.status !== 'unknown'
  // 合并徽章：任一过期即显示
  const workspaceOutdated = agentsOutdated || scriptsOutdated
  const soundSetupNeedsAttention = !!soundSetup && soundSetup.status !== 'ok'
  const soundSetupTooltip = soundSetup?.status === 'missing-default'
    ? '未选择按钮默认音效；配置后后续创建 Button 会自动带点击音效。'
    : '未配置按钮默认音效；先在星火数编新增 GameDataSound，再到 DJUI 声音配置选择默认音效。配置后后续创建 Button 会自动带点击音效。'

  // 加载字体列表（路径参数已忽略）
  useEffect(() => {
    if (config?.starProjectPath) {
      api.getFonts().then(setFontList)
    }
  }, [config?.starProjectPath])

  const handleSave = useCallback(async () => {
    if (!page) return
    await api.savePage(page)
    message.success('页面已保存')
  }, [page])

  const handlePublish = useCallback(async () => {
    if (!config || !page) { message.warning('请先配置工程并打开页面'); return }
    await api.savePage(page)
    setPublishing(true)
    try {
      const result = await api.publishAssets()
      if (result.ok) {
        Modal.success({
          title: '发布成功',
          content: (
            <div>
              <p>素材：<strong>{result.copiedAssets?.length ?? 0}</strong> 个</p>
              <p>页面：<strong>{result.copiedPages?.length ?? result.copiedClientPages?.length ?? 0}</strong> 个</p>
              <p>音效配置：<strong>{result.copiedSoundsConfig ? 1 : 0}</strong> 个</p>
              <p>配置：<strong>{result.copiedConfig ? 1 : 0}</strong> 个</p>
              {result.warnings && result.warnings.length > 0 && (
                <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 6, background: '#fff7e6', color: '#8a5200', fontSize: 12 }}>
                  {result.warnings.map((warning, index) => (
                    <div key={index}>{warning}</div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#999' }}>
                <div>{result.targetDirs?.images ?? result.targetDir}</div>
                <div>{result.targetDirs?.clientPages}</div>
                {result.targetDirs?.clientSounds && <div>{result.targetDirs.clientSounds}</div>}
                {result.targetDirs?.clientConfig && <div>{result.targetDirs.clientConfig}</div>}
              </div>
            </div>
          ),
        })
      } else { message.error(result.error || '发布失败') }
    } catch { message.error('发布失败') }
    finally { setPublishing(false) }
  }, [config, page])

  // 检查 AGENTS 规范更新
  const handleCheckAgents = useCallback(async () => {
    if (!config?.workspacePath) return
    await refreshAgents()
    const s = useProjectStore.getState().agents
    if (s.status === 'ok') {
      message.success(`AGENTS.md 已是最新版本 v${s.latestVersion}`)
    } else if (s.status === 'outdated' || s.status === 'missing') {
      promptUpdateAgents(s.installedVersion, s.latestVersion, s.message)
    } else {
      message.warning('无法检查更新：' + (s.message ?? '未知'))
    }
  }, [config?.workspacePath, refreshAgents])

  // 弹窗确认更新 AGENTS
  const promptUpdateAgents = (installed: string | null, latest: string | null, msg?: string | null) => {
    Modal.confirm({
      title: '更新工作区 AGENTS.md',
      content: (
        <div style={{ fontSize: 13 }}>
          <p>{msg ?? '检测到工作区的 AGENTS.md 规范文件已过期。'}</p>
          <p>
            当前版本：<strong>{installed ?? '无（旧版）'}</strong>
            {' → '}最新版本：<strong style={{ color: '#5ab9ff' }}>v{latest}</strong>
          </p>
          <p style={{ color: '#888', fontSize: 12 }}>
            更新会整文件覆盖工作区的 <code>AGENTS.md</code>（旧文件会备份为 <code>AGENTS.md.bak</code>）。<br />
            你的素材目录不受影响。
          </p>
        </div>
      ),
      okText: '立即更新',
      cancelText: '稍后',
      onOk: async () => {
        if (!config?.workspacePath) return
        setUpdatingAgents(true)
        try {
          const r = await api.updateAgents()
          if (r.ok) {
            message.success(r.message ?? 'AGENTS.md 已更新')
            await refreshAgents()
          } else {
            message.error(r.error ?? '更新失败')
          }
        } catch {
          message.error('更新失败')
        } finally {
          setUpdatingAgents(false)
        }
      },
    })
  }

  // 检查脚本区更新
  const handleCheckScripts = useCallback(async () => {
    if (!config?.workspacePath) return
    await refreshScripts()
    const s = useProjectStore.getState().scripts
    if (s.status === 'ok') {
      message.success(`脚本区已是最新版本 v${s.latestVersion}`)
    } else if (s.status === 'outdated' || s.status === 'missing') {
      promptUpdateScripts(s.installedVersion, s.latestVersion, s.message)
    } else if (s.status === 'unavailable') {
      message.warning('脚本同步不可用：' + (s.message ?? ''))
    } else {
      message.warning('无法检查：' + (s.message ?? '未知'))
    }
  }, [config?.workspacePath, refreshScripts])

  // 弹窗确认更新脚本区
  const promptUpdateScripts = (installed: string | null, latest: string | null, msg?: string | null) => {
    Modal.confirm({
      title: '更新工作区「脚本区」',
      content: (
        <div style={{ fontSize: 13 }}>
          <p>{msg ?? '检测到工作区「脚本区」的工具脚本已过期。'}</p>
          <p>
            当前版本：<strong>{installed ?? '无'}</strong>
            {' → '}最新版本：<strong style={{ color: '#5ab9ff' }}>v{latest}</strong>
          </p>
          <p style={{ color: '#888', fontSize: 12 }}>
            更新会整目录覆盖工作区的 <code>脚本区/</code>（旧目录会备份为 <code>脚本区.bak/</code>）。<br />
            包含 <code>green_key_to_png.py</code>（去绿幕）、<code>trim_compress.py</code>（裁边+压缩）等工具。
          </p>
        </div>
      ),
      okText: '立即更新',
      cancelText: '稍后',
      onOk: async () => {
        if (!config?.workspacePath) return
        setUpdatingScripts(true)
        try {
          const r = await api.updateScripts()
          if (r.ok) {
            message.success(r.message ?? '脚本区已更新')
            await refreshScripts()
          } else {
            message.error(r.error ?? '更新失败')
          }
        } catch {
          message.error('更新失败')
        } finally {
          setUpdatingScripts(false)
        }
      },
    })
  }

  // 一键检查工作区全部更新（AGENTS + 脚本）
  const handleCheckWorkspace = useCallback(async () => {
    if (!config?.workspacePath) return
    await Promise.all([
      refreshAgents(),
      refreshScripts(),
    ])
    const a = useProjectStore.getState().agents
    const s = useProjectStore.getState().scripts
    const outdated: string[] = []
    if (a.status === 'outdated' || a.status === 'missing') outdated.push('AGENTS.md')
    if (s.status === 'outdated' || s.status === 'missing') outdated.push('脚本区')

    if (outdated.length === 0) {
      const vParts: string[] = []
      if (a.latestVersion) vParts.push(`AGENTS v${a.latestVersion}`)
      if (s.latestVersion) vParts.push(`脚本 v${s.latestVersion}`)
      message.success(`工作区全部最新（${vParts.join('，')}）`)
      return
    }

    // 有过期项：弹合并更新窗口
    promptUpdateWorkspace(a, s, outdated)
  }, [config?.workspacePath, refreshAgents, refreshScripts])

  // 工作区合并更新弹窗
  const promptUpdateWorkspace = (
    a: typeof agents,
    s: typeof scripts,
    outdated: string[]
  ) => {
    Modal.confirm({
      title: '更新工作区配置',
      content: (
        <div style={{ fontSize: 13 }}>
          <p>检测到以下工作区文件已过期：</p>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            {outdated.map(item => (
              <li key={item}>
                <strong>{item}</strong>
                {item === 'AGENTS.md' && (
                  <span>（{a.installedVersion ?? '旧版'} → v{a.latestVersion}）</span>
                )}
                {item === '脚本区' && (
                  <span>（{s.installedVersion ?? '无'} → v{s.latestVersion}）</span>
                )}
              </li>
            ))}
          </ul>
          <p style={{ color: '#888', fontSize: 12 }}>
            点击「全部更新」会逐项覆盖（旧文件/目录备份为 <code>.bak</code>），素材目录不受影响。
          </p>
        </div>
      ),
      okText: '全部更新',
      cancelText: '稍后',
      onOk: async () => {
        if (!config?.workspacePath) return
        const results: string[] = []
        if (outdated.includes('AGENTS.md')) {
          setUpdatingAgents(true)
          try {
            const r = await api.updateAgents()
            results.push(r.ok ? `AGENTS.md → v${r.version}` : `AGENTS.md 失败: ${r.error}`)
          } catch (e) { results.push(`AGENTS.md 失败: ${String(e)}`) }
          finally { setUpdatingAgents(false) }
        }
        if (outdated.includes('脚本区')) {
          setUpdatingScripts(true)
          try {
            const r = await api.updateScripts()
            results.push(r.ok ? `脚本区 → v${r.version}（${r.copiedFiles?.length ?? 0} 文件）` : `脚本区 失败: ${r.error}`)
          } catch (e) { results.push(`脚本区 失败: ${String(e)}`) }
          finally { setUpdatingScripts(false) }
        }
        await Promise.all([refreshAgents(), refreshScripts()])
        Modal.success({
          title: '工作区更新完成',
          content: (
            <ul style={{ paddingLeft: 20 }}>
              {results.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          ),
        })
      },
    })
  }

  // === 菜单定义 ===

  const fileMenu: MenuProps['items'] = [
    {
      key: 'new-project',
      label: '新建工程',
      icon: <FileAddOutlined />,
      onClick: () => onNewProject(),
    },
    {
      key: 'open-project',
      label: '打开工程',
      icon: <FolderOpenOutlined />,
      onClick: () => onOpenProject(),
    },
    { type: 'divider' },
    {
      key: 'config',
      label: '工程配置...',
      icon: <SettingOutlined />,
      onClick: () => onOpenConfig(),
    },
    { type: 'divider' },
    {
      key: 'save',
      label: menuLabel('保存窗口', 'Ctrl+S'),
      icon: <SaveOutlined />,
      onClick: handleSave,
    },
  ]

  const editMenu: MenuProps['items'] = [
    {
      key: 'undo',
      label: menuLabel('撤销', 'Ctrl+Z'),
      disabled: undoStack.length === 0,
      onClick: undo,
    },
    {
      key: 'redo',
      label: menuLabel('重做', 'Ctrl+Y'),
      disabled: redoStack.length === 0,
      onClick: redo,
    },
    { type: 'divider' },
    {
      key: 'global-font',
      label: '全局字体设置',
      icon: <FontSizeOutlined />,
      onClick: () => { setGlobalFontValue(config?.defaultFont ?? null); setGlobalFontOpen(true) },
    },
    {
      key: 'unify-font',
      label: '统一所有控件字体',
      icon: <FontSizeOutlined />,
      onClick: () => { setUnifyFontValue(config?.defaultFont ?? null); setUnifyFontOpen(true) },
    },
    {
      key: 'sound-config',
      label: '声音配置',
      icon: <SoundOutlined />,
      onClick: () => setSoundConfigOpen(true),
    },
  ]

  const viewMenu: MenuProps['items'] = [
    {
      key: 'zoom-in',
      label: menuLabel('放大', 'Ctrl++'),
      icon: <ZoomInOutlined />,
      onClick: () => window.dispatchEvent(new CustomEvent('djui:zoomIn')),
    },
    {
      key: 'zoom-out',
      label: menuLabel('缩小', 'Ctrl+-'),
      icon: <ZoomOutOutlined />,
      onClick: () => window.dispatchEvent(new CustomEvent('djui:zoomOut')),
    },
    {
      key: 'zoom-reset',
      label: menuLabel('重置缩放', 'Ctrl+0'),
      onClick: () => window.dispatchEvent(new CustomEvent('djui:zoomReset')),
    },
    {
      key: 'zoom-fit',
      label: menuLabel('适配到窗口', 'Ctrl+Shift+F'),
      icon: <ExpandOutlined />,
      onClick: () => window.dispatchEvent(new CustomEvent('djui:zoomFit')),
    },
  ]

  const publishMenu: MenuProps['items'] = [
    {
      key: 'publish',
      label: '发布到星火工程',
      icon: <CloudUploadOutlined />,
      onClick: handlePublish,
    },
  ]

  const helpMenu: MenuProps['items'] = [
    {
      key: 'check-workspace',
      label: '检查工作区更新（AGENTS + 脚本）',
      icon: workspaceOutdated
        ? <SyncOutlined style={{ color: '#ff8c42' }} />
        : <CheckCircleOutlined style={{ color: '#52c41a' }} />,
      onClick: handleCheckWorkspace,
    },
    {
      key: 'check-agents',
      label: '检查 AGENTS 规范更新',
      icon: agentsOutdated
        ? <SyncOutlined style={{ color: '#ff8c42' }} />
        : <CheckCircleOutlined style={{ color: '#52c41a' }} />,
      onClick: handleCheckAgents,
    },
    {
      key: 'check-scripts',
      label: '检查脚本区更新',
      icon: scriptsOutdated
        ? <SyncOutlined style={{ color: '#ff8c42' }} />
        : (scriptsAvailable ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : null),
      onClick: handleCheckScripts,
      disabled: !scriptsAvailable,
    },
    { type: 'divider' },
    {
      key: 'whats-new',
      label: '更新公告',
      icon: <BellOutlined />,
      onClick: () => window.dispatchEvent(new CustomEvent('djui:openWhatsNew')),
    },
    {
      key: 'about',
      label: '关于 DJUI',
      icon: <InfoCircleOutlined />,
      onClick: () => {
        Modal.info({
          title: 'DJUI 编辑器',
          content: (
            <div style={{ fontSize: 13 }}>
              <p>多杰 UI 编辑器 - StarEngine 2.0 可视化 UI 编辑工具</p>
              <p style={{ color: '#888' }}>编辑器版本: v{APP_VERSION}</p>
              <p style={{ color: '#888' }}>协议版本: v4 JSON</p>
              <p style={{ color: '#888' }}>AGENTS 规范版本: v{agents.latestVersion ?? '未知'}</p>
              <p style={{ color: '#888' }}>脚本区版本: v{scripts.latestVersion ?? '未知'}</p>
            </div>
          ),
        })
      },
    },
  ]

  // 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: 0, paddingRight: 12, background: '#14171f', borderBottom: '1px solid #2a3142',
        height: 32, flexShrink: 0,
      }}>
        {/* 左：VS Code 风格菜单栏 */}
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {/* Logo */}
          <div style={{
            width: 36, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#5ab9ff',
          }}>
            D
          </div>

          {/* 菜单项 */}
          <Dropdown menu={{ items: fileMenu }} trigger={['click']} placement="bottomLeft">
            <div style={menuItemStyle} className="djui-menubar-item">文件</div>
          </Dropdown>
          <Dropdown menu={{ items: editMenu }} trigger={['click']} placement="bottomLeft">
            <div style={menuItemStyle} className="djui-menubar-item">编辑</div>
          </Dropdown>
          <Dropdown menu={{ items: viewMenu }} trigger={['click']} placement="bottomLeft">
            <div style={menuItemStyle} className="djui-menubar-item">视图</div>
          </Dropdown>
          <Dropdown menu={{ items: publishMenu }} trigger={['click']} placement="bottomLeft">
            <div style={menuItemStyle} className="djui-menubar-item">发布</div>
          </Dropdown>
          <Dropdown menu={{ items: helpMenu }} trigger={['click']} placement="bottomLeft">
            <div style={menuItemStyle} className="djui-menubar-item">帮助</div>
          </Dropdown>
        </div>

        {/* 中：当前页面 + 状态 */}
        <Space style={{ fontSize: 12, color: '#5b6378', flex: 1, justifyContent: 'center' }}>
          {page && (
            <span style={{ color: '#9aa3b4' }}>
              {page.pageId}
            </span>
          )}
          {page && (
            <Tag style={{ fontSize: 11 }}>
              {(page.designWidth > page.designHeight) ? '横屏' : '竖屏'} {page.designWidth}x{page.designHeight}
            </Tag>
          )}
        </Space>

        {/* 右：快捷操作 */}
        <Space size={4}>
          {/* 工作区更新提醒（AGENTS.md 或 脚本区 任一过期） */}
          {workspaceOutdated && (
            <Tooltip title={
              [
                agentsOutdated ? `AGENTS.md ${agents.installedVersion ?? '旧版'} → v${agents.latestVersion}` : null,
                scriptsOutdated ? `脚本区 ${scripts.installedVersion ?? '无'} → v${scripts.latestVersion}` : null,
              ].filter(Boolean).join('；') + '（点击全部更新）'
            }>
              <Badge dot offset={[-2, 2]}>
                <Button
                  icon={<SyncOutlined style={{ color: '#ff8c42' }} />}
                  onClick={() => promptUpdateWorkspace(agents, scripts,
                    [agentsOutdated ? 'AGENTS.md' : null, scriptsOutdated ? '脚本区' : null].filter(Boolean) as string[]
                  )}
                  loading={updatingAgents || updatingScripts}
                  type="text"
                  size="small"
                />
              </Badge>
            </Tooltip>
          )}
          {soundSetupNeedsAttention && (
            <Tooltip title={soundSetupTooltip}>
              <Badge dot offset={[-2, 2]}>
                <Button
                  icon={<SoundOutlined style={{ color: '#ff8c42' }} />}
                  onClick={() => setSoundConfigOpen(true)}
                  type="text"
                  size="small"
                />
              </Badge>
            </Tooltip>
          )}
          <span style={{ color: '#3a4258', margin: '0 2px' }}>|</span>
          <Tooltip title="撤销 (Ctrl+Z)">
            <Button icon={<UndoOutlined />} disabled={undoStack.length === 0} onClick={undo} type="text" size="small" />
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Y)">
            <Button icon={<RedoOutlined />} disabled={redoStack.length === 0} onClick={redo} type="text" size="small" />
          </Tooltip>
          <span style={{ color: '#3a4258', margin: '0 2px' }}>|</span>
          <Tooltip title="保存 (Ctrl+S)">
            <Button icon={<SaveOutlined />} onClick={handleSave} type="text" size="small" />
          </Tooltip>
          <Tooltip title="发布">
            <Button icon={<CloudUploadOutlined />} onClick={handlePublish} loading={publishing} type="text" size="small" />
          </Tooltip>
        </Space>
      </div>

      <SoundConfigModal open={soundConfigOpen} onClose={() => setSoundConfigOpen(false)} />

      {/* 全局字体设置 */}
      <Modal
        title="全局默认字体"
        open={globalFontOpen}
        onCancel={() => setGlobalFontOpen(false)}
        onOk={() => {
          if (config) {
            useProjectStore.getState().setConfig({ ...config, defaultFont: globalFontValue })
          }
          setGlobalFontOpen(false)
          message.success('全局字体已设置')
        }}
        okText="保存"
        cancelText="取消"
      >
        <p style={{ fontSize: 12, color: '#9aa3b4', marginBottom: 12 }}>
          未单独设置字体的 Label/Input 控件将使用此字体。
        </p>
        <Select
          style={{ width: '100%' }}
          value={globalFontValue}
          onChange={setGlobalFontValue}
          allowClear
          placeholder="使用引擎默认字体"
          options={fontList.map(f => ({ value: f, label: f }))}
        />
      </Modal>

      {/* 统一所有控件字体 */}
      <Modal
        title="统一所有控件字体"
        open={unifyFontOpen}
        onCancel={() => setUnifyFontOpen(false)}
        onOk={() => {
          useEditorStore.getState().setAllFonts(unifyFontValue)
          setUnifyFontOpen(false)
          message.success(unifyFontValue ? `所有控件字体已统一为 ${unifyFontValue}` : '所有控件字体已清除（使用全局默认）')
        }}
        okText="确认统一"
        cancelText="取消"
      >
        <p style={{ fontSize: 12, color: '#ff9800', marginBottom: 12 }}>
          ⚠ 此操作将遍历所有页面的所有 Label/Input 控件，统一设置字体。
        </p>
        <Select
          style={{ width: '100%' }}
          value={unifyFontValue}
          onChange={setUnifyFontValue}
          allowClear
          placeholder="清除字体（使用全局默认）"
          options={fontList.map(f => ({ value: f, label: f }))}
        />
      </Modal>
    </>
  )
}

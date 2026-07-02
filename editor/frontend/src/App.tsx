import { useEffect, useState, useRef } from 'react'
import { Layout, Modal, Spin, message, Button, Result, Space } from 'antd'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import CanvasArea from './components/CanvasArea'
import RightPanel from './components/RightPanel'
import ConfigModal from './components/ConfigModal'
import { useProjectStore } from './store/projectStore'
import { setDefaultButtonSoundId, useEditorStore } from './store/editorStore'
import { projectContext } from './fs/projectContext'
import * as api from './api/client'
import { UiPage } from './types/layout'

const { Header, Sider, Content } = Layout
const DEFAULT_TEMPLATE_WIDTH = 200
const DEFAULT_TEMPLATE_HEIGHT = 100

export default function App() {
  const { config, handlesReady, setLastPage, lastPageId } = useProjectStore()
  const { setAllPages, upsertPage, removePage, setActivePage, updatePageMeta } = useEditorStore()
  const [loading, setLoading] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [configMode, setConfigMode] = useState<'new' | 'open' | 'edit'>('edit')
  const [pages, setPages] = useState<string[]>([])
  const initialized = useRef(false)

  // 启动：从 IndexedDB 恢复 DirectoryHandle，验证权限
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 浏览器兼容检测
        if (typeof window.showDirectoryPicker !== 'function') {
          if (!cancelled) setLoading(false)
          return
        }

        const restored = await projectContext.restore()
        if (restored.star || restored.ws) {
          // 只查询权限（queryPermission 无需用户手势）
          // 如果权限不是 granted，显示"授权访问"按钮让用户点击触发 requestPermission
          const verified = await projectContext.checkPermissions()
          useProjectStore.getState().initFromHandles(verified)
        }
        // 恢复 lastPageId
        const lastPageId = api.getLastPageId()
        if (lastPageId) useProjectStore.setState({ lastPageId })
      } catch {
        // 恢复失败（IndexedDB 错误等），忽略，显示欢迎页
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 配置就绪后进入主流程
  useEffect(() => {
    if (loading || initialized.current) return
    if (!config || !handlesReady) return
    initialized.current = true

    void (async () => {
      await applyPatchesAndNotify(true)
      await refreshPages()
      useProjectStore.getState().refreshAgents()
      useProjectStore.getState().refreshScripts()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, config, handlesReady])

  // 默认按钮音效
  useEffect(() => {
    if (!handlesReady) {
      setDefaultButtonSoundId(null)
      return
    }

    const refreshDefaultSound = async () => {
      const soundConfig = await api.getSoundConfig()
      setDefaultButtonSoundId(soundConfig.defaultButtonSoundId)
    }

    const handleSoundsChanged = async () => {
      await applyPatchesAndNotify(false)
      await refreshDefaultSound()
      await refreshPages()
    }

    refreshDefaultSound().catch(() => setDefaultButtonSoundId(null))
    window.addEventListener('djui:soundsChanged', handleSoundsChanged)
    return () => window.removeEventListener('djui:soundsChanged', handleSoundsChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlesReady])

  const openSoundConfig = () => {
    window.dispatchEvent(new CustomEvent('djui:openSoundConfig'))
  }

  const applyPatchesAndNotify = async (showDialog: boolean) => {
    if (!projectContext.star) return null

    const patchResult = await api.applyPatches('')
    const soundConfig = await api.getSoundConfig()
    setDefaultButtonSoundId(soundConfig.defaultButtonSoundId)

    if (patchResult.changed) {
      message.success('DJUI 数据补丁已自动应用')
    }

    if (!showDialog) return patchResult

    if (patchResult.blockers.length > 0) {
      Modal.warning({
        title: '需要配置按钮默认音效',
        content: (
          <div>
            {patchResult.blockers.map((item: string, index: number) => (
              <p key={index}>{item}</p>
            ))}
          </div>
        ),
        okText: '打开声音配置',
        onOk: openSoundConfig,
      })
    } else if (patchResult.warnings.length > 0) {
      Modal.info({
        title: '声音配置提醒',
        content: (
          <div>
            {patchResult.warnings.map((item: string, index: number) => (
              <p key={index}>{item}</p>
            ))}
          </div>
        ),
        okText: '打开声音配置',
        onOk: openSoundConfig,
      })
    }

    return patchResult
  }

  const refreshPages = async () => {
    if (!projectContext.star) return

    try {
      const list = await api.listPages()
      setPages(list)
      const allPagesMap: Record<string, UiPage> = {}
      for (const p of list) {
        const pageData = await api.loadPage(p)
        if (pageData) {
          if (pageData.nodeKind === 'window') {
            if (config?.designWidth) pageData.designWidth = config.designWidth
            if (config?.designHeight) pageData.designHeight = config.designHeight
          }
          allPagesMap[p] = pageData
        }
      }
      setAllPages(allPagesMap)
      const target = (lastPageId && list.includes(lastPageId)) ? lastPageId : list[0]
      if (target) {
        setActivePage(target)
        setLastPage(target)
      }
    } catch { /* ignore */ }
  }

  const switchPage = async (pageId: string) => {
    const state = useEditorStore.getState()
    if (state.activePageId === pageId) return
    if (!state.allPages[pageId]) {
      const pageData = await api.loadPage(pageId)
      if (!pageData) return
      if (config && pageData.nodeKind === 'window') {
        if (config.designWidth) pageData.designWidth = config.designWidth
        if (config.designHeight) pageData.designHeight = config.designHeight
      }
      upsertPage(pageData)
    }
    setActivePage(pageId)
    setLastPage(pageId)
  }

  const deletePage = async (pageId: string) => {
    await api.deletePage(pageId)
    removePage(pageId)
    const list = await api.listPages()
    setPages(list)
  }

  const handleConfigSaved = async () => {
    setConfigOpen(false)
    setConfigMode('edit')
    const cfg = useProjectStore.getState().config
    if (cfg) {
      const state = useEditorStore.getState()
      for (const [pid, p] of Object.entries(state.allPages)) {
        if (p.nodeKind === 'template') continue
        let dirty = false
        if (cfg.designWidth && p.designWidth !== cfg.designWidth) { p.designWidth = cfg.designWidth; dirty = true }
        if (cfg.designHeight && p.designHeight !== cfg.designHeight) { p.designHeight = cfg.designHeight; dirty = true }
        if (dirty) {
          updatePageMeta(pid, { designWidth: p.designWidth, designHeight: p.designHeight })
          await api.savePage(p)
        }
      }
    }
    await applyPatchesAndNotify(true)
    await refreshPages()
  }

  // 加载中
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin tip="加载中..." size="large" />
      </div>
    )
  }

  // 浏览器兼容检测
  if (typeof window.showDirectoryPicker !== 'function') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f1117' }}>
        <Result
          status="warning"
          title="浏览器不支持"
          subTitle="DJUI Editor 需要 File System Access API，请使用 Chrome 或 Edge 浏览器（桌面端 86+ 版本）。"
        />
      </div>
    )
  }

  // 无配置或 handle 未就绪：显示欢迎页
  if (!config || !handlesReady) {
    const hasStoredHandles = !!(projectContext.star || projectContext.ws)
    const handleAuthorize = async () => {
      const verified = await projectContext.requestPermissions()
      if (verified.star && verified.ws) {
        useProjectStore.getState().initFromHandles(verified)
      } else {
        message.warning('授权失败，请重新选择目录')
      }
    }
    return (
      <>
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          height: '100vh', background: '#0f1117', color: '#e8ecf4', gap: 24,
        }}>
          <h1 style={{ fontSize: 32, margin: 0 }}>DJUI Editor</h1>
          {hasStoredHandles && config ? (
            <>
              <p style={{ color: '#9aa3b4', margin: 0 }}>
                上次工程：{config.starProjectPath} / {config.workspacePath}
              </p>
              <p style={{ color: '#9aa3b4', margin: 0 }}>请授权访问工程目录</p>
              <Space size={12}>
                <Button type="primary" size="large" onClick={handleAuthorize}>
                  授权访问
                </Button>
                <Button size="large" onClick={() => { setConfigMode('new'); setConfigOpen(true) }}>
                  选择其他目录
                </Button>
              </Space>
            </>
          ) : (
            <>
              <p style={{ color: '#9aa3b4', margin: 0 }}>
                {handlesReady ? '请完成工程配置' : '请选择星火工程目录和 UI 工作区目录'}
              </p>
              <Button type="primary" size="large" onClick={() => { setConfigMode('new'); setConfigOpen(true) }}>
                {config ? '重新选择目录' : '创建工程'}
              </Button>
            </>
          )}
        </div>
        <ConfigModal
          open={configOpen}
          mode={configMode}
          onClose={() => setConfigOpen(false)}
          onSave={handleConfigSaved}
        />
      </>
    )
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ padding: 0, height: 'auto', lineHeight: 'normal' }}>
        <TopBar
          onOpenConfig={() => { setConfigMode('edit'); setConfigOpen(true) }}
          onNewProject={() => {
            useProjectStore.getState().clearConfig()
            setConfigMode('new'); setConfigOpen(true)
          }}
          onOpenProject={() => {
            setConfigMode('open'); setConfigOpen(true)
          }}
        />
      </Header>
      <Layout>
        <Sider width={280} style={{ overflow: 'auto', background: '#1a1d28' }}>
          <LeftPanel
            pages={pages}
            onNewPage={(pageId, nodeKind) => {
              const cfg = useProjectStore.getState().config!
              const newPage: UiPage = {
                version: 4,
                pageId,
                designWidth: nodeKind === 'template' ? DEFAULT_TEMPLATE_WIDTH : (cfg.designWidth ?? 1080),
                designHeight: nodeKind === 'template' ? DEFAULT_TEMPLATE_HEIGHT : (cfg.designHeight ?? 1920),
                referenceImage: null,
                root: { id: 'root', starType: 'Panel', name: pageId, children: [] },
                nodeKind,
                ...(nodeKind === 'window'
                  ? { windowMode: 'fullscreen' as const, transition: { open: null, close: null } }
                  : {}),
              }
              upsertPage(newPage)
              setActivePage(pageId)
              setLastPage(pageId)
              setPages(prev => prev.includes(pageId) ? prev : [...prev, pageId])
              api.savePage(newPage)
            }}
            onSwitchPage={switchPage}
            onDeletePage={deletePage}
          />
        </Sider>
        <Content style={{ overflow: 'hidden', background: '#0f1117' }}>
          <CanvasArea />
        </Content>
        <Sider width={340} style={{ overflow: 'auto', background: '#1a1d28' }}>
          <RightPanel />
        </Sider>
      </Layout>
      <ConfigModal
        open={configOpen}
        mode={configMode}
        onClose={() => setConfigOpen(false)}
        onSave={handleConfigSaved}
      />
    </Layout>
  )
}

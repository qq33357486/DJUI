import { useEffect, useState, useRef } from 'react'
import { Layout, Modal, Spin, message } from 'antd'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import CanvasArea from './components/CanvasArea'
import RightPanel from './components/RightPanel'
import ConfigModal from './components/ConfigModal'
import { useProjectStore } from './store/projectStore'
import { setDefaultButtonSoundId, useEditorStore } from './store/editorStore'
import * as api from './api/client'
import { UiPage } from './types/layout'

const { Header, Sider, Content } = Layout
const DEFAULT_TEMPLATE_WIDTH = 200
const DEFAULT_TEMPLATE_HEIGHT = 100

export default function App() {
  const { config, loadConfig, setLastPage, lastPageId } = useProjectStore()
  const { setAllPages, upsertPage, removePage, setActivePage, updatePageMeta } = useEditorStore()
  const [configLoading, setConfigLoading] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [configMode, setConfigMode] = useState<'new' | 'open' | 'edit'>('edit')
  const [pages, setPages] = useState<string[]>([])
  const initialized = useRef(false)

  // 启动：从后端加载配置（权威源）
  useEffect(() => {
    let cancelled = false
    api.getConfig().then((serverConfig) => {
      if (cancelled) return
      if (serverConfig) {
        // 同步到 localStorage
        localStorage.setItem('djui.project.config', JSON.stringify(serverConfig))
        useProjectStore.setState({ config: serverConfig })
      }
      // 也读 localStorage 的 lastPageId
      const lastPageId = localStorage.getItem('djui.project.lastPage')
      if (lastPageId) useProjectStore.setState({ lastPageId })
      setConfigLoading(false)
    }).catch(() => {
      if (cancelled) return
      // 后端读取失败，退化到 localStorage
      loadConfig()
      setConfigLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 配置就绪后进入主流程
  useEffect(() => {
    if (configLoading || initialized.current) return
    initialized.current = true

    if (!config) {
      // 没有配置，弹窗
      setConfigOpen(true)
      return
    }

    void (async () => {
      await applyPatchesAndNotify(true)
      await refreshPages()
      // 启动后检查 AGENTS.md 与 脚本区 是否过期
      useProjectStore.getState().refreshAgents()
      useProjectStore.getState().refreshScripts()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading])

  useEffect(() => {
    if (!config?.starProjectPath) {
      setDefaultButtonSoundId(null)
      return
    }

    const refreshDefaultSound = async () => {
      const soundConfig = await api.getSoundConfig(config.starProjectPath)
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
  }, [config?.starProjectPath])

  const openSoundConfig = () => {
    window.dispatchEvent(new CustomEvent('djui:openSoundConfig'))
  }

  const applyPatchesAndNotify = async (showDialog: boolean) => {
    const cfg = useProjectStore.getState().config
    if (!cfg?.starProjectPath) return null

    const patchResult = await api.applyPatches(cfg.starProjectPath)
    const soundConfig = await api.getSoundConfig(cfg.starProjectPath)
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
            {patchResult.blockers.map((item, index) => (
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
            {patchResult.warnings.map((item, index) => (
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
    const cfg = useProjectStore.getState().config
    if (!cfg) return

    try {
      const list = await api.listPages()
      setPages(list)
      // 加载所有页面到 allPages
      const allPagesMap: Record<string, UiPage> = {}
      for (const p of list) {
        const pageData = await api.loadPage(p)
        if (pageData) {
          // 只有窗口同步全局分辨率；模板尺寸是 prefab 自身尺寸
          if (pageData.nodeKind === 'window') {
            if (cfg.designWidth) pageData.designWidth = cfg.designWidth
            if (cfg.designHeight) pageData.designHeight = cfg.designHeight
          }
          allPagesMap[p] = pageData
        }
      }
      setAllPages(allPagesMap)
      // 激活上次页面或第一个
      const target = (lastPageId && list.includes(lastPageId)) ? lastPageId : list[0]
      if (target) {
        setActivePage(target)
        setLastPage(target)
      }
    } catch { /* ignore */ }
  }

  // 切换窗口（数据已在 allPages 中，直接激活）
  const switchPage = async (pageId: string) => {
    const state = useEditorStore.getState()
    if (state.activePageId === pageId) return
    // 如果页面尚未加载，从后端加载
    if (!state.allPages[pageId]) {
      const pageData = await api.loadPage(pageId)
      if (!pageData) return
      const cfg = useProjectStore.getState().config
      if (cfg && pageData.nodeKind === 'window') {
        if (cfg.designWidth) pageData.designWidth = cfg.designWidth
        if (cfg.designHeight) pageData.designHeight = cfg.designHeight
      }
      upsertPage(pageData)
    }
    setActivePage(pageId)
    setLastPage(pageId)
  }

  // 删除窗口
  const deletePage = async (pageId: string) => {
    await api.deletePage(pageId)
    removePage(pageId)
    const list = await api.listPages()
    setPages(list)
  }

  // 配置保存后：同步所有页面分辨率到新配置
  const handleConfigSaved = async () => {
    setConfigOpen(false)
    setConfigMode('edit')
    const cfg = useProjectStore.getState().config
    if (cfg) {
      // 更新所有页面的分辨率
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
  if (configLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin tip="加载中..." size="large" />
      </div>
    )
  }

  // 无配置：只显示配置弹窗
  if (!config) {
    return (
      <ConfigModal
        open={configOpen}
        mode={configMode}
        onClose={() => {}}
        onSave={handleConfigSaved}
      />
    )
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ padding: 0, height: 'auto', lineHeight: 'normal' }}>
        <TopBar
          onOpenConfig={() => { setConfigMode('edit'); setConfigOpen(true) }}
          onNewProject={() => {
            // 清除配置，重开配置弹窗
            useProjectStore.getState().clearConfig()
            setConfigMode('new'); setConfigOpen(true)
          }}
          onOpenProject={() => {
            // 打开已有工程（直接打开配置弹窗，让用户重新选目录）
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
              // 保存到后端
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

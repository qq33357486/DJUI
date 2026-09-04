import { useEffect, useState, useRef } from 'react'
import { pushRecentProject } from '@/lib/recentProjects'
import { Layout, Modal, Spin, message, Button, Result, Space } from 'antd'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import CanvasArea from './components/CanvasArea'
import RightPanel from './components/RightPanel'
import ConfigModal from './components/ConfigModal'
import WhatsNewModal from './components/WhatsNewModal'
import SyncConflictModal, { type ConflictResolution } from './components/SyncConflictModal'
import AdaptationAuditPage from './components/AdaptationAuditPage'
import { useProjectStore } from './store/projectStore'
import { setDefaultButtonSoundId, setDefaultFontForNew, useEditorStore } from './store/editorStore'
import { projectContext } from './fs/projectContext'
import { loadEngineFonts } from './lib/fontLoader'
import * as api from './api/client'
import { APP_VERSION } from './lib/changelog'
import {
  applyDiskVersions,
  describeChanges,
  detectAndSyncClean,
  keepLocalVersions,
  runExclusive,
} from '@/lib/pageSync'
import type { DevicePresetV6 } from './lib/devicePresetsV6'
import { UiPage } from './types/layout'
import { prunePageUnderlays } from './lib/pageUnderlays'

const { Header, Sider, Content } = Layout
const DEFAULT_TEMPLATE_WIDTH = 200
const DEFAULT_TEMPLATE_HEIGHT = 100
const SOUND_SETUP_NOTICE_KEY_PREFIX = 'djui.soundSetupNotice.v1.'

function soundSetupNeedsAttention(soundSetup: api.SoundSetupStatus | null) {
  return !!soundSetup && soundSetup.status !== 'ok'
}

function getSoundSetupNoticeKey() {
  const projectName = projectContext.starName || 'unknown'
  return `${SOUND_SETUP_NOTICE_KEY_PREFIX}${encodeURIComponent(projectName)}`
}

function hasSeenSoundSetupNotice() {
  try {
    return localStorage.getItem(getSoundSetupNoticeKey()) === '1'
  } catch {
    return false
  }
}

function markSoundSetupNoticeSeen() {
  try {
    localStorage.setItem(getSoundSetupNoticeKey(), '1')
  } catch {
    // localStorage 不可用时只影响是否重复提示，不影响编辑流程。
  }
}

export default function App() {
  const { config, handlesReady, setLastPage, lastPageId, syncConflicts, setSyncConflicts } = useProjectStore()
  const { setAllPages, upsertPage, removePage, setActivePage, updatePageMeta, setPageUnderlays } = useEditorStore()
  const [loading, setLoading] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [configMode, setConfigMode] = useState<'new' | 'open' | 'edit'>('edit')
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [adaptationAuditOpen, setAdaptationAuditOpen] = useState(false)
  const [auditDeviceReturn, setAuditDeviceReturn] = useState<{ presetId: string; variant: 'base' | 'wide' } | null>(null)
  const [soundSetup, setSoundSetup] = useState<api.SoundSetupStatus | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [syncConflictOpen, setSyncConflictOpen] = useState(false)
  const [syncResolving, setSyncResolving] = useState(false)
  const initialized = useRef(false)
  const lastSyncCheckRef = useRef(0)

  // 审计页退出后等画布重新挂载，再带入用户刚刚复核的设备画像。
  useEffect(() => {
    if (adaptationAuditOpen || !auditDeviceReturn) return
    const returnTarget = auditDeviceReturn
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('djui:selectDevicePreview', { detail: returnTarget }))
      setAuditDeviceReturn(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [adaptationAuditOpen, auditDeviceReturn])

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
        if (restored.star && restored.ws) {
          // 启动恢复成功 = 打开过该工程,计入最近列表
          pushRecentProject(projectContext.starName, projectContext.wsName)
        }
        if (restored.star || restored.ws) {
          // 只查询权限（queryPermission 无需用户手势）
          // 如果权限不是 granted，显示"授权访问"按钮让用户点击触发 requestPermission
          const verified = await projectContext.checkPermissions()
          useProjectStore.getState().initFromHandles(verified)
          if (verified.star) {
            const projectResult = await useProjectStore.getState().loadProjectFile()
            if (projectResult.status === 'blocked') {
              useProjectStore.setState({ config: null })
              message.error('当前工程不是有效的 DJUI v6 项目，请先完成显式迁移')
            }
          }
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

  // 版本检测：首次打开或版本升级时自动弹出更新公告
  useEffect(() => {
    if (loading) return
    const lastSeen = localStorage.getItem('djui.lastSeenVersion')
    if (lastSeen !== APP_VERSION) {
      setWhatsNewOpen(true)
    }
    // 监听 TopBar 菜单手动打开
    const openWhatsNew = () => setWhatsNewOpen(true)
    window.addEventListener('djui:openWhatsNew', openWhatsNew)
    return () => window.removeEventListener('djui:openWhatsNew', openWhatsNew)
  }, [loading])

  // 配置就绪后进入主流程
  useEffect(() => {
    if (loading || initialized.current) return
    if (!config || !handlesReady) return
    initialized.current = true

    void (async () => {
      // 字体列表先加载（不依赖 patches/pages，避免前置步骤阻塞导致字体永远不加载）
      useProjectStore.getState().refreshFonts()
      const migrationReport = await api.scanMigrationReportV6()
      if (!migrationReport.canOpen) {
        Modal.warning({
          title: '需要迁移到 DJUI v6',
          width: 720,
          content: (
            <div style={{ fontSize: 13 }}>
              <p>检测到旧协议或无效文件。DJUI 不会自动修改这些文件，迁移完成前不会加载页面。</p>
              <p>受影响文件：{migrationReport.files.filter(file => file.status !== 'v6').length} 个</p>
              <Space>
                <Button onClick={() => {
                  void navigator.clipboard.writeText(migrationReport.prompt).then(() => message.success('AI 迁移提示词已复制'))
                }}>复制 AI 迁移提示词</Button>
              </Space>
            </div>
          ),
          okText: '知道了',
        })
        return
      }
      await applyPatchesAndNotify(true)
      await refreshPages()
      // 注册工程字体到浏览器（注册完 bump fontVersion 触发画布用真实字体重渲染）
      loadEngineFonts().then(() => useProjectStore.getState().bumpFontVersion())
      useProjectStore.getState().refreshAgents()
      useProjectStore.getState().refreshScripts()
      // 星火工程 Runtime 状态也纳入启动检测：脚本区最新不代表 Runtime 已升级，
      // 不在这里查就会退化成「启动不提醒、发布才拦截」
      useProjectStore.getState().refreshRuntime()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, config, handlesReady])

  // 默认按钮音效
  useEffect(() => {
    if (!handlesReady) {
      setDefaultButtonSoundId(null)
      setSoundSetup(null)
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

  // ===== 页面外部修改检测（AI 直接改工程文件场景） =====
  // 回到编辑器（窗口聚焦 / 标签页重新可见）时与磁盘比对：
  //   内存干净的页面自动按磁盘重载；有未保存修改的页面上报冲突，交由用户裁决。
  const runFocusSync = () => {
    const now = Date.now()
    if (now - lastSyncCheckRef.current < 1500) return
    lastSyncCheckRef.current = now
    void runExclusive(async () => {
      let result
      try {
        result = await detectAndSyncClean()
      } catch {
        return // 权限失效 / 读盘异常：本轮放弃，下次聚焦再试
      }
      if (result.synced.length > 0) {
        setPages(await api.listPages())
        message.info('已同步外部修改：' + describeChanges(result.synced))
      }
      if (result.conflicts.length > 0) {
        const prev = useProjectStore.getState().syncConflicts
        useProjectStore.getState().setSyncConflicts(result.conflicts)
        // 与上次提示相同的冲突集合只保留徽章，避免每次聚焦重复弹窗
        const sameAsBefore =
          prev.length === result.conflicts.length &&
          prev.every(c => result.conflicts.some(n => n.pageId === c.pageId && n.type === c.type))
        if (!sameAsBefore) setSyncConflictOpen(true)
      } else if (useProjectStore.getState().syncConflicts.length > 0) {
        useProjectStore.getState().setSyncConflicts([])
      }
    })
  }

  useEffect(() => {
    if (!handlesReady) return
    const onVisible = () => { if (document.visibilityState === 'visible') runFocusSync() }
    window.addEventListener('focus', runFocusSync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', runFocusSync)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlesReady])

  // TopBar 冲突徽章点击 → 重新打开裁决弹窗
  useEffect(() => {
    const openSyncConflicts = () => {
      if (useProjectStore.getState().syncConflicts.length > 0) setSyncConflictOpen(true)
    }
    window.addEventListener('djui:openSyncConflicts', openSyncConflicts)
    return () => window.removeEventListener('djui:openSyncConflicts', openSyncConflicts)
  }, [])

  const resolveSyncConflicts = async (resolution: ConflictResolution) => {
    const conflicts = useProjectStore.getState().syncConflicts
    setSyncResolving(true)
    try {
      await runExclusive(async () => {
        if (resolution === 'disk') {
          await applyDiskVersions(conflicts)
          setPages(await api.listPages())
          message.success('已按磁盘版本同步')
        } else {
          await keepLocalVersions(conflicts)
          message.success('已保留编辑器版本，下次保存时将覆盖磁盘文件')
        }
        useProjectStore.getState().setSyncConflicts([])
      })
      setSyncConflictOpen(false)
    } catch {
      message.error('同步失败，请重试')
    } finally {
      setSyncResolving(false)
    }
  }

  // 全局默认字体变化时同步给 createNode（新建控件预填字体用）
  useEffect(() => {
    setDefaultFontForNew(config?.defaultFont ?? null)
  }, [config?.defaultFont])

  const openSoundConfig = () => {
    window.dispatchEvent(new CustomEvent('djui:openSoundConfig'))
  }

  const applyPatchesAndNotify = async (showDialog: boolean) => {
    if (!projectContext.star) return null

    const patchResult = await api.applyPatches('')
    const soundConfig = await api.getSoundConfig()
    setSoundSetup(patchResult.soundSetup)
    setDefaultButtonSoundId(soundConfig.defaultButtonSoundId)

    if (patchResult.changed) {
      message.success('DJUI 数据补丁已自动应用')
    }

    if (!showDialog) return patchResult

    if (patchResult.blockers.length > 0) {
      Modal.warning({
        title: 'DJUI 数据需要处理',
        content: (
          <div>
            {patchResult.blockers.map((item: string, index: number) => (
              <p key={index}>{item}</p>
            ))}
          </div>
        ),
        okText: '知道了',
      })
    } else if (patchResult.warnings.length > 0) {
      Modal.info({
        title: 'DJUI 数据提醒',
        content: (
          <div>
            {patchResult.warnings.map((item: string, index: number) => (
              <p key={index}>{item}</p>
            ))}
          </div>
        ),
        okText: '知道了',
      })
    } else if (soundSetupNeedsAttention(patchResult.soundSetup) && !hasSeenSoundSetupNotice()) {
      markSoundSetupNoticeSeen()
      Modal.confirm({
        title: '建议配置按钮默认音效',
        content: (
          <div style={{ fontSize: 13 }}>
            <p>配置默认按钮音效后，后续新建 Button 会自动带上点击音效，已有缺失音效的 Button 也会在刷新时自动补齐。</p>
            <p>需要先在星火的数编里新增一个 <code>GameDataSound</code> 音频数据；具体绑定哪个音效由项目自行决定。</p>
            <p style={{ color: '#8d96aa' }}>也可以暂不配置。DJUI 之后只会在顶部栏保留提醒，不再弹窗打断刷新和编辑。</p>
          </div>
        ),
        okText: '去配置',
        cancelText: '暂不配置',
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
      // 全量重载后清理已消失页面的基线残留（loadPage 已顺带刷新存活页基线）
      api.pruneBaselines(Object.keys(allPagesMap))
      const savedUnderlays = await api.getPageUnderlays()
      const validUnderlays = prunePageUnderlays(savedUnderlays, allPagesMap)
      setPageUnderlays(validUnderlays)
      if (JSON.stringify(savedUnderlays) !== JSON.stringify(validUnderlays)) {
        // 清理失效编辑器关联失败不能阻断页面本身的加载和编辑。
        try { await api.savePageUnderlays(validUnderlays) } catch { /* 下次可再次自动清理 */ }
      }
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
    const state = useEditorStore.getState()
    await api.savePageUnderlays(state.pageUnderlays)
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
        const designWidth = cfg.designWidth ?? p.designWidth
        const designHeight = cfg.designHeight ?? p.designHeight
        const dirty = designWidth !== p.designWidth || designHeight !== p.designHeight
        if (dirty) {
          // 通过 store 写入，确保工程级撤回能保留变更前的完整快照。
          updatePageMeta(pid, { designWidth, designHeight })
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
        const projectResult = await useProjectStore.getState().loadProjectFile()
        if (projectResult.status === 'blocked') {
          useProjectStore.setState({ config: null })
          message.error('当前工程不是有效的 DJUI v6 项目，请先完成显式迁移')
        }
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
          soundSetup={soundSetup}
          onOpenConfig={() => { setConfigMode('edit'); setConfigOpen(true) }}
          onNewProject={() => {
            useProjectStore.getState().clearConfig()
            setConfigMode('new'); setConfigOpen(true)
          }}
          onOpenProject={() => {
            setConfigMode('open'); setConfigOpen(true)
          }}
          onOpenAdaptationAudit={() => setAdaptationAuditOpen(true)}
        />
      </Header>
      {adaptationAuditOpen ? (
        <AdaptationAuditPage
          onBack={() => setAdaptationAuditOpen(false)}
          onViewOnCanvas={(device: DevicePresetV6, wide) => {
            setAuditDeviceReturn({ presetId: device.id, variant: wide ? 'wide' : 'base' })
            setAdaptationAuditOpen(false)
          }}
          pages={pages}
          onSwitchPage={switchPage}
        />
      ) : (
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
      )}
      <ConfigModal
        open={configOpen}
        mode={configMode}
        onClose={() => setConfigOpen(false)}
        onSave={handleConfigSaved}
      />
      <WhatsNewModal open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
      <SyncConflictModal
        open={syncConflictOpen && syncConflicts.length > 0}
        mode="focus"
        conflicts={syncConflicts}
        resolving={syncResolving}
        onResolve={resolveSyncConflicts}
        onClose={() => setSyncConflictOpen(false)}
      />
    </Layout>
  )
}

import { useState, useEffect } from 'react'
import { pushRecentProject } from '@/lib/recentProjects'
import {
  Modal, Input, Form, InputNumber, message, Button, Space,
  Tag, Alert, Radio, Tooltip, Select,
} from 'antd'
import {
  FolderOpenOutlined, CheckCircleOutlined,
  ExclamationCircleOutlined, DownloadOutlined, InfoCircleOutlined,
  DesktopOutlined, MobileOutlined,
} from '@ant-design/icons'
import { useProjectStore } from '@/store/projectStore'
import { ProjectConfig } from '@/types/layout'
import * as api from '@/api/client'
import { projectContext } from '@/fs/projectContext'

interface ConfigModalProps {
  open: boolean
  onClose: () => void
  onSave: () => void
  mode?: 'new' | 'open' | 'edit'
  /** 工程页面清单（retainedPages 多选的候选；未加载时兜底显示已有配置值） */
  pages?: string[]
}

const DEFAULT_PROJECT_CANVAS = { orientation: 'portrait' as const, width: 1080, height: 2400 }
const PROJECT_CANVAS_BY_ORIENTATION = {
  portrait: { width: 1080, height: 2400, ratio: '9:20' },
  landscape: { width: 2400, height: 1080, ratio: '20:9' },
} as const

export default function ConfigModal({ open, onClose, onSave, mode = 'edit', pages }: ConfigModalProps) {
  const { config, setConfig } = useProjectStore()
  const [form] = Form.useForm<ProjectConfig>()
  const [starDirName, setStarDirName] = useState('')
  const [wsDirName, setWsDirName] = useState('')
  const [runtimeStatus, setRuntimeStatus] = useState<api.RuntimeStatus | null>(null)
  const [runtimeChecking, setRuntimeChecking] = useState(false)
  const [runtimeInstalling, setRuntimeInstalling] = useState(false)
  const [workspaceStatus, setWorkspaceStatus] = useState<api.WorkspaceStatus | null>(null)
  const [workspaceChecking, setWorkspaceChecking] = useState(false)
  const [workspaceInstalling, setWorkspaceInstalling] = useState(false)

  const initialValues: Partial<ProjectConfig> = config ?? {
    starProjectPath: '',
    workspacePath: '',
    orientation: DEFAULT_PROJECT_CANVAS.orientation,
    designWidth: DEFAULT_PROJECT_CANVAS.width,
    designHeight: DEFAULT_PROJECT_CANVAS.height,
  }

  // 打开时恢复选中状态
  useEffect(() => {
    if (open) {
      // 同步目录名
      setStarDirName(projectContext.starName || config?.starProjectPath || '')
      setWsDirName(projectContext.wsName || config?.workspacePath || '')
      void checkRuntime()
      void checkWorkspace()

      if (!config) form.setFieldsValue({ orientation: 'portrait', designWidth: 1080, designHeight: 2400 })
    }
  }, [open, config])

  // === 目录选择（File System Access API） ===
  const pickStarDir = async () => {
    const ok = await projectContext.pickStarProject()
    if (ok) {
      const name = projectContext.starName
      setStarDirName(name)
      form.setFieldValue('starProjectPath', name)
      checkRuntime()
    }
  }

  const pickWsDir = async () => {
    const ok = await projectContext.pickWorkspace()
    if (ok) {
      const name = projectContext.wsName
      setWsDirName(name)
      form.setFieldValue('workspacePath', name)
      checkWorkspace()
    }
  }

  // === Runtime 检查 ===
  const checkRuntime = async () => {
    if (!projectContext.star) { setRuntimeStatus(null); return }
    setRuntimeChecking(true)
    try {
      const status = await api.checkRuntime('')
      setRuntimeStatus(status)
    } catch {
      setRuntimeStatus({ status: 'invalid', message: '检查失败' })
    } finally {
      setRuntimeChecking(false)
    }
  }

  const installRuntime = async () => {
    if (!projectContext.star) { message.warning('请先选择星火工程目录'); return }
    setRuntimeInstalling(true)
    try {
      const result = await api.initRuntime('')
      if (result.ok) {
        message.success(`Runtime v${result.version} 已安装`)
        checkRuntime()
        // 同步 TopBar 徽章状态（启动检测也盯着星火 Runtime）
        void useProjectStore.getState().refreshRuntime()
        // Runtime 与本地发布器必须同代：网页更新 Runtime 后，旧发布器会因内嵌版本落后而拒绝发布，
        // 这里主动提醒同步脚本区，避免用户在网页走完流程、AI 侧却报发布器过旧。
        if (projectContext.ws) {
          const scripts = await api.checkScriptsUpdate('')
          if (scripts.status === 'outdated' || scripts.status === 'missing') {
            message.warning('本地发布器需要同步：请执行「检查工作区更新」更新脚本区，否则 AI 命令行发布会因版本不符被阻止', 6)
          }
        }
      } else {
        message.error(result.error || '安装失败')
      }
    } catch {
      message.error('安装失败')
    } finally {
      setRuntimeInstalling(false)
    }
  }

  // === 工作区检查 ===
  const checkWorkspace = async () => {
    if (!projectContext.ws) { setWorkspaceStatus(null); return }
    setWorkspaceChecking(true)
    try {
      const status = await api.checkWorkspace('')
      setWorkspaceStatus(status)
    } catch {
      setWorkspaceStatus({ status: 'invalid', message: '检查失败', dirs: [] })
    } finally {
      setWorkspaceChecking(false)
    }
  }

  const initWorkspace = async () => {
    if (!projectContext.ws) { message.warning('请先选择 UI 工程目录'); return }
    setWorkspaceInstalling(true)
    try {
      const result = await api.initWorkspace('')
      if (result.ok) {
        message.success(result.message || '工作区初始化完成')
        checkWorkspace()
      } else {
        message.error(result.error || '初始化失败')
      }
    } catch {
      message.error('初始化失败')
    } finally {
      setWorkspaceInstalling(false)
    }
  }

  // 新建时方向即是项目契约；创建后不允许从竖屏切到横屏或反向切换。
  const handleNewOrientationChange = (orient: 'landscape' | 'portrait') => {
    const preset = PROJECT_CANVAS_BY_ORIENTATION[orient]
    form.setFieldValue('orientation', orient)
    form.setFieldValue('designWidth', preset.width)
    form.setFieldValue('designHeight', preset.height)
  }

  // === 保存 ===
  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      if (!projectContext.star) { message.warning('请选择星火工程目录'); return }
      if (!projectContext.ws) { message.warning('请选择 UI 工程目录'); return }

      const isNewProject = mode === 'new'
      const orient = isNewProject
        ? (values.orientation ?? DEFAULT_PROJECT_CANVAS.orientation)
        : (config?.orientation ?? values.orientation ?? DEFAULT_PROJECT_CANVAS.orientation)
      const newCanvas = PROJECT_CANVAS_BY_ORIENTATION[orient]
      const finalConfig: ProjectConfig = {
        starProjectPath: projectContext.starName,
        workspacePath: projectContext.wsName,
        orientation: orient,
        designWidth: isNewProject ? newCanvas.width : (config?.designWidth ?? values.designWidth ?? DEFAULT_PROJECT_CANVAS.width),
        designHeight: isNewProject ? newCanvas.height : (config?.designHeight ?? values.designHeight ?? DEFAULT_PROJECT_CANVAS.height),
        canvasMode: isNewProject ? 'Contain' : (values.canvasMode ?? config?.canvasMode ?? 'Contain'),
        wideRatio: isNewProject ? 1.25 : (values.wideRatio ?? config?.wideRatio ?? 1.25),
        defaultFont: config?.defaultFont,
        retainedPages: isNewProject ? [] : (values.retainedPages ?? config?.retainedPages ?? []),
        poolCapacity: isNewProject ? 5 : (values.poolCapacity ?? config?.poolCapacity ?? 5),
      }
      await setConfig(finalConfig)
      pushRecentProject(finalConfig.starProjectPath, finalConfig.workspacePath)
      message.success('工程配置已保存')
      onSave()
      // 换过工程目录后必须整页刷新:编辑器各 store 还持有旧工程的页面/选中态,
      // 局部重置容易残留;整页 reload 与 VS Code 重开窗口同语义,最稳。
      setTimeout(() => window.location.reload(), 200)
    } catch {
      // validation error
    }
  }

  // === 状态渲染 ===
  const renderRuntimeAlert = () => {
    if (runtimeChecking) return <Alert message="检查 Runtime..." type="info" showIcon />
    if (!runtimeStatus) return null
    const { status, installedVersion, expectedVersion } = runtimeStatus

    if (status === 'ok') {
      return (
        <Alert type="success" showIcon icon={<CheckCircleOutlined />}
          message={<Space><span>Runtime 已就绪</span><Tag color="green">v{installedVersion}</Tag></Space>} />
      )
    }
    if (status === 'missing' || status === 'outdated') {
      const driftDetails = [
        runtimeStatus.missingFiles?.length ? `缺失 ${runtimeStatus.missingFiles.length} 个文件` : null,
        runtimeStatus.extraFiles?.length ? `残留 ${runtimeStatus.extraFiles.length} 个文件` : null,
      ].filter(Boolean).join('，')
      return (
        <Alert type="warning" showIcon icon={<ExclamationCircleOutlined />}
          message={status === 'missing' ? '未安装 Runtime' : 'Runtime 可升级'}
          description={
            <Space direction="vertical" size={4}>
              <Space>
                {installedVersion && installedVersion !== 'unknown' && <Tag color="orange">当前 v{installedVersion}</Tag>}
                {expectedVersion && <Tag color="green">最新 v{expectedVersion}</Tag>}
                <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={installRuntime} loading={runtimeInstalling}>
                  {status === 'missing' ? '初始化' : '升级'}
                </Button>
              </Space>
              {driftDetails && <span style={{ fontSize: 12, color: '#9aa3b4' }}>{driftDetails}</span>}
            </Space>
          } />
      )
    }
    return null
  }

  const renderWorkspaceAlert = () => {
    if (workspaceChecking) return <Alert message="检查工作区..." type="info" showIcon />
    if (!workspaceStatus) return null
    const { status, missing } = workspaceStatus

    if (status === 'ok') {
      return (
        <Alert type="success" showIcon icon={<CheckCircleOutlined />}
          message={<span>UI 工作区已就绪</span>} />
      )
    }
    if (status === 'empty' || status === 'partial') {
      return (
        <Alert type="warning" showIcon icon={<ExclamationCircleOutlined />}
          message={status === 'empty' ? '目录尚未初始化' : '工作区不完整'}
          description={<Space>
            {missing && missing.length > 0 && <span style={{ fontSize: 12, color: '#9aa3b4' }}>缺少: {missing.join(', ')}</span>}
            <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={initWorkspace} loading={workspaceInstalling}>
              初始化工作区
            </Button>
          </Space>} />
      )
    }
    return null
  }

  return (
    <Modal
      title={mode === 'new' ? '新建工程' : mode === 'open' ? '打开工程' : '工程配置'}
      open={open} onOk={handleOk} onCancel={onClose}
      okText={mode === 'new' ? '创建' : mode === 'open' ? '打开' : '保存'} cancelText="取消" width={640} destroyOnClose={false}>
      <Form form={form} layout="vertical" initialValues={initialValues}>

        {/* === 星火工程目录 === */}
        <Form.Item
          name="starProjectPath"
          label={
            <Space>
              <strong>星火工程目录</strong>
              <Tooltip title="星火游戏项目的根路径。打包时成品素材和页面 JSON 会写入此目录。">
                <InfoCircleOutlined style={{ color: '#5b6378' }} />
              </Tooltip>
            </Space>
          }
          rules={[{ required: true, message: '请选择星火工程目录' }]}
        >
          <DirInput
            value={starDirName}
            placeholder="点击选择目录"
            onPick={pickStarDir}
          />
        </Form.Item>
        {starDirName && renderRuntimeAlert()}

        <div style={{ height: 16 }} />

        {/* === UI 工程目录 === */}
        <Form.Item
          name="workspacePath"
          label={
            <Space>
              <strong>UI 工程目录</strong>
              <Tooltip title="存放 UI 配置、UI 图素材的工作目录。包含原始素材、成品素材、临时文件等子目录。请自行备份好。">
                <InfoCircleOutlined style={{ color: '#5b6378' }} />
              </Tooltip>
            </Space>
          }
          rules={[{ required: true, message: '请选择 UI 工程目录' }]}
        >
          <DirInput
            value={wsDirName}
            placeholder="点击选择目录"
            onPick={pickWsDir}
          />
        </Form.Item>
        {wsDirName && renderWorkspaceAlert()}

        <div style={{ height: 16 }} />

        {/* === 设计分辨率 === */}
        {mode === 'new' ? (
          <Form.Item label={<strong>项目方向</strong>}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <Form.Item name="orientation" noStyle>
                <Radio.Group
                  buttonStyle="solid"
                  onChange={event => handleNewOrientationChange(event.target.value)}
                  style={{ width: '100%' }}
                >
                  <Radio.Button value="portrait" style={{ width: '50%', textAlign: 'center' }}>
                    <MobileOutlined /> 竖屏 · 9:20
                  </Radio.Button>
                  <Radio.Button value="landscape" style={{ width: '50%', textAlign: 'center' }}>
                    <DesktopOutlined /> 横屏 · 20:9
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Alert
                type="info"
                showIcon
                message="方向在创建后锁定"
                description="分辨率预览只显示同方向设备；9:16、9:19.5 等是竖屏项目的适配画像，不会改变项目画板。"
              />
              <Form.Item name="designWidth" hidden><Input /></Form.Item>
              <Form.Item name="designHeight" hidden><Input /></Form.Item>
            </Space>
          </Form.Item>
        ) : (
          <Alert
            type="info"
            showIcon
            message={`项目方向已锁定：${config?.orientation === 'landscape' ? '横屏 · 20:9' : '竖屏 · 9:20'}（${config?.designWidth}×${config?.designHeight}）`}
            description="若要制作另一方向的 UI，请新建对应方向项目；当前项目的设备预览不会显示反方向设备。"
          />
        )}

        {mode !== 'new' && (
          <>
            <Form.Item name="canvasMode" label={<strong>Canvas 适配</strong>} initialValue={config?.canvasMode ?? 'Contain'}>
              <Select options={[
                { value: 'Contain', label: '完整容纳（推荐）' },
                { value: 'MatchWidth', label: '宽度优先' },
                { value: 'MatchHeight', label: '高度优先' },
              ]} />
            </Form.Item>
            <Form.Item name="wideRatio" label={<strong>宽屏阈值</strong>} initialValue={config?.wideRatio ?? 1.25}>
              <InputNumber min={1.01} max={4} step={0.05} style={{ width: '100%' }} addonAfter="物理宽高比" />
            </Form.Item>
            <Form.Item
              name="retainedPages"
              label={
                <Space>
                  <strong>常驻复用页面（清单）</strong>
                  <Tooltip title="已开启常驻复用的页面清单（各页面右侧属性栏「窗口」分组也可单独勾选）。清单中的页面关闭后不销毁、常驻隐藏池，重开直接复用；其余页面进入窗口池按容量先进先出。">
                    <InfoCircleOutlined style={{ color: '#5b6378' }} />
                  </Tooltip>
                </Space>
              }
              initialValue={config?.retainedPages ?? []}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="选择需要常驻复用的页面"
                options={Array.from(new Set([...(pages ?? []), ...(config?.retainedPages ?? [])]))
                  .sort((a, b) => {
                    const inA = (config?.retainedPages ?? []).includes(a) ? 0 : 1
                    const inB = (config?.retainedPages ?? []).includes(b) ? 0 : 1
                    return inA - inB || a.localeCompare(b, 'zh-Hans-CN')
                  })
                  .map(page => ({ value: page, label: page }))}
              />
            </Form.Item>
            <Form.Item
              name="poolCapacity"
              label={
                <Space>
                  <strong>窗口池容量</strong>
                  <Tooltip title="非常驻页面关闭后保留在窗口池中待复用的数量上限（先进先出，池满淘汰最久未用的页面销毁）。0＝只有常驻复用页面会保留。">
                    <InfoCircleOutlined style={{ color: '#5b6378' }} />
                  </Tooltip>
                </Space>
              }
              initialValue={config?.poolCapacity ?? 5}
            >
              <InputNumber min={0} max={100} precision={0} step={1} style={{ width: '100%' }} addonAfter="页" />
            </Form.Item>
          </>
        )}

      </Form>
    </Modal>
  )
}

// 目录输入框组件
function DirInput({ value, onPick, placeholder }: {
  value?: string
  onChange?: (val: string) => void
  onPick: () => void
  placeholder?: string
}) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        style={{ flex: 1 }}
        placeholder={placeholder || '点击右侧按钮选择目录'}
        value={value}
        readOnly
      />
      <Button type="primary" icon={<FolderOpenOutlined />} onClick={onPick}>选择</Button>
    </Space.Compact>
  )
}

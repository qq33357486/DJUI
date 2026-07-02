import { useState, useEffect } from 'react'
import {
  Modal, Input, Form, InputNumber, message, Button, Space,
  Tag, Alert, Radio, Tooltip,
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
}

// 分辨率预设
interface RatioPreset { ratio: string; w: number; h: number; desc: string }

const RESOLUTION_PRESETS: Record<'landscape' | 'portrait', RatioPreset[]> = {
  portrait: [
    { ratio: '9:16', w: 1080, h: 1920, desc: '经典标准' },
    { ratio: '9:19.5', w: 1080, h: 2340, desc: '全面屏主流' },
    { ratio: '9:20', w: 1080, h: 2160, desc: '安卓全面屏' },
    { ratio: '10:21', w: 1080, h: 2268, desc: '超高屏/折叠屏' },
  ],
  landscape: [
    { ratio: '16:9', w: 1920, h: 1080, desc: '经典标准' },
    { ratio: '19.5:9', w: 2340, h: 1080, desc: '全面屏主流' },
    { ratio: '20:9', w: 2160, h: 1080, desc: '安卓全面屏' },
    { ratio: '21:10', w: 2520, h: 1200, desc: '超高屏/折叠屏' },
  ],
}

export default function ConfigModal({ open, onClose, onSave, mode = 'edit' }: ConfigModalProps) {
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
  const [useCustomRes, setUseCustomRes] = useState(false)
  const [activeRes, setActiveRes] = useState<string | null>(null)

  const initialValues: Partial<ProjectConfig> = config ?? {
    starProjectPath: '',
    workspacePath: '',
    orientation: 'portrait',
    designWidth: 1080,
    designHeight: 1920,
  }

  // 打开时恢复选中状态
  useEffect(() => {
    if (open) {
      // 同步目录名
      setStarDirName(projectContext.starName || config?.starProjectPath || '')
      setWsDirName(projectContext.wsName || config?.workspacePath || '')

      if (config) {
        const orient = config.orientation ?? 'portrait'
        const preset = RESOLUTION_PRESETS[orient].find(
          p => p.w === config.designWidth && p.h === config.designHeight
        )
        if (preset) {
          setActiveRes(preset.ratio)
          setUseCustomRes(false)
        } else {
          setActiveRes(null)
          setUseCustomRes(true)
        }
      } else {
        setActiveRes(RESOLUTION_PRESETS.portrait[0].ratio)
        setUseCustomRes(false)
      }
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

  // === 分辨率选择 ===
  const handleOrientationChange = (orient: 'landscape' | 'portrait') => {
    form.setFieldValue('orientation', orient)
    setUseCustomRes(false)
    const preset = RESOLUTION_PRESETS[orient][0]
    form.setFieldValue('designWidth', preset.w)
    form.setFieldValue('designHeight', preset.h)
    setActiveRes(preset.ratio)
  }

  const handlePresetClick = (p: RatioPreset) => {
    setUseCustomRes(false)
    form.setFieldValue('designWidth', p.w)
    form.setFieldValue('designHeight', p.h)
    setActiveRes(p.ratio)
  }

  const handleCustomToggle = () => {
    setUseCustomRes(true)
    setActiveRes(null)
  }

  // === 保存 ===
  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      if (!projectContext.star) { message.warning('请选择星火工程目录'); return }
      if (!projectContext.ws) { message.warning('请选择 UI 工程目录'); return }

      const orient = values.orientation ?? 'portrait'
      const finalConfig: ProjectConfig = {
        starProjectPath: projectContext.starName,
        workspacePath: projectContext.wsName,
        orientation: orient,
        designWidth: values.designWidth ?? 1080,
        designHeight: values.designHeight ?? 1920,
        defaultFont: config?.defaultFont,
      }
      setConfig(finalConfig)
      message.success('工程配置已保存')
      onSave()
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

  const currentOrientation = Form.useWatch('orientation', form) ?? 'portrait'
  const presets = RESOLUTION_PRESETS[currentOrientation as 'landscape' | 'portrait'] ?? []

  return (
    <Modal
      title={mode === 'new' ? '新建工程' : mode === 'open' ? '打开工程' : '工程配置'}
      open={open} onOk={handleOk} onCancel={onClose}
      okText={mode === 'open' ? '打开' : '保存'} cancelText="取消" width={640} destroyOnClose={false}>
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
        <Form.Item label={<strong>设计分辨率</strong>}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Form.Item name="orientation" noStyle>
              <Radio.Group
                buttonStyle="solid"
                onChange={e => handleOrientationChange(e.target.value)}
                style={{ width: '100%' }}
              >
                <Radio.Button value="landscape" style={{ width: '50%', textAlign: 'center' }}>
                  <DesktopOutlined /> 横屏 (Landscape)
                </Radio.Button>
                <Radio.Button value="portrait" style={{ width: '50%', textAlign: 'center' }}>
                  <MobileOutlined /> 竖屏 (Portrait)
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            {/* 预设比例选择 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {presets.map(p => {
                const isActive = !useCustomRes && activeRes === p.ratio
                return (
                  <div
                    key={p.ratio}
                    onClick={() => handlePresetClick(p)}
                    style={{
                      flex: '1 1 0', minWidth: 90, cursor: 'pointer', textAlign: 'center',
                      padding: '10px 8px', borderRadius: 8, transition: 'all 0.15s',
                      border: isActive ? '2px solid #5ab9ff' : '1px solid #2a3142',
                      background: isActive ? '#15293d' : '#1d2230',
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 600, color: isActive ? '#5ab9ff' : '#e8ecf4' }}>
                      {p.ratio}
                    </div>
                    <div style={{ fontSize: 11, color: '#9aa3b4', marginTop: 2 }}>{p.desc}</div>
                    <div style={{ fontSize: 10, color: '#5b6378', marginTop: 2 }}>{p.w}×{p.h}</div>
                  </div>
                )
              })}
              {/* 自定义 */}
              <div
                onClick={handleCustomToggle}
                style={{
                  flex: '1 1 0', minWidth: 90, cursor: 'pointer', textAlign: 'center',
                  padding: '10px 8px', borderRadius: 8, transition: 'all 0.15s',
                  border: useCustomRes ? '2px solid #5ab9ff' : '1px dashed #3a4258',
                  background: useCustomRes ? '#15293d' : 'transparent',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, color: useCustomRes ? '#5ab9ff' : '#5b6378' }}>自定义</div>
                <div style={{ fontSize: 11, color: '#5b6378', marginTop: 2 }}>手动输入</div>
              </div>
            </div>

            {useCustomRes ? (
              <Space style={{ marginTop: 4 }}>
                <Form.Item name="designWidth" noStyle>
                  <InputNumber min={1} max={99999} style={{ width: 120 }} prefix="宽" />
                </Form.Item>
                <span style={{ color: '#5b6378' }}>×</span>
                <Form.Item name="designHeight" noStyle>
                  <InputNumber min={1} max={99999} style={{ width: 120 }} prefix="高" />
                </Form.Item>
              </Space>
            ) : (
              <>
                <Form.Item name="designWidth" hidden><Input /></Form.Item>
                <Form.Item name="designHeight" hidden><Input /></Form.Item>
              </>
            )}

            {!useCustomRes && activeRes && (
              <div style={{ fontSize: 12, color: '#5ab9ff', padding: '4px 0' }}>{activeRes} 比例已选中</div>
            )}
          </Space>
        </Form.Item>

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

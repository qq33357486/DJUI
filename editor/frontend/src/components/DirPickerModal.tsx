import { useState, useEffect, useCallback } from 'react'
import { Modal, Input, Spin, message, Button, Empty } from 'antd'
import {
  FolderOutlined, ArrowUpOutlined, ReloadOutlined, CheckOutlined,
  RightOutlined, DesktopOutlined, FolderAddOutlined,
} from '@ant-design/icons'
import * as api from '@/api/client'

interface DirPickerModalProps {
  open: boolean
  title?: string
  fieldKey?: string
  initialPath?: string
  onClose: () => void
  onSelect: (path: string) => void
}

export default function DirPickerModal({
  open, title = '选择目录', fieldKey, initialPath, onClose, onSelect,
}: DirPickerModalProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [dirs, setDirs] = useState<string[]>([])
  const [parent, setParent] = useState<string | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  // 加载盘符根
  useEffect(() => {
    api.getBrowseRoots().then(data => setRoots(data.roots))
  }, [])

  // 每个字段的浏览位置记忆 key
  const HISTORY_KEY = fieldKey ? `djui.dirHistory.${fieldKey}` : 'djui.dirHistory.default'

  // 浏览目录 + 记住位置
  const browse = useCallback(async (dir: string) => {
    setLoading(true)
    try {
      const data = await api.browseDir(dir)
      if (data.error) {
        message.error(data.error)
        return
      }
      setCurrentPath(data.current)
      setDirs(data.dirs)
      setParent(data.parent)
      setSelectedPath(data.current)
      // 记住浏览位置
      try { localStorage.setItem(HISTORY_KEY, data.current) } catch { /* ignore */ }
    } catch {
      message.error('无法读取目录')
    } finally {
      setLoading(false)
    }
  }, [HISTORY_KEY])

  // 打开时初始化：优先 initialPath > 浏览器缓存 > 第一个盘符
  useEffect(() => {
    if (open) {
      let start = initialPath
      if (!start) {
        try {
          start = localStorage.getItem(HISTORY_KEY) || undefined
        } catch { /* ignore */ }
      }
      if (!start) start = roots[0] || 'C:\\'
      if (start) browse(start)
    }
  }, [open, initialPath, roots, browse, HISTORY_KEY])

  // 进入子目录（双击或点箭头）
  const enterDir = (dirName: string) => {
    const sep = currentPath.includes('/') ? '/' : '\\'
    const fullPath = currentPath.endsWith(sep)
      ? currentPath + dirName
      : currentPath + sep + dirName
    browse(fullPath)
  }

  // 返回上级
  const goUp = () => {
    if (parent) browse(parent)
  }

  // 手动输入
  const handleManualGo = () => {
    if (manualInput.trim()) {
      browse(manualInput.trim())
      setShowManual(false)
      setManualInput('')
    }
  }

  // 新建文件夹
  const handleMkdir = async () => {
    if (!newFolderName.trim() || !currentPath) return
    setCreating(true)
    try {
      const result = await api.mkdir(currentPath, newFolderName.trim())
      if (result.ok) {
        message.success('文件夹已创建')
        setNewFolderName('')
        setShowNewFolder(false)
        // 刷新并选中新创建的目录
        await browse(result.path!)
      } else {
        message.error(result.error || '创建失败')
      }
    } catch {
      message.error('创建失败')
    } finally {
      setCreating(false)
    }
  }

  // 确认
  const handleConfirm = () => {
    const target = selectedPath || currentPath
    if (target) {
      onSelect(target)
      onClose()
    }
  }

  // 路径段（用于面包屑）
  const buildBreadcrumbs = (fullPath: string) => {
    if (!fullPath) return []
    const parts: { name: string; path: string }[] = []
    const winDrive = /^[A-Za-z]:[\\/]/.test(fullPath)
    if (winDrive) {
      const drive = fullPath.substring(0, 3) // "D:\"
      parts.push({ name: drive, path: drive })
      const rest = fullPath.substring(3).split(/[\\/]/).filter(Boolean)
      let acc = drive
      for (const part of rest) {
        acc = acc.endsWith('\\') || acc.endsWith('/') ? acc + part : acc + '\\' + part
        parts.push({ name: part, path: acc })
      }
    } else {
      // Unix
      parts.push({ name: '/', path: '/' })
      const rest = fullPath.split('/').filter(Boolean)
      let acc = ''
      for (const part of rest) {
        acc += '/' + part
        parts.push({ name: part, path: acc })
      }
    }
    return parts
  }

  const breadcrumbs = buildBreadcrumbs(currentPath)

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DesktopOutlined />
          {title}
          <Button
            size="small" type="text"
            onClick={() => setShowManual(!showManual)}
            style={{ marginLeft: 'auto', fontSize: 12 }}
          >
            {showManual ? '收起手动输入' : '手动输入路径'}
          </Button>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={680}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button
          key="ok" type="primary"
          icon={<CheckOutlined />}
          onClick={handleConfirm}
          disabled={!currentPath}
        >
          选择: {currentPath ? currentPath.split(/[\\/]/).pop() || currentPath : ''}
        </Button>,
      ]}
    >
      {/* 面包屑导航条（可点击每段跳转） */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
        padding: '6px 10px', background: '#1d2230', borderRadius: 6,
        marginBottom: 8, minHeight: 34,
      }}>
        <Button
          size="small" type="text" icon={<ArrowUpOutlined />}
          onClick={goUp}
          disabled={!parent}
          title="返回上级"
        />
        <Button
          size="small" type="text" icon={<ReloadOutlined />}
          onClick={() => browse(currentPath)}
          title="刷新"
        />
        <Button
          size="small" type="text" icon={<FolderAddOutlined />}
          onClick={() => { setShowNewFolder(!showNewFolder); setNewFolderName('') }}
          title="新建文件夹"
          style={{ color: showNewFolder ? '#5ab9ff' : undefined }}
        />
        <span style={{ color: '#5b6378', margin: '0 2px' }}>|</span>
        {breadcrumbs.map((bc, i) => (
          <span key={bc.path} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              style={{
                cursor: 'pointer', fontSize: 13,
                color: i === breadcrumbs.length - 1 ? '#5ab9ff' : '#9aa3b4',
              }}
              onClick={() => browse(bc.path)}
            >
              {bc.name}
            </span>
            {i < breadcrumbs.length - 1 && (
              <span style={{ color: '#3a4258', margin: '0 2px' }}>
                <RightOutlined style={{ fontSize: 9 }} />
              </span>
            )}
          </span>
        ))}
      </div>

      {/* 新建文件夹输入 */}
      {showNewFolder && (
        <Input.Group compact style={{ marginBottom: 8 }}>
          <Input
            style={{ width: 'calc(100% - 70px)' }}
            placeholder="输入文件夹名称"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onPressEnter={handleMkdir}
            autoFocus
          />
          <Button type="primary" onClick={handleMkdir} loading={creating} style={{ width: 70 }}>
            创建
          </Button>
        </Input.Group>
      )}

      {/* 盘符切换（Windows） */}
      {roots.length > 1 && (
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 8 }}>
          {roots.map(r => {
            const isActive = currentPath.toUpperCase().startsWith(r.substring(0, 2).toUpperCase())
            return (
              <Button
                key={r}
                size="small"
                type={isActive ? 'primary' : 'text'}
                onClick={() => browse(r)}
                style={{ minWidth: 42 }}
              >
                {r.substring(0, 2)}
              </Button>
            )
          })}
        </div>
      )}

      {/* 手动输入（折叠的） */}
      {showManual && (
        <Input.Group compact style={{ marginBottom: 8 }}>
          <Input
            style={{ width: 'calc(100% - 70px)' }}
            placeholder="粘贴路径，如 D:\path\to\project"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onPressEnter={handleManualGo}
          />
          <Button type="primary" onClick={handleManualGo} style={{ width: 70 }}>
            前往
          </Button>
        </Input.Group>
      )}

      {/* 目录列表 */}
      <Spin spinning={loading}>
        <div
          style={{
            maxHeight: 360, minHeight: 200, overflowY: 'auto',
            border: '1px solid #2a3142', borderRadius: 6,
            background: '#11151e',
          }}
        >
          {/* 返回上级 */}
          {parent !== null && (
            <div
              style={{
                padding: '7px 14px', cursor: 'pointer',
                borderBottom: '1px solid #1e2334',
                color: '#9aa3b4', fontSize: 13,
              }}
              onClick={goUp}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a2030')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <ArrowUpOutlined /> <span>..</span>
            </div>
          )}

          {/* 子目录列表 */}
          {dirs.length === 0 && !loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Empty description="没有子目录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            dirs.map(dir => {
              const sep = currentPath.includes('/') ? '/' : '\\'
              const fullPath = currentPath.endsWith(sep)
                ? currentPath + dir
                : currentPath + sep + dir
              return (
                <div
                  key={dir}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 14px', cursor: 'pointer',
                    borderBottom: '1px solid #1e2334',
                  }}
                  // 单击 = 选中
                  onClick={() => setSelectedPath(fullPath)}
                  // 双击 = 进入
                  onDoubleClick={() => enterDir(dir)}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = selectedPath === fullPath ? '#1a3a5a' : '#1a2030'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = selectedPath === fullPath ? '#1a3a5a' : 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FolderOutlined style={{ color: '#fbbf24' }} />
                    <span style={{ color: selectedPath === fullPath ? '#5ab9ff' : undefined }}>
                      {dir}
                    </span>
                  </div>
                  {/* 进入箭头 */}
                  <RightOutlined
                    style={{ color: '#3a4258', fontSize: 11 }}
                    onClick={(e) => { e.stopPropagation(); enterDir(dir) }}
                  />
                </div>
              )
            })
          )}
        </div>
      </Spin>

      {/* 底部提示 */}
      <div style={{
        marginTop: 8, fontSize: 11, color: '#5b6378', textAlign: 'center',
      }}>
        单击选中目录　|　双击进入目录　|　点 ▶ 进入　|　点 📁 新建文件夹
      </div>
    </Modal>
  )
}

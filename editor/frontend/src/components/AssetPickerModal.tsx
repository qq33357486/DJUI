import { useState, useEffect, useMemo } from 'react'
import { Modal, Spin, Empty, Input, Breadcrumb, Tree } from 'antd'
import { FolderOutlined, FileImageOutlined, SearchOutlined } from '@ant-design/icons'
import * as api from '@/api/client'
import { useAssetImage } from '@/hooks/useImageUrl'

interface AssetPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (assetPath: string) => void
  /** 自定义根目录（工作区内相对路径），不传则默认 "成品素材" */
  customRootDir?: string
  /** 返回工作区相对路径而非引擎路径（用于非打包素材如效果图） */
  rawAbsolutePath?: boolean
  /** 存储键：用于记住上次浏览的目录（不同场景独立记忆） */
  storageKey?: string
}

// 默认根素材目录：工作区内的 "成品素材"
const DEFAULT_ROOT_DIR = '成品素材'

const ROOT_KEY = '__root__'

function dirToKey(dir: string) {
  return dir || ROOT_KEY
}

function keyToDir(key: React.Key) {
  const s = String(key)
  return s === ROOT_KEY ? '' : s
}

function joinRelDir(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name
}

function patchTreeChildren(nodes: any[], key: string, children: any[]): any[] {
  return nodes.map(node => {
    if (node.key === key) return { ...node, children }
    if (node.children) return { ...node, children: patchTreeChildren(node.children, key, children) }
    return node
  })
}

export default function AssetPickerModal({ open, onClose, onSelect, customRootDir, rawAbsolutePath, storageKey }: AssetPickerModalProps) {
  // 根目录：工作区内的相对路径（如 "成品素材"）
  // '.' 表示工作区根目录
  const rootDir = customRootDir || DEFAULT_ROOT_DIR
  const isWsRoot = rootDir === '.'
  const dirStorageKey = storageKey ? `djui.lastDir.${storageKey}` : ''
  const [currentDir, setCurrentDir] = useState<string>(() => {
    // 从 localStorage 恢复上次目录
    if (dirStorageKey) {
      try { return localStorage.getItem(dirStorageKey) || '' } catch { /* ignore */ }
    }
    return ''
  })
  const [dirs, setDirs] = useState<string[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [treeData, setTreeData] = useState<any[]>([])
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([ROOT_KEY])

  // 搜索模式
  const [filter, setFilter] = useState('')
  const [flatAssets, setFlatAssets] = useState<string[]>([])
  const [searching, setSearching] = useState(false)

  // 当前目录的工作区相对路径（如 "成品素材" 或 "成品素材/icons"）
  // 如果 rootDir 是 '.'（工作区根），则直接用 currentDir
  const relCurrent = useMemo(
    () => {
      if (isWsRoot) return currentDir || ''
      return currentDir ? `${rootDir}/${currentDir}` : rootDir
    },
    [rootDir, currentDir, isWsRoot]
  )

  // 打开时恢复上次目录 + 刷新
  useEffect(() => {
    if (open) {
      if (dirStorageKey) {
        try {
          const saved = localStorage.getItem(dirStorageKey) || ''
          setCurrentDir(saved)
        } catch { /* ignore */ }
      }
      setFilter('')
      setTreeData([{
        key: ROOT_KEY,
        title: isWsRoot ? '工作区' : rootDir,
        isLeaf: false,
      }])
      setExpandedKeys([ROOT_KEY])
      setRefreshKey(k => k + 1)
    }
  }, [open, rootDir])

  // 关闭时保存当前目录
  useEffect(() => {
    if (!open && dirStorageKey) {
      try { localStorage.setItem(dirStorageKey, currentDir) } catch { /* ignore */ }
    }
  }, [open])

  const [refreshKey, setRefreshKey] = useState(0)

  // 加载当前层级（open 变化或目录变化或手动刷新时重新加载）
  useEffect(() => {
    if (!open || relCurrent === null) return
    setLoading(true)
    api.listAssets(relCurrent)
      .then(res => {
        setDirs(res.dirs)
        setFiles(res.files)
        const key = dirToKey(currentDir)
        const children = res.dirs.map((name: string) => ({
          key: dirToKey(joinRelDir(currentDir, name)),
          title: name,
          isLeaf: false,
        }))
        setTreeData(prev => patchTreeChildren(prev.length ? prev : [{ key: ROOT_KEY, title: isWsRoot ? '工作区' : rootDir, isLeaf: false }], key, children))
      })
      .catch(() => {
        setDirs([])
        setFiles([])
      })
      .finally(() => setLoading(false))
  }, [open, relCurrent, refreshKey, currentDir, rootDir])

  // 进入子目录
  const enterDir = (name: string) => {
    setCurrentDir(prev => (prev ? `${prev}/${name}` : name))
    setExpandedKeys(prev => Array.from(new Set([...prev, dirToKey(currentDir), dirToKey(joinRelDir(currentDir, name))])))
  }

  const loadTreeNode = async (node: any) => {
    const relDir = keyToDir(node.key)
    // 工作区内相对路径
    const wsRelDir = isWsRoot ? relDir : (relDir ? `${rootDir}/${relDir}` : rootDir)
    if (!wsRelDir) return
    const res = await api.listAssets(wsRelDir)
    const children = res.dirs.map((name: string) => ({
      key: dirToKey(joinRelDir(relDir, name)),
      title: name,
      isLeaf: false,
    }))
    setTreeData(prev => patchTreeChildren(prev, String(node.key), children))
  }

  // 面包屑分段：[根, ...currentDir 拆分]
  const breadcrumbs = useMemo(() => {
    const segs = currentDir ? currentDir.split('/').filter(Boolean) : []
    return [{ label: isWsRoot ? '工作区' : rootDir, path: '' }, ...segs.map((s, i) => ({
      label: s,
      path: segs.slice(0, i + 1).join('/'),
    }))]
  }, [currentDir, rootDir])

  // 触发搜索：用户输入时递归获取全部素材（只拉一次）
  useEffect(() => {
    if (!open || !rootDir) return
    if (filter.trim() === '') {
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    setFlatAssets([])
    api.listAssetsFlat(isWsRoot ? '' : rootDir)
      .then(list => { if (!cancelled) setFlatAssets(list) })
      .catch(() => { if (!cancelled) setFlatAssets([]) })
    return () => { cancelled = true }
  }, [filter, open, rootDir])

  const filtered = useMemo(() => {
    const kw = filter.trim().toLowerCase()
    if (!kw) return []
    return flatAssets.filter(a => a.toLowerCase().includes(kw))
  }, [flatAssets, filter])

  // 转换为引擎路径格式（去掉 成品素材/ 前缀，加 image/djui/）
  const toEnginePath = (relToRoot: string) => {
    return `image/djui/${relToRoot.replace(/\\/g, '/')}`
  }

  // 处理选择（点击文件）
  const handleSelectFile = (fileName: string) => {
    const relToRoot = currentDir ? `${currentDir}/${fileName}` : fileName
    if (rawAbsolutePath) {
      // 返回工作区相对路径
      onSelect(isWsRoot ? relToRoot.replace(/\\/g, '/') : `${rootDir}/${relToRoot}`.replace(/\\/g, '/'))
    } else {
      onSelect(toEnginePath(relToRoot))
    }
    onClose()
  }

  // 搜索结果选择（路径相对 root，flatAssets 返回的是工作区内完整相对路径如 "成品素材/icons/foo.png"）
  const handleSelectSearch = (wsRelPath: string) => {
    // 去掉 rootDir/ 前缀得到相对 root 的路径
    const prefix = `${rootDir}/`
    const relToRoot = wsRelPath.startsWith(prefix) ? wsRelPath.slice(prefix.length) : wsRelPath
    if (rawAbsolutePath) {
      onSelect(wsRelPath.replace(/\\/g, '/'))
    } else {
      onSelect(toEnginePath(relToRoot))
    }
    onClose()
  }

  return (
    <Modal
      title="选择素材"
      open={open}
      onCancel={onClose}
      width={760}
      footer={null}
      destroyOnClose
    >
      {/* 搜索 */}
      <Input
        placeholder="搜索全部素材（输入即跨目录搜索）..."
        prefix={<SearchOutlined />}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ marginBottom: 12 }}
        allowClear
      />

      {searching ? (
        /* ===== 搜索结果模式：平铺 ===== */
        <div style={pickerLayoutStyle}>
          <DirectoryPanel
            treeData={treeData}
            currentDir={currentDir}
            expandedKeys={expandedKeys}
            setExpandedKeys={setExpandedKeys}
            setCurrentDir={setCurrentDir}
            loadTreeNode={loadTreeNode}
          />
          <div style={assetPaneStyle}>
            <div style={{ fontSize: 12, color: '#5b6378', marginBottom: 8 }}>
              搜索到 {filtered.length} 个匹配素材（跨全部子目录）
            </div>
            <Spin spinning={flatAssets.length === 0 && filter.trim() !== ''}>
              <div style={gridContainerStyle}>
                {filtered.length === 0 && filter.trim() !== '' ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                    <Empty description="无匹配结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  </div>
                ) : filtered.map(rel => (
                  <AssetThumb
                    key={rel}
                    title={rel.split('/').pop() || rel}
                    subtitle={rel}
                    relPath={rel}
                    onClick={() => handleSelectSearch(rel)}
                  />
                ))}
              </div>
            </Spin>
          </div>
        </div>
      ) : (
        /* ===== 目录浏览模式 ===== */
        <>
          {/* 面包屑 */}
          <Breadcrumb
            style={{ marginBottom: 10 }}
            items={breadcrumbs.map((b, i) => ({
              title: i === breadcrumbs.length - 1
                ? b.label
                : <a onClick={() => setCurrentDir(b.path)}>{b.label}</a>,
            }))}
          />

          <div style={{ fontSize: 12, color: '#5b6378', marginBottom: 8 }}>
            当前目录：{dirs.length} 个子目录，{files.length} 个素材。点击文件夹进入下级。
          </div>

          <div style={pickerLayoutStyle}>
            <DirectoryPanel
              treeData={treeData}
              currentDir={currentDir}
              expandedKeys={expandedKeys}
              setExpandedKeys={setExpandedKeys}
              setCurrentDir={setCurrentDir}
              loadTreeNode={loadTreeNode}
            />
            <div style={assetPaneStyle}>
              <Spin spinning={loading}>
                <div style={gridContainerStyle}>
                  {dirs.length === 0 && files.length === 0 && !loading ? (
                    <div style={{ padding: '40px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                      <Empty description="此目录为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    </div>
                  ) : null}

                  {/* 子目录卡片 */}
                  {dirs.map(name => (
                    <div
                      key={`d-${name}`}
                      onClick={() => enterDir(name)}
                      style={dirCardStyle}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = '#ffd666'
                        e.currentTarget.style.background = '#2b2415'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = '#3a3526'
                        e.currentTarget.style.background = '#1a1610'
                      }}
                    >
                      <div style={{
                        width: '100%', height: 70,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#0d1017', borderRadius: 4, marginBottom: 4,
                      }}>
                        <FolderOutlined style={{ fontSize: 34, color: '#ffd666' }} />
                      </div>
                      <div style={nameStyle}>{name}</div>
                    </div>
                  ))}

                  {/* 文件卡片 */}
                  {files.map(name => (
                    <AssetThumb
                      key={`f-${name}`}
                      title={name}
                      relPath={`${relCurrent}/${name}`.replace(/\\/g, '/')}
                      onClick={() => handleSelectFile(name)}
                    />
                  ))}
                </div>
              </Spin>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}

function DirectoryPanel({
  treeData,
  currentDir,
  expandedKeys,
  setExpandedKeys,
  setCurrentDir,
  loadTreeNode,
}: {
  treeData: any[]
  currentDir: string
  expandedKeys: React.Key[]
  setExpandedKeys: (keys: React.Key[]) => void
  setCurrentDir: (dir: string) => void
  loadTreeNode: (node: any) => Promise<void>
}) {
  return (
    <div style={directoryPaneStyle}>
      <div style={{ fontSize: 12, color: '#9aa3b4', marginBottom: 8 }}>目录</div>
      <Tree
        treeData={treeData}
        selectedKeys={[dirToKey(currentDir)]}
        expandedKeys={expandedKeys}
        onExpand={keys => setExpandedKeys(keys)}
        onSelect={keys => {
          if (keys[0] !== undefined) setCurrentDir(keyToDir(keys[0]))
        }}
        loadData={loadTreeNode}
        blockNode
        titleRender={(node: any) => (
          <span style={treeTitleStyle} title={String(node.title)}>
            <FolderOutlined style={{ color: '#ffd666', marginRight: 6 }} />
            {node.title}
          </span>
        )}
      />
    </div>
  )
}

// ===== 素材缩略图子组件（使用 useAssetImage 异步加载 Blob URL） =====
function AssetThumb({
  title, subtitle, relPath, onClick,
}: {
  title: string
  subtitle?: string
  relPath: string
  onClick: () => void
}) {
  // relPath 是工作区内相对路径（如 "成品素材/icons/foo.png"）
  const src = useAssetImage(relPath)
  const [err, setErr] = useState(false)

  // 切换图片时重置错误状态
  useEffect(() => {
    setErr(false)
  }, [relPath])

  return (
    <div
      onClick={onClick}
      style={fileCardStyle}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#5ab9ff'
        e.currentTarget.style.background = '#15293d'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#2a3142'
        e.currentTarget.style.background = '#1d2230'
      }}
      title={subtitle ?? title}
    >
      <div style={{
        width: '100%', height: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0d1017', borderRadius: 4, marginBottom: 4, overflow: 'hidden',
      }}>
        {err ? (
          <FileImageOutlined style={{ fontSize: 28, color: '#5b6378' }} />
        ) : src ? (
          <img
            src={src}
            alt={title}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            onError={() => setErr(true)}
          />
        ) : (
          <Spin size="small" />
        )}
      </div>
      <div style={nameStyle}>{title}</div>
    </div>
  )
}

// ===== 内联样式 =====
const pickerLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '240px minmax(0, 1fr)',
  gap: 10,
  alignItems: 'stretch',
}

const directoryPaneStyle: React.CSSProperties = {
  maxHeight: 440,
  minHeight: 220,
  overflow: 'auto',
  border: '1px solid #2a3142',
  borderRadius: 6,
  background: '#11151e',
  padding: 8,
}

const assetPaneStyle: React.CSSProperties = {
  minWidth: 0,
}

const gridContainerStyle: React.CSSProperties = {
  maxHeight: 440,
  minHeight: 220,
  overflowY: 'auto',
  border: '1px solid #2a3142',
  borderRadius: 6,
  background: '#11151e',
  padding: 8,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: 8,
}

const dirCardStyle: React.CSSProperties = {
  padding: 8, cursor: 'pointer', borderRadius: 6,
  background: '#1a1610', border: '1px solid #3a3526',
  transition: 'all 0.15s', textAlign: 'center',
}

const fileCardStyle: React.CSSProperties = {
  padding: 8, cursor: 'pointer', borderRadius: 6,
  background: '#1d2230', border: '1px solid #2a3142',
  transition: 'all 0.15s', textAlign: 'center',
}

const nameStyle: React.CSSProperties = {
  fontSize: 11, color: '#9aa3b4',
  wordBreak: 'break-all',
  lineHeight: '15px',
}

const treeTitleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'flex-start',
  whiteSpace: 'normal',
  wordBreak: 'break-all',
  lineHeight: '16px',
  maxWidth: 185,
}

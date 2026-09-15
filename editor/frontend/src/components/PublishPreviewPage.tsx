// 发布素材预览：全屏检查页，按目录浏览「成品素材」下所有将被发布的素材
// 每张图右上角压引用计数角标（悬停看引用页面明细），未引用的橙色提醒
// 界面形态与适配审计一致：替换主区域，顶部返回编辑
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Input, Spin, Switch, Tag, Tooltip } from 'antd'
import {
  ArrowLeftOutlined, FileImageOutlined, FolderOutlined, SearchOutlined,
} from '@ant-design/icons'
import { projectContext } from '@/fs/projectContext'
import { useAssetImage } from '@/hooks/useImageUrl'
import {
  scanPublishAssets,
  type PublishAssetInfo,
  type PublishAssetScanResult,
} from '@/utils/publishAssetScan'

interface PublishPreviewPageProps {
  onBack: () => void
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// 引用页面明细（Tooltip 内容），最多列 15 条
function refPagesTooltip(asset: PublishAssetInfo) {
  const max = 15
  const lines = asset.refPages.slice(0, max).map(p => `${p.pageId} ×${p.count}`)
  if (asset.refPages.length > max) lines.push(`…共 ${asset.refPages.length} 个页面`)
  return (
    <div style={{ lineHeight: 1.7 }}>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

// 图片右上角的引用计数角标
function RefBadge({ asset }: { asset: PublishAssetInfo }) {
  const unused = asset.refCount === 0
  const badge = (
    <span style={{ position: 'absolute', top: 5, right: 5, zIndex: 1 }}>
      <Tag
        color={unused ? 'warning' : 'processing'}
        style={{ fontSize: 10, lineHeight: '17px', marginInlineEnd: 0, cursor: 'default', boxShadow: '0 1px 3px rgba(0,0,0,.5)' }}
      >
        {unused ? '未引用' : `引用 ${asset.refCount}`}
      </Tag>
    </span>
  )
  if (unused) return badge
  return <Tooltip title={refPagesTooltip(asset)}>{badge}</Tooltip>
}

// 素材缩略图（与 AssetPickerModal 同款 useAssetImage 加载链路），右上角压引用角标
function AssetThumb({ asset }: { asset: PublishAssetInfo }) {
  // relPath 为工作区内相对路径（成品素材/…）
  const src = useAssetImage(`成品素材/${asset.relPath}`)
  const [err, setErr] = useState(false)

  useEffect(() => { setErr(false) }, [asset.relPath])

  return (
    <div style={{ position: 'relative' }}>
      <RefBadge asset={asset} />
      <div style={{
        width: '100%', height: 84,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0d1017', borderRadius: 6, overflow: 'hidden',
      }}>
        {err ? (
          <FileImageOutlined style={{ fontSize: 30, color: '#5b6378' }} />
        ) : src ? (
          <img
            src={src}
            alt={asset.relPath}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            onError={() => setErr(true)}
          />
        ) : (
          <Spin size="small" />
        )}
      </div>
    </div>
  )
}

interface DirFolder {
  name: string
  total: number
  unused: number
}

export default function PublishPreviewPage({ onBack }: PublishPreviewPageProps) {
  const ws = projectContext.ws
  const [scan, setScan] = useState<PublishAssetScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [onlyUnused, setOnlyUnused] = useState(false)
  // 当前浏览的目录（成品素材 内相对路径，'' 为根目录）
  const [currentDir, setCurrentDir] = useState('')

  useEffect(() => {
    let cancelled = false
    void scanPublishAssets()
      .then(result => { if (!cancelled) setScan(result) })
      .catch(() => { if (!cancelled) setScan({ assets: [], totalPages: 0, failedPages: [] }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => {
    const assets = scan?.assets ?? []
    return { total: assets.length, unused: assets.filter(a => a.refCount === 0).length }
  }, [scan])

  // 目录视图 / 搜索视图。全部基于扁平 relPath 前缀切分，不依赖固定分类名，
  // 任何子目录结构（含中文目录）都能正常显示
  const view = useMemo(() => {
    const assets = scan?.assets ?? []
    const kw = keyword.trim().toLowerCase()

    if (kw) {
      const files = assets
        .filter(a => (!onlyUnused || a.refCount === 0) && a.relPath.toLowerCase().includes(kw))
        .sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-CN'))
      return { mode: 'search' as const, folders: [] as DirFolder[], files }
    }

    const prefix = currentDir ? `${currentDir}/` : ''
    const folderAgg = new Map<string, DirFolder>()
    const files: PublishAssetInfo[] = []
    for (const asset of assets) {
      if (!asset.relPath.startsWith(prefix)) continue
      const rest = asset.relPath.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash < 0) {
        if (!onlyUnused || asset.refCount === 0) files.push(asset)
      } else {
        const name = rest.slice(0, slash)
        const agg = folderAgg.get(name) ?? { name, total: 0, unused: 0 }
        agg.total++
        if (asset.refCount === 0) agg.unused++
        folderAgg.set(name, agg)
      }
    }
    const folders = [...folderAgg.values()]
      .filter(f => !onlyUnused || f.unused > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    files.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'))
    return { mode: 'dir' as const, folders, files }
  }, [scan, keyword, onlyUnused, currentDir])

  if (!ws) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: '#0f1117' }}><Empty description="请先打开工程目录" /></div>
  }

  const crumbs = ['成品素材', ...currentDir.split('/').filter(Boolean)]
  const filtering = onlyUnused || keyword.trim().length > 0

  return (
    <div style={{ height: '100%', minHeight: 0, background: '#0f1117', color: '#dfe7f5', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px', borderBottom: '1px solid #2a3142' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回编辑</Button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>发布素材预览</div>
          <div style={{ color: '#9aa3b4', marginTop: 3, fontSize: 12 }}>
            共 {stats.total} 个素材（发布时整个「成品素材」目录会复制到星火工程） · 未引用 {stats.unused} 个 · 已扫描 {scan?.totalPages ?? 0} 个页面
            {scan && scan.failedPages.length > 0 && (
              <Tag color="warning" style={{ marginLeft: 8, fontSize: 11 }}>{scan.failedPages.length} 个页面加载失败已跳过</Tag>
            )}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: '1px solid #2a3142', flexWrap: 'wrap' }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#5b6378' }} />}
          placeholder="搜索全部素材（按名称/路径）"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: 280 }}
        />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#9aa3b4' }}>
          <Switch size="small" checked={onlyUnused} onChange={setOnlyUnused} />
          只看未引用（{stats.unused}）
        </span>
        {filtering && <span style={{ fontSize: 12, color: '#5b6378' }}>匹配 {view.files.length} 个素材</span>}
      </div>

      {/* 目录面包屑（搜索模式下置灰不可点） */}
      {!keyword.trim() && (
        <div style={{ padding: '10px 24px 0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {crumbs.map((name, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: '#5b6378' }}>/</span>}
                <span
                  onClick={isLast ? undefined : () => setCurrentDir(crumbs.slice(1, i + 1).join('/'))}
                  style={{ color: isLast ? '#dfe7f5' : '#5ab9ff', cursor: isLast ? 'default' : 'pointer' }}
                >
                  {name}
                </span>
              </span>
            )
          })}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 24px 28px' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 12 }}>
            <Spin size="large" />
            <span style={{ color: '#9aa3b4', fontSize: 13 }}>正在扫描素材与页面引用…</span>
          </div>
        ) : view.folders.length === 0 && view.files.length === 0 ? (
          <Empty description={stats.total === 0 ? '成品素材目录为空' : (keyword.trim() ? '没有匹配的素材' : '此目录下没有匹配的素材')} style={{ marginTop: 80 }} />
        ) : (
          <>
            {/* 子目录 */}
            {view.folders.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
                {view.folders.map(folder => {
                  const childPath = currentDir ? `${currentDir}/${folder.name}` : folder.name
                  return (
                    <button
                      key={folder.name}
                      onClick={() => setCurrentDir(childPath)}
                      style={{
                        textAlign: 'left', cursor: 'pointer', color: '#dfe7f5',
                        background: '#151924', border: '1px solid #2a3142', borderRadius: 8,
                        padding: '12px 12px', display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                      }}
                    >
                      <FolderOutlined style={{ color: '#ffd666', fontSize: 20, flexShrink: 0 }} />
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</strong>
                        <span style={{ display: 'block', fontSize: 11, color: folder.unused > 0 ? '#ff8c42' : '#5b6378', marginTop: 2 }}>
                          {folder.total} 个文件{folder.unused > 0 ? ` · ${folder.unused} 未引用` : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* 素材文件网格 */}
            {view.files.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, alignItems: 'start' }}>
                {view.files.map(asset => (
                  <div
                    key={asset.relPath}
                    style={{
                      background: asset.refCount === 0 ? '#221a12' : '#151924',
                      border: '1px solid ' + (asset.refCount === 0 ? '#5a4630' : '#2a3142'),
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <AssetThumb asset={asset} />
                    <div
                      title={asset.fileName}
                      style={{ marginTop: 8, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {asset.fileName}
                    </div>
                    <div
                      title={view.mode === 'search' ? asset.relPath : undefined}
                      style={{ marginTop: 3, color: '#5b6378', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {view.mode === 'search' ? asset.relPath : formatSize(asset.sizeBytes) || '　'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

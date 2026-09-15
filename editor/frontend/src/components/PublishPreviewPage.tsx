// 发布素材预览：全屏检查页，罗列「成品素材」下所有将被发布的素材并标记引用情况
// 界面形态与适配审计一致：替换主区域，顶部返回编辑
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Input, Spin, Switch, Tag, Tooltip } from 'antd'
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons'
import { projectContext } from '@/fs/projectContext'
import * as fs from '@/fs/fsAccess'
import {
  scanPublishAssets,
  FINISHED_SUBDIRS,
  type PublishAssetInfo,
  type PublishAssetScanResult,
} from '@/utils/publishAssetScan'

interface PublishPreviewPageProps {
  onBack: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  backgrounds: '背景 backgrounds',
  buttons: '按钮 buttons',
  frames: '边框 frames',
  icons: '图标 icons',
  lists: '列表 lists',
  decorations: '装饰 decorations',
  text: '文字 text',
  misc: '杂项 misc',
  其他: '其他（根目录散文件）',
}

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '大小未知'
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

// 缩略图：Blob URL 有全局缓存（与画布共用），不在卸载时 revoke
function AssetThumb({ relPath }: { relPath: string }) {
  const ws = projectContext.ws
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!ws) return
    void fs.getImageBlobUrl(ws, `成品素材/${relPath}`).then(u => {
      if (!cancelled) setUrl(u)
    })
    return () => { cancelled = true }
  }, [ws, relPath])

  return (
    <div style={{ width: '100%', height: 76, background: '#0d0f15', borderRadius: 6, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {url
        ? <img src={url} alt={relPath} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        : <span style={{ color: '#5b6378', fontSize: 11 }}>无预览</span>}
    </div>
  )
}

export default function PublishPreviewPage({ onBack }: PublishPreviewPageProps) {
  const ws = projectContext.ws
  const [scan, setScan] = useState<PublishAssetScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [onlyUnused, setOnlyUnused] = useState(false)

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

  const groups = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const byCategory = new Map<string, PublishAssetInfo[]>()
    let matched = 0
    for (const asset of scan?.assets ?? []) {
      if (onlyUnused && asset.refCount > 0) continue
      if (kw && !asset.relPath.toLowerCase().includes(kw)) continue
      matched++
      const list = byCategory.get(asset.category)
      if (list) list.push(asset)
      else byCategory.set(asset.category, [asset])
    }
    const order = [...FINISHED_SUBDIRS, '其他']
    return {
      matched,
      list: order
        .filter(cat => byCategory.has(cat))
        .map(cat => ({
          category: cat,
          items: byCategory.get(cat)!.slice().sort(
            (a, b) => b.refCount - a.refCount || a.relPath.localeCompare(b.relPath)
          ),
        })),
    }
  }, [scan, keyword, onlyUnused])

  if (!ws) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: '#0f1117' }}><Empty description="请先打开工程目录" /></div>
  }

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: '1px solid #2a3142' }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#5b6378' }} />}
          placeholder="搜索文件名或路径"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: 260 }}
        />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#9aa3b4' }}>
          <Switch size="small" checked={onlyUnused} onChange={setOnlyUnused} />
          只看未引用（{stats.unused}）
        </span>
        {filtering && <span style={{ fontSize: 12, color: '#5b6378' }}>匹配 {groups.matched} 个</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 28px' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spin tip="正在扫描素材与页面引用…" /></div>
        ) : groups.list.length === 0 ? (
          <Empty description={stats.total === 0 ? '成品素材目录为空' : '没有匹配的素材'} style={{ marginTop: 80 }} />
        ) : (
          groups.list.map(group => (
            <section key={group.category} style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 14 }}>{categoryLabel(group.category)}</strong>
                <span style={{ color: '#5b6378', fontSize: 12 }}>{group.items.length} 个</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, alignItems: 'start' }}>
                {group.items.map(asset => {
                  const unused = asset.refCount === 0
                  return (
                    <div
                      key={asset.relPath}
                      style={{
                        background: unused ? '#221a12' : '#151924',
                        border: '1px solid ' + (unused ? '#5a4630' : '#2a3142'),
                        borderRadius: 10,
                        padding: 10,
                      }}
                    >
                      <AssetThumb relPath={asset.relPath} />
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong
                          title={asset.fileName}
                          style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {asset.fileName}
                        </strong>
                        {unused ? (
                          <Tag color="warning" style={{ fontSize: 11, marginInlineEnd: 0 }}>未引用</Tag>
                        ) : (
                          <Tooltip title={refPagesTooltip(asset)}>
                            <Tag color="processing" style={{ fontSize: 11, marginInlineEnd: 0, cursor: 'default' }}>
                              引用 {asset.refCount} 次
                            </Tag>
                          </Tooltip>
                        )}
                      </div>
                      <div title={asset.relPath} style={{ marginTop: 4, color: '#5b6378', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {asset.relPath}
                      </div>
                      <div style={{ marginTop: 2, color: '#5b6378', fontSize: 11 }}>{formatSize(asset.sizeBytes)}</div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

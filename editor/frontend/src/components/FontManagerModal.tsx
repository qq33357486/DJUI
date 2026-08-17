import { useMemo, useRef, useState } from 'react'
import { Modal, Table, Button, Input, message, Popconfirm, Alert } from 'antd'
import { UploadOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { useProjectStore } from '@/store/projectStore'
import * as api from '@/api/client'
import { loadEngineFonts, resetFontRegistry } from '@/lib/fontLoader'


export default function FontManagerModal() {
  const { fontInfos, fontManagerOpen, setFontManagerOpen, refreshFonts, bumpFontVersion } = useProjectStore()
  const [importing, setImporting] = useState(false)
  const [familyName, setFamilyName] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pendingFile = useRef<File | null>(null)

  const rows = useMemo(() => fontInfos.filter(f => f.imported).map(f => ({
    key: f.family,
    family: f.family,
    files: f.files,
  })), [fontInfos])

  async function refreshAll() {
    await refreshFonts()
    resetFontRegistry()
    await loadEngineFonts()
    bumpFontVersion()
  }

  async function handleImport() {
    const file = pendingFile.current
    if (!file) {
      message.warning('请先选择字体文件（.ttf / .otf / .ttc）')
      return
    }
    setImporting(true)
    try {
      const result = await api.importFontFile(file, familyName)
      if (result.ok && result.family) {
        message.success(`字体已导入：${result.family}（画布与引擎使用同一文件）`)
        setFamilyName('')
        pendingFile.current = null
        if (fileRef.current) fileRef.current.value = ''
        await refreshAll()
      } else {
        message.error(result.error ?? '导入失败')
      }
    } catch (err) {
      message.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleRemove(family: string) {
    try {
      const result = await api.removeImportedFont(family)
      if (result.ok) {
        message.success(`已删除字体：${family}`)
        await refreshAll()
      } else {
        message.error(result.error ?? '删除失败')
      }
    } catch (err) {
      message.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <Modal
      title="字体管理"
      open={fontManagerOpen}
      onCancel={() => setFontManagerOpen(false)}
      footer={null}
      width={680}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="导入 .ttf / .otf / .ttc 字体文件后，即可在字体下拉中选择；画布与引擎使用同一个文件渲染，效果完全一致。"
        description="未选择任何字体时，使用引擎默认字体。"
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Input
          style={{ width: 200 }}
          size="small"
          placeholder="字体族名（默认取文件名）"
          value={familyName}
          onChange={e => setFamilyName(e.target.value)}
          disabled={importing}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.ttc"
          style={{ display: 'none' }}
          onChange={e => { pendingFile.current = e.target.files?.[0] ?? null; if (e.target.files?.[0]) message.info(`已选择：${e.target.files[0].name}`) }}
        />
        <Button size="small" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} disabled={importing}>
          选择字体文件
        </Button>
        <Button size="small" type="primary" loading={importing} onClick={handleImport}>
          导入到工程
        </Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={refreshAll} disabled={importing}>
          刷新
        </Button>
      </div>

      <Table
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: '字体族',
            dataIndex: 'family',
            render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
          },

          {
            title: '文件',
            dataIndex: 'files',
            render: (files: string[]) => files.length > 0 ? files.join(', ') : '—',
          },
          {
            title: '操作',
            width: 80,
            render: (_: unknown, row: { family: string }) => (
              <Popconfirm
                title={`删除字体 ${row.family}？`}
                description="将删除工程中的字体目录与注册信息"
                okText="删除"
                cancelText="取消"
                onConfirm={() => handleRemove(row.family)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
    </Modal>
  )
}

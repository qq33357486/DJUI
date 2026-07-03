import { useEffect, useMemo, useState } from 'react'
import { Modal, Space, Button, Select, Input, Empty, Spin, message, Tag, Tooltip, Alert } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { COMPONENT_LIBRARY } from '@/types/layout'
import { useProjectStore } from '@/store/projectStore'
import * as api from '@/api/client'

interface SoundConfigModalProps {
  open: boolean
  onClose: () => void
}

const CONTROL_TYPE_OPTIONS = Array.from(new Map(
  COMPONENT_LIBRARY.map(c => [c.starType, { value: c.starType, label: c.label }])
).values())

const ALL_CONTROLS_VALUE = '__ALL_CONTROLS__'
const CONTROL_TYPE_SELECT_OPTIONS = [
  { value: ALL_CONTROLS_VALUE, label: '全部控件' },
  ...CONTROL_TYPE_OPTIONS,
]

function makeSoundId(existing: api.DjuiSoundItem[]): string {
  const base = `sound_${existing.length + 1}`
  let id = base
  let i = 2
  const ids = new Set(existing.map(x => x.id))
  while (ids.has(id)) {
    id = `${base}_${i++}`
  }
  return id
}

function controlTypesToSelectValue(controlTypes: string[] | undefined): string[] {
  return controlTypes && controlTypes.length > 0 ? controlTypes : [ALL_CONTROLS_VALUE]
}

function selectValueToControlTypes(values: string[], previousControlTypes: string[] | undefined): string[] {
  const withoutAll = values.filter(value => value !== ALL_CONTROLS_VALUE)
  const previousWasAll = !previousControlTypes || previousControlTypes.length === 0
  if (values.length === 0) return []
  if (!values.includes(ALL_CONTROLS_VALUE)) return withoutAll
  return previousWasAll && withoutAll.length > 0 ? withoutAll : []
}

function appliesToButton(sound: api.DjuiSoundItem): boolean {
  return sound.controlTypes.length === 0 || sound.controlTypes.includes('Button')
}

export default function SoundConfigModal({ open, onClose }: SoundConfigModalProps) {
  const { config } = useProjectStore()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [gameDataSounds, setGameDataSounds] = useState<api.GameDataSoundEntry[]>([])
  const [sounds, setSounds] = useState<api.DjuiSoundItem[]>([])
  const [defaultButtonSoundId, setDefaultButtonSoundId] = useState<string | null>(null)

  const projectPath = config?.starProjectPath ?? ''

  const load = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [entries, soundConfig] = await Promise.all([
        api.getGameDataSounds(),
        api.getSoundConfig(),
      ])
      setGameDataSounds(entries)
      setSounds(soundConfig.sounds)
      setDefaultButtonSoundId(soundConfig.defaultButtonSoundId)
    } catch {
      message.error('读取音效配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath])

  const sourceOptions = useMemo(() => gameDataSounds.map(s => ({
    value: s.gameDataPath,
    label: `${s.category ? `${s.category}/` : ''}${s.name}`,
  })), [gameDataSounds])

  const buttonSoundOptions = useMemo(() => sounds
    .filter(appliesToButton)
    .map(sound => ({
      value: sound.id,
      label: `${sound.name || sound.id}${sound.category ? `（${sound.category}）` : ''}`,
    })), [sounds])

  const addEmpty = () => {
    setSounds(prev => [
      ...prev,
      {
        id: makeSoundId(prev),
        name: '',
        gameDataPath: '',
        asset: '',
        category: '',
        controlTypes: ['Button'],
      },
    ])
  }

  const updateSound = (index: number, updates: Partial<api.DjuiSoundItem>) => {
    setSounds(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item))
  }

  const changeSource = (index: number, gameDataPath: string) => {
    const entry = gameDataSounds.find(x => x.gameDataPath === gameDataPath)
    if (!entry) return
    updateSound(index, {
      gameDataPath: entry.gameDataPath,
      asset: entry.asset,
      category: entry.category,
    })
  }

  const removeSound = (index: number) => {
    const removed = sounds[index]
    if (removed?.id === defaultButtonSoundId) setDefaultButtonSoundId(null)
    setSounds(prev => prev.filter((_, i) => i !== index))
  }

  const save = async () => {
    if (!projectPath) return
    setSaving(true)
    try {
      const normalizedSounds = sounds.map(sound => ({
        ...sound,
        name: sound.name.trim(),
        controlTypes: sound.controlTypes ?? [],
      }))
      const missingNameIndex = normalizedSounds.findIndex(sound => !sound.name)
      if (missingNameIndex >= 0) {
        message.warning(`第 ${missingNameIndex + 1} 条音效缺少显示名`)
        return
      }
      const missingSourceIndex = normalizedSounds.findIndex(sound => !sound.gameDataPath)
      if (missingSourceIndex >= 0) {
        message.warning(`第 ${missingSourceIndex + 1} 条音效缺少音源`)
        return
      }
      const defaultSound = normalizedSounds.find(sound => sound.id === defaultButtonSoundId && appliesToButton(sound))
      if (normalizedSounds.length > 0 && !defaultSound) {
        message.warning('请选择一个适用于 Button 的按钮默认音效')
        return
      }

      const saved = await api.saveSoundConfig('', {
        version: 2,
        defaultButtonSoundId: defaultSound?.id ?? null,
        sounds: normalizedSounds,
      })
      setSounds(saved.sounds)
      setDefaultButtonSoundId(saved.defaultButtonSoundId)
      window.dispatchEvent(new CustomEvent('djui:soundsChanged'))
      message.success('声音配置已保存')
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存声音配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="声音配置"
      open={open}
      width={860}
      onCancel={onClose}
      onOk={save}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
    >
      {!projectPath ? (
        <Empty description="请先配置星火工程目录" />
      ) : loading ? (
        <Spin />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button icon={<PlusOutlined />} type="primary" onClick={addEmpty}>
              添加音效
            </Button>
            <Tooltip title="重新扫描数编音效">
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
          </Space>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: 8,
              alignItems: 'center',
              padding: 8,
              border: '1px solid #2a3142',
              borderRadius: 6,
              background: '#171b26',
            }}
          >
            <span style={{ color: '#cdd6e4', fontSize: 12 }}>按钮默认音效</span>
            <Select
              size="small"
              showSearch
              value={defaultButtonSoundId ?? undefined}
              onChange={value => setDefaultButtonSoundId(value ?? null)}
              options={buttonSoundOptions}
              optionFilterProp="label"
              placeholder={buttonSoundOptions.length === 0 ? '先添加适用于 Button 的音效' : '选择 Button 默认点击音效'}
              disabled={buttonSoundOptions.length === 0}
            />
          </div>

          {gameDataSounds.length === 0 && (
            <Alert
              type="info"
              showIcon
              message="未找到 GameDataSound 数编"
              description="请先在星火数编里新增一个音频数据，再回 DJUI 重新扫描；如果项目暂时不需要按钮音效，也可以不配置。"
            />
          )}

          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {sounds.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 240px 180px 1fr 32px',
                  gap: 8,
                  padding: '0 8px',
                  color: '#8d96aa',
                  fontSize: 12,
                }}
              >
                <span>显示名</span>
                <span>音源</span>
                <span>适用控件</span>
                <span>资源路径</span>
                <span />
              </div>
            )}
            {sounds.map((sound, index) => (
              <div
                key={`${sound.id}-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 240px 180px 1fr 32px',
                  gap: 8,
                  alignItems: 'center',
                  padding: 8,
                  border: '1px solid #2a3142',
                  borderRadius: 6,
                  background: '#1d2230',
                }}
              >
                <Input
                  size="small"
                  value={sound.name}
                  onChange={e => updateSound(index, { name: e.target.value })}
                  placeholder="显示名"
                />
                <Select
                  size="small"
                  showSearch
                  value={sound.gameDataPath || undefined}
                  onChange={v => changeSource(index, v)}
                  options={sourceOptions}
                  optionFilterProp="label"
                  placeholder="数编来源"
                  disabled={gameDataSounds.length === 0}
                />
                <Select
                  size="small"
                  mode="multiple"
                  value={controlTypesToSelectValue(sound.controlTypes)}
                  onChange={v => {
                    const controlTypes = selectValueToControlTypes(v, sound.controlTypes)
                    if (sound.id === defaultButtonSoundId && controlTypes.length > 0 && !controlTypes.includes('Button')) {
                      setDefaultButtonSoundId(null)
                    }
                    updateSound(index, { controlTypes })
                  }}
                  options={CONTROL_TYPE_SELECT_OPTIONS}
                  placeholder="控件类型"
                  maxTagCount="responsive"
                />
                <Tooltip title={sound.asset}>
                  <Tag style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                    {sound.asset || '选择音源后自动带出'}
                  </Tag>
                </Tooltip>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeSound(index)}
                />
              </div>
            ))}
            {sounds.length === 0 && <Empty description="点击添加音效创建配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Space>
        </Space>
      )}
    </Modal>
  )
}

import { Tree, Empty, Modal, Tag, Tooltip, Button, Dropdown, Input } from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  FileOutlined, DeleteOutlined, PlusOutlined,
  AppstoreOutlined, BlockOutlined,
  LockOutlined, UnlockOutlined, EyeOutlined, EyeInvisibleOutlined,
  CopyOutlined, SnippetsOutlined, ScissorOutlined,
} from '@ant-design/icons'
import { UiNode, UiPage, COMPONENT_LIBRARY } from '@/types/layout'
import { useEditorStore, findNode, findParent, createNode, setClipboard } from '@/store/editorStore'
import { useState, useMemo, useEffect } from 'react'

// 在所有页面中查找节点（用于锁/可见性切换）
function findNodeInAll(allPages: Record<string, UiPage>, id: string): UiNode | null {
  for (const p of Object.values(allPages)) {
    const found = findNode(p.root, id)
    if (found) return found
  }
  return null
}

interface LeftPanelProps {
  pages: string[]
  onNewPage: (pageId: string, nodeKind: 'window' | 'template') => void
  onSwitchPage: (pageId: string) => void
  onDeletePage: (pageId: string) => void
}

// 控件树节点 → AntD DataNode
function buildControlTree(
  node: UiNode,
  selectedIds: string[],
  onToggleLock: (id: string) => void,
  onToggleHidden: (id: string) => void,
  renamingId: string | null,
  renamingValue: string,
  onRenameStart: (id: string, name: string) => void,
  onRenameChange: (value: string) => void,
  onRenameConfirm: () => void,
  onRenameCancel: () => void,
  onCtxRightClick: (e: React.MouseEvent, nodeKey: string) => void,
): DataNode {
  const isSelected = selectedIds.includes(node.id)
  const locked = node.editorLocked
  const hidden = node.editorHidden
  const isRenaming = renamingId === node.id
  return {
    key: node.id,
    title: (
      <div
        onContextMenu={(e) => onCtxRightClick(e, node.id)}
        style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        opacity: hidden ? 0.45 : 1,
      }}>
        {isRenaming ? (
          <Input
            size="small"
            value={renamingValue}
            onChange={e => onRenameChange(e.target.value)}
            onPressEnter={onRenameConfirm}
            onKeyDown={e => { if (e.key === 'Escape') onRenameCancel() }}
            onBlur={onRenameConfirm}
            autoFocus
            style={{ flex: 1, fontSize: 12 }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            style={{
              color: isSelected ? '#5ab9ff' : undefined,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
              cursor: 'default',
            }}
            onDoubleClick={(e) => { e.stopPropagation(); onRenameStart(node.id, node.name || node.starType) }}
          >
            {node.name || node.starType}
            <Tag style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px' }}>
              {node.starType === 'TemplateInstance' ? `模板:${node.templateRef ?? '未选'}` : node.starType}
            </Tag>
          </span>
        )}
        {!isRenaming && (
          <span style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }} onClick={e => e.stopPropagation()}>
            <Tooltip title={locked ? '解锁' : '锁定'}>
              <span onClick={() => onToggleLock(node.id)} style={{ cursor: 'pointer', color: locked ? '#5ab9ff' : '#5b6378' }}>
                {locked ? <LockOutlined /> : <UnlockOutlined style={{ opacity: 0.3 }} />}
              </span>
            </Tooltip>
            <Tooltip title={hidden ? '显示' : '隐藏'}>
              <span onClick={() => onToggleHidden(node.id)} style={{ cursor: 'pointer', color: '#5b6378' }}>
                {hidden ? <EyeInvisibleOutlined style={{ color: '#ff8c42' }} /> : <EyeOutlined />}
              </span>
            </Tooltip>
          </span>
        )}
      </div>
    ),
    children: node.starType === 'TemplateInstance'
      ? []
      : node.children.map(c => buildControlTree(c, selectedIds, onToggleLock, onToggleHidden, renamingId, renamingValue, onRenameStart, onRenameChange, onRenameConfirm, onRenameCancel, onCtxRightClick)),
  }
}

// 页面 key 前缀（区分页面级 key 和控件级 key）
const PAGE_KEY = (pageId: string) => `__page:${pageId}`

export default function LeftPanel({ pages, onNewPage, onSwitchPage, onDeletePage }: LeftPanelProps) {
  const { allPages, activePageId, selectedIds, selectNode, moveNode, setActivePage, updateNode, addNode, removeNode, duplicateNode, pasteNode } = useEditorStore()

  const [newPageOpen, setNewPageOpen] = useState(false)

  const toggleLock = (id: string) => {
    const node = findNodeInAll(allPages, id)
    if (node) updateNode(id, { editorLocked: !node.editorLocked })
  }
  const toggleHidden = (id: string) => {
    const node = findNodeInAll(allPages, id)
    if (node) updateNode(id, { editorHidden: !node.editorHidden })
  }

  // === 右键菜单 ===
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeKey: string } | null>(null)

  const handleRightClick = (e: React.MouseEvent, nodeKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeKey })
  }

  // 右键菜单操作
  const ctxIsPage = ctxMenu?.nodeKey.startsWith('__page:') ?? false
  const ctxIsControl = ctxMenu && !ctxIsPage
  const ctxControlId = ctxIsControl ? ctxMenu!.nodeKey : null

  const ctxCopy = () => {
    if (!ctxControlId) return
    const node = findNodeInAll(allPages, ctxControlId)
    if (node) {
      // 使用 store 的 clipboard（与快捷键统一）
      setClipboard(JSON.parse(JSON.stringify(node)))
    }
    setCtxMenu(null)
  }
  const ctxPaste = () => {
    if (!ctxControlId) return
    pasteNode(ctxControlId)
    setCtxMenu(null)
  }
  const ctxDuplicate = () => {
    if (!ctxControlId) return
    duplicateNode(ctxControlId)
    setCtxMenu(null)
  }
  const ctxDelete = () => {
    if (!ctxControlId) return
    removeNode(ctxControlId)
    setCtxMenu(null)
  }
  const ctxRename = () => {
    if (!ctxControlId) return
    const node = findNodeInAll(allPages, ctxControlId)
    if (node) onRenameStart(node.id, node.name || node.starType)
    setCtxMenu(null)
  }
  const ctxAddChild = (label: string) => {
    if (!ctxControlId) return
    const newNode = createNode(label, label)
    addNode(ctxControlId, newNode)
    setCtxMenu(null)
  }

  // 右键菜单 items
  const ctxMenuItems: any[] = []
  if (ctxIsControl) {
    ctxMenuItems.push(
      { key: 'copy', label: '复制', icon: <CopyOutlined />, onClick: ctxCopy },
      { key: 'paste', label: '粘贴', icon: <SnippetsOutlined />, onClick: ctxPaste },
      { key: 'dup', label: '克隆', icon: <CopyOutlined />, onClick: ctxDuplicate },
      { key: 'rename', label: '重命名', onClick: ctxRename },
      { type: 'divider' },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: ctxDelete },
      { type: 'divider' },
      {
        key: 'add',
        label: '新建子控件',
        icon: <PlusOutlined />,
        children: COMPONENT_LIBRARY.map(c => ({
          key: `add-${c.label}`,
          label: `${c.icon} ${c.label}`,
          onClick: () => ctxAddChild(c.label),
        })),
      },
    )
  }

  const [newPageName, setNewPageName] = useState('')
  const [newPageKind, setNewPageKind] = useState<'window' | 'template'>('window')
  // 重命名状态
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')

  const onRenameStart = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenamingValue(currentName)
  }
  const onRenameConfirm = () => {
    if (renamingId && renamingValue.trim()) {
      updateNode(renamingId, { name: renamingValue.trim() })
    }
    setRenamingId(null)
  }
  const onRenameCancel = () => setRenamingId(null)

  // F2 重命名快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === 'F2') {
        e.preventDefault()
        if (selectedIds.length > 0) {
          const node = findNodeInAll(allPages, selectedIds[selectedIds.length - 1])
          if (node) onRenameStart(node.id, node.name || node.starType)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedIds, allPages])

  const handleDeletePage = (pageId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    Modal.confirm({
      title: '删除',
      content: `确定删除「${pageId}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => onDeletePage(pageId),
    })
  }

  // === 构建树：所有页面作为顶层兄弟节点 ===
  const treeData: DataNode[] = useMemo(() => {
    return pages.map(p => {
      const page = allPages[p]
      const isActive = activePageId === p
      const nodeKind = page?.nodeKind
      const icon = nodeKind === 'template' ? <BlockOutlined /> : <AppstoreOutlined />
      const kindTag = nodeKind === 'template' ? '模板' : nodeKind === 'window' ? '窗口' : '未配置'

      if (!page) {
        // 未加载的页面，只显示标题
        return {
          key: PAGE_KEY(p),
          title: (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#5ab9ff' : '#cdd6e4',
            }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {icon}
                <span style={{ marginLeft: 6 }}>{p}</span>
                <Tag style={{ marginLeft: 6, fontSize: 10 }}>{kindTag}</Tag>
              </span>
            </div>
          ),
          children: [],
        }
      }

      return {
        key: PAGE_KEY(p),
        title: (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontWeight: isActive ? 600 : 400,
            color: isActive ? '#5ab9ff' : '#cdd6e4',
          }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {icon}
              <span style={{ marginLeft: 6 }}>{p}</span>
              <Tag style={{ marginLeft: 6, fontSize: 10 }}>{kindTag}</Tag>
            </span>
            <Tooltip title="删除">
              <DeleteOutlined
                onClick={(e) => handleDeletePage(p, e)}
                style={{ color: '#5b6378', flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff6b6b' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#5b6378' }}
              />
            </Tooltip>
          </div>
        ),
        children: page.root.children.map(c => buildControlTree(c, selectedIds, toggleLock, toggleHidden, renamingId, renamingValue, onRenameStart, setRenamingValue, onRenameConfirm, onRenameCancel, handleRightClick)),
      }
    })
  }, [pages, allPages, activePageId, selectedIds, renamingId, renamingValue])

  // 展开状态
  const [userExpanded, setUserExpanded] = useState<React.Key[]>([])
  const expandedKeys: React.Key[] = useMemo(() => {
    const keys = new Set<React.Key>()
    // 当前页面自动展开
    if (activePageId) keys.add(PAGE_KEY(activePageId))
    userExpanded.forEach(k => keys.add(k))
    // 选中节点的所有祖先自动展开（临时，不影响 userExpanded）
    const state = useEditorStore.getState()
    const currentPage = state.allPages[state.activePageId ?? '']
    if (currentPage) {
      for (const id of state.selectedIds) {
        let parent = findParent(currentPage.root, id)
        while (parent && parent.id !== currentPage.root.id) {
          keys.add(parent.id)
          parent = findParent(currentPage.root, parent.id)
        }
      }
    }
    return Array.from(keys)
    // 故意不把 selectedIds 放依赖，避免删除/选中导致展开状态闪烁
  }, [userExpanded, activePageId])

  const handleExpand = (keys: React.Key[]) => {
    setUserExpanded(keys as React.Key[])
  }
  // 选中变化时，自动展开选中节点的祖先（合并进 userExpanded，不会收起已有的）
  useEffect(() => {
    if (selectedIds.length === 0) return
    const state = useEditorStore.getState()
    const currentPage = state.allPages[state.activePageId ?? '']
    if (!currentPage) return
    const newKeys = new Set<React.Key>(userExpanded)
    let changed = false
    for (const id of selectedIds) {
      let parent = findParent(currentPage.root, id)
      while (parent && parent.id !== currentPage.root.id) {
        if (!newKeys.has(parent.id)) { newKeys.add(parent.id); changed = true }
        parent = findParent(currentPage.root, parent.id)
      }
    }
    if (changed) setUserExpanded(Array.from(newKeys))
  }, [selectedIds])

  // 选中
  const handleSelect = (keys: React.Key[]) => {
    if (keys.length === 0) return
    const key = String(keys[0])
    // 页面节点：切换激活 + 清除控件选中（显示页面属性面板）
    if (key.startsWith('__page:')) {
      const pageId = key.slice('__page:'.length)
      // 即使是当前页面也要清除选中
      useEditorStore.getState().clearSelection()
      onSwitchPage(pageId)
      return
    }
    // 控件节点
    selectNode(key)
  }

  // 拖拽改层级（仅控件间，不能跨页面）
  const handleDrop: React.ComponentProps<typeof Tree>['onDrop'] = (info) => {
    const dragKey = String(info.dragNode.key)
    const dropKey = String(info.node?.key ?? '')
    const dropPos = info.dropPosition
    const dropToGap = info.dropToGap

    // 页面节点不可拖拽
    if (dragKey.startsWith('__page:')) return

    // 拖到页面节点上或页面节点的间隙 → 成为该页面的根级子节点
    if (dropKey.startsWith('__page:')) {
      moveNode(dragKey, 'root', 'inside')
      return
    }

    let targetId: string
    let position: 'before' | 'after' | 'inside'

    if (dropToGap) {
      targetId = dropKey
      position = dropPos <= 0 ? 'before' : 'after'
    } else {
      targetId = dropKey
      position = 'inside'
    }

    moveNode(dragKey, targetId, position)
  }

  // 新建下拉菜单
  const newMenuItems = [
    {
      key: 'window',
      label: '新建窗口',
      icon: <AppstoreOutlined />,
      onClick: () => { setNewPageKind('window'); setNewPageName(''); setNewPageOpen(true) },
    },
    {
      key: 'template',
      label: '新建模板',
      icon: <BlockOutlined />,
      onClick: () => { setNewPageKind('template'); setNewPageName(''); setNewPageOpen(true) },
    },
  ]

  // 当前选中（页面级 or 控件级）
  const selectedKeys: React.Key[] = useMemo(() => {
    if (selectedIds.length > 0) return [selectedIds[selectedIds.length - 1]]
    if (activePageId) return [PAGE_KEY(activePageId)]
    return []
  }, [selectedIds, activePageId])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* === 标题栏 + 新建按钮 === */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px 6px',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#9aa3b4' }}>
          层级 (Hierarchy)
        </span>
        <Dropdown menu={{ items: newMenuItems }} trigger={['click']} placement="bottomRight">
          <Tooltip title="新建">
            <Button type="text" size="small" icon={<PlusOutlined />} />
          </Tooltip>
        </Dropdown>
      </div>

      {/* === 树 === */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
        {pages.length === 0 ? (
          <Empty description="点击 + 新建窗口或模板" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '24px 0' }} />
        ) : (
          <Tree
            treeData={treeData}
            selectedKeys={selectedKeys}
            expandedKeys={expandedKeys}
            onExpand={handleExpand}
            onSelect={handleSelect}
            showLine={{ showLeafIcon: false }}
            draggable
            onDrop={handleDrop}
            allowDrop={(opts: any) => {
              const dragK = String(opts.dragNode?.key ?? '')
              const dk = String(opts.dropNode?.key ?? '')
              // 禁止拖拽页面节点
              if (dragK.startsWith('__page:')) return false
              // 允许拖到页面节点（成为根级子节点）
              if (dk.startsWith('__page:')) return true
              return true
            }}
          />
        )}
      </div>

      {/* === 新建弹窗 === */}
      <Modal
        title={newPageKind === 'template' ? '新建模板' : '新建窗口'}
        open={newPageOpen}
        onCancel={() => setNewPageOpen(false)}
        onOk={() => {
          if (newPageName.trim()) {
            onNewPage(newPageName.trim(), newPageKind)
            setNewPageOpen(false)
          }
        }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder={newPageKind === 'template' ? '模板 ID，如 btn_confirm' : '窗口 ID，如 home.main'}
          value={newPageName}
          onChange={e => setNewPageName(e.target.value)}
          onPressEnter={() => {
            if (newPageName.trim()) {
              onNewPage(newPageName.trim(), newPageKind)
              setNewPageOpen(false)
            }
          }}
          autoFocus
        />
      </Modal>

      {/* === 右键上下文菜单 === */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 9999,
          }}
        >
          <Dropdown
            menu={{ items: ctxMenuItems }}
            open={true}
            onOpenChange={(open) => { if (!open) setCtxMenu(null) }}
            trigger={['contextMenu']}
          >
            <div style={{ width: 1, height: 1 }} />
          </Dropdown>
        </div>
      )}
    </div>
  )
}

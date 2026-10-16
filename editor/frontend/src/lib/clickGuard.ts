// 静态点击可达性检查（独立校验层，纯函数、无 IO、不改数据）：
// 背景（2026-10-16 阵容页事故）：节点绑定动作后 Runtime 仍会照常订阅点击事件，
// 但 basic.isStatic=true 时引擎不再对该控件产生点击——「渲染正常 + 动作绑定成功 + 真人点击无响应」三者并存。
// 判定式：节点自身 djui.action 非空 且 自身 basic.isStatic === true（isStatic 缺省按 false，只有显式 true 才警示）。
// 本层只做「警示」：不参与 normalize/patches 管线、不写回数据、不阻塞保存/发布（弹窗/文案形态由调用方决定）。

export interface StaticActionIssue {
  /** 节点 id（结构化收集，便于编辑器与 AI 精确定位） */
  nodeId: string
  /** 展示名：优先节点 name，缺省回退 starType */
  nodeName: string
  /** 页面内路径：从根节点到自身的名称链，如 root/卡列表/图片 */
  path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 展示名：name 优先，缺省回退 starType，再兜底「未命名节点」 */
function displayNodeName(node: Record<string, unknown>): string {
  if (typeof node.name === 'string' && node.name.trim() !== '') return node.name
  if (typeof node.starType === 'string' && node.starType !== '') return node.starType
  return '未命名节点'
}

/** 节点自身是否「绑定了动作且被设为静态」：action 为非空字符串 且 isStatic 显式为 true */
function isStaticActionNode(node: Record<string, unknown>): boolean {
  const djui = isRecord(node.djui) ? node.djui : null
  if (typeof djui?.action !== 'string' || djui.action.trim() === '') return false
  const basic = isRecord(node.basic) ? node.basic : null
  return basic?.isStatic === true
}

/**
 * 扫描节点树，收集「绑定动作但被设为静态」的节点（点击不可达）。
 * 入参宽松（unknown）：既接受编辑器内存 UiPage.root，也接受工作区磁盘 PageFileV6.root，
 * 保存侧与发布侧共用同一判定，避免规则漂移。
 * 遍历防御式处理（children 缺失/非数组按空处理，与渲染层 (children ?? []) 约定同义）。
 */
export function findStaticActionIssues(root: unknown): StaticActionIssue[] {
  const issues: StaticActionIssue[] = []
  const visit = (node: unknown, parentPath: string): void => {
    if (!isRecord(node)) return
    const name = displayNodeName(node)
    const path = parentPath === '' ? name : `${parentPath}/${name}`
    if (isStaticActionNode(node)) {
      issues.push({
        nodeId: typeof node.id === 'string' ? node.id : '',
        nodeName: name,
        path,
      })
    }
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) visit(child, path)
  }
  visit(root, '')
  return issues
}

/** 拼发布校验 warnings 文案（每页一条；节点名最多列 3 个防刷屏） */
export function formatStaticActionWarning(displayName: string, issues: StaticActionIssue[]): string {
  const names = issues.slice(0, 3).map(issue => `「${issue.nodeName}」`).join('、')
  const more = issues.length > 3 ? `等 ${issues.length} 个节点` : ''
  return `页面 ${displayName}：${issues.length} 个绑定动作的节点被设为静态，真人点击将无响应（${names}${more ? '，' + more : ''}）`
}

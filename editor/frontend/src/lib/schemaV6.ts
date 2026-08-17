import {
  DJUI_PROTOCOL_VERSION,
  DJUI_SCHEMA_VERSION,
  RESPONSIVE_OVERRIDE_PATHS,
  type CompatibilityIssue,
  type CompatibilityResult,
  type PageFileV6,
  type ProjectFileV6,
} from '@/types/protocolV6'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function versionKind(raw: Record<string, unknown>, issues: CompatibilityIssue[]): 'ok' | 'legacy' | 'future' | 'invalid' {
  if (raw.protocolVersion === DJUI_PROTOCOL_VERSION && raw.schemaVersion === DJUI_SCHEMA_VERSION) return 'ok'
  const version = typeof raw.protocolVersion === 'number' ? raw.protocolVersion : typeof raw.version === 'number' ? raw.version : null
  if (version !== null && version < DJUI_PROTOCOL_VERSION) {
    issues.push({ path: '$.protocolVersion', message: '旧协议文件必须显式迁移到 v6' })
    return 'legacy'
  }
  if (version !== null && version > DJUI_PROTOCOL_VERSION) {
    issues.push({ path: '$.protocolVersion', message: '文件协议高于当前编辑器支持的 v6' })
    return 'future'
  }
  issues.push({ path: '$.protocolVersion', message: '缺少 protocolVersion=6 或 schemaVersion=1' })
  return 'invalid'
}

function checkPositive(value: unknown, path: string, issues: CompatibilityIssue[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) issues.push({ path, message: '必须是大于 0 的有限数字' })
}

export function inspectProjectV6(raw: unknown): CompatibilityResult<ProjectFileV6> {
  const issues: CompatibilityIssue[] = []
  if (!isRecord(raw)) return { ok: false, kind: 'invalid', issues: [{ path: '$', message: '项目配置必须是 JSON 对象' }] }
  const kind = versionKind(raw, issues)
  if (kind !== 'ok') return { ok: false, kind, issues }
  if (raw.orientation !== 'portrait' && raw.orientation !== 'landscape') issues.push({ path: '$.orientation', message: '必须是 portrait 或 landscape' })
  if (!isRecord(raw.canvas)) issues.push({ path: '$.canvas', message: '缺少 Canvas 配置' })
  else {
    checkPositive(raw.canvas.referenceWidth, '$.canvas.referenceWidth', issues)
    checkPositive(raw.canvas.referenceHeight, '$.canvas.referenceHeight', issues)
    if (!['Contain', 'MatchWidth', 'MatchHeight'].includes(String(raw.canvas.mode))) issues.push({ path: '$.canvas.mode', message: '不支持的 Canvas 模式' })
  }
  if (!isRecord(raw.responsive)) issues.push({ path: '$.responsive', message: '缺少响应式配置' })
  else {
    checkPositive(raw.responsive.wideRatio, '$.responsive.wideRatio', issues)
    if (typeof raw.responsive.wideRatio === 'number' && raw.responsive.wideRatio <= 1) issues.push({ path: '$.responsive.wideRatio', message: '必须大于 1' })
  }
  return issues.length ? { ok: false, kind: 'invalid', issues } : { ok: true, value: raw as unknown as ProjectFileV6 }
}

export function inspectPageV6(raw: unknown): CompatibilityResult<PageFileV6> {
  const issues: CompatibilityIssue[] = []
  if (!isRecord(raw)) return { ok: false, kind: 'invalid', issues: [{ path: '$', message: '页面必须是 JSON 对象' }] }
  const kind = versionKind(raw, issues)
  if (kind !== 'ok') return { ok: false, kind, issues }
  if (typeof raw.pageId !== 'string' || !raw.pageId.trim()) issues.push({ path: '$.pageId', message: '页面 ID 不能为空' })
  if (raw.kind !== 'window' && raw.kind !== 'template') issues.push({ path: '$.kind', message: '必须是 window 或 template' })
  if (raw.kind === 'window' && !isRecord(raw.window)) issues.push({ path: '$.window', message: 'Window 页面缺少 window 配置' })
  if (raw.kind === 'template') {
    if (!isRecord(raw.localSize)) issues.push({ path: '$.localSize', message: 'Template 缺少 localSize' })
    else {
      checkPositive(raw.localSize.width, '$.localSize.width', issues)
      checkPositive(raw.localSize.height, '$.localSize.height', issues)
    }
  }
  const nodeIds = new Set<string>()
  if (!isRecord(raw.root) || !Array.isArray(raw.root.children)) issues.push({ path: '$.root', message: '缺少结构根或 root.children' })
  else validateNode(raw.root, '$.root', issues, nodeIds)
  validateOverrideMaps(raw.responsive, '$.responsive', issues, nodeIds)
  return issues.length ? { ok: false, kind: 'invalid', issues } : { ok: true, value: raw as unknown as PageFileV6 }
}

function validateNode(value: Record<string, unknown>, path: string, issues: CompatibilityIssue[], nodeIds: Set<string>): void {
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) issues.push({ path: path + '.id', message: '节点 ID 不能为空' })
  else if (nodeIds.has(id)) issues.push({ path: path + '.id', message: '节点 ID 必须在页面内唯一' })
  else nodeIds.add(id)
  const starTypes = ['Panel', 'Button', 'Label', 'Input', 'Progress', 'SpacingPanel', 'PanelScrollable', 'TemplateInstance']
  if (!starTypes.includes(String(value.starType))) issues.push({ path: path + '.starType', message: '不支持的控件类型' })
  if (isRecord(value.anchor)) {
    if (!['parent', 'screen', 'safe'].includes(String(value.anchor.target ?? 'parent'))) issues.push({ path: path + '.anchor.target', message: '必须是 parent、screen 或 safe' })
    const sides = ['None', 'TopLeft', 'Top', 'TopRight', 'Left', 'Center', 'Right', 'BottomLeft', 'Bottom', 'BottomRight']
    if (!sides.includes(String(value.anchor.side ?? 'TopLeft'))) issues.push({ path: path + '.anchor.side', message: '不支持的锚点位置' })
    if (value.anchor.target === 'safe') {
      const edges = value.anchor.safeEdges
      if (!Array.isArray(edges) || edges.length === 0) issues.push({ path: path + '.anchor.safeEdges', message: '安全区锚点至少选择一条边' })
      else {
        const legal = new Set(['left', 'top', 'right', 'bottom'])
        if (edges.some(edge => typeof edge !== 'string' || !legal.has(edge))) issues.push({ path: path + '.anchor.safeEdges', message: '包含非法安全边' })
        if (new Set(edges).size !== edges.length) issues.push({ path: path + '.anchor.safeEdges', message: '安全边不能重复' })
      }
    }
  }
  if (isRecord(value.appearance)) {
    const fit = value.appearance.imageFit
    if (fit !== undefined && !['stretch', 'contain', 'cover'].includes(String(fit))) issues.push({ path: path + '.appearance.imageFit', message: '图片铺放方式无效' })
    if (fit === 'contain' || fit === 'cover') {
      const size = value.appearance.sourceSize
      if (!isRecord(size)) issues.push({ path: path + '.appearance.sourceSize', message: 'contain/cover 必须记录素材原始尺寸' })
      else { checkPositive(size.width, path + '.appearance.sourceSize.width', issues); checkPositive(size.height, path + '.appearance.sourceSize.height', issues) }
    }
    for (const key of ['focalX', 'focalY']) {
      const n = value.appearance[key]
      if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) issues.push({ path: path + '.appearance.' + key, message: '必须是 0 到 1 的有限数字' })
    }
  }
  if (isRecord(value.interaction)) {
    const routed = value.interaction.routedEvents
    if (routed !== undefined && routed !== null && typeof routed !== 'string') issues.push({ path: path + '.interaction.routedEvents', message: '必须是字符串或 null' })
    for (const key of ['allowDrag', 'allowDrop']) if (value.interaction[key] !== undefined && typeof value.interaction[key] !== 'boolean') issues.push({ path: path + '.interaction.' + key, message: '必须是布尔值' })
    const behaviors = value.interaction.behaviors
    if (behaviors !== undefined) {
      if (!Array.isArray(behaviors)) issues.push({ path: path + '.interaction.behaviors', message: '必须是数组' })
      else behaviors.forEach((behavior, index) => {
        if (!isRecord(behavior) || behavior.type !== 'TouchBehavior') issues.push({ path: path + '.interaction.behaviors[' + index + ']', message: '只支持 TouchBehavior' })
        else if (behavior.scaleFactor !== undefined && (typeof behavior.scaleFactor !== 'number' || !Number.isFinite(behavior.scaleFactor) || behavior.scaleFactor <= 0)) issues.push({ path: path + '.interaction.behaviors[' + index + '].scaleFactor', message: '必须大于 0' })
      })
    }
  }
  if (isRecord(value.effects) && value.effects.preset !== undefined && value.effects.preset !== null && typeof value.effects.preset !== 'string') issues.push({ path: path + '.effects.preset', message: '必须是字符串或 null' })
  if (!Array.isArray(value.children)) issues.push({ path: path + '.children', message: 'children 必须是数组' })
  else value.children.forEach((child, index) => {
    if (!isRecord(child)) issues.push({ path: path + '.children[' + index + ']', message: '节点必须是对象' })
    else validateNode(child, path + '.children[' + index + ']', issues, nodeIds)
  })
}

function validateOverrideMaps(value: unknown, path: string, issues: CompatibilityIssue[], nodeIds: Set<string>): void {
  if (value === undefined) return
  if (!isRecord(value) || !isRecord(value.wide) || !isRecord(value.wide.overrides)) {
    issues.push({ path, message: '响应式覆盖必须使用 wide.overrides 结构' })
    return
  }
  const legal = new Set<string>(RESPONSIVE_OVERRIDE_PATHS)
  for (const [nodeId, map] of Object.entries(value.wide.overrides)) {
    if (!nodeIds.has(nodeId)) issues.push({ path: path + '.wide.overrides.' + nodeId, message: '覆盖引用了不存在的节点 ID' })
    if (!isRecord(map)) {
      issues.push({ path: path + '.wide.overrides.' + nodeId, message: '节点覆盖必须是对象' })
      continue
    }
    for (const field of Object.keys(map)) {
      if (!legal.has(field)) issues.push({ path: path + '.wide.overrides.' + nodeId + '.' + field, message: '字段不允许被响应式覆盖' })
    }
  }
}

export function buildMigrationPrompt(issues: CompatibilityIssue[], files: string[]): string {
  const issueLines = issues.map(issue => '- ' + issue.path + ': ' + issue.message).join('\n')
  const fileLines = files.map(file => '- ' + file).join('\n')
  return '请把以下 DJUI 旧协议文件迁移为 protocolVersion=6、schemaVersion=1。不要静默猜测布局；保留节点树、业务绑定和动作，并用普通 anchor/stretch/safe/imageFit 表达适配。\n\n文件：\n' + fileLines + '\n\n发现的问题：\n' + issueLines
}

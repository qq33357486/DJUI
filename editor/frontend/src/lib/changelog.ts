// 更新公告模块：解析 CHANGELOG.md 为结构化数据
// CHANGELOG.md 是唯一权威源，vite build 时通过 ?raw 内联

import changelogRaw from '../../../../CHANGELOG.md?raw'
import pkg from '../../package.json'

export const APP_VERSION: string = pkg.version

export interface ChangelogSection {
  category: string   // "新增" | "修复" | "优化" | "破坏性变更"
  items: string[]
}

export interface ChangelogEntry {
  version: string          // "0.4.0"
  date: string | null      // "2026-07-03"
  sections: ChangelogSection[]
}

// 分类关键词映射（支持中英文标题）
const CATEGORY_MAP: Record<string, string> = {
  '新增': '新增', 'new': '新增', 'added': '新增', 'feature': '新增', 'features': '新增',
  '修复': '修复', 'fixed': '修复', 'bugfix': '修复', 'fix': '修复', 'bug': '修复',
  '优化': '优化', 'changed': '优化', 'improved': '优化', 'enhancement': '优化', 'change': '优化', 'changes': '优化',
  '破坏性变更': '破坏性变更', 'breaking': '破坏性变更', 'deprecated': '破坏性变更',
  '移除': '移除', 'removed': '移除',
}

function detectCategory(heading: string): string | null {
  const lower = heading.toLowerCase().trim()
  for (const [key, value] of Object.entries(CATEGORY_MAP)) {
    if (lower === key || lower.includes(key)) return value
  }
  return null
}

export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  const lines = raw.split('\n')

  let currentEntry: ChangelogEntry | null = null
  let currentSection: ChangelogSection | null = null

  for (const line of lines) {
    // ## [版本号] - 日期 或 ## 版本号
    const versionMatch = line.match(/^##\s+\[?([^\]]+)\]?\s*(?:-\s*(.+))?$/)
    if (versionMatch) {
      if (currentEntry) entries.push(currentEntry)
      currentEntry = {
        version: versionMatch[1].trim(),
        date: versionMatch[2]?.trim() || null,
        sections: [],
      }
      currentSection = null
      continue
    }

    if (!currentEntry) continue

    // ### 分类标题
    if (line.startsWith('### ')) {
      const heading = line.slice(4).trim()
      const category = detectCategory(heading)
      if (category) {
        currentSection = { category, items: [] }
        currentEntry.sections.push(currentSection)
      } else {
        currentSection = { category: heading, items: [] }
        currentEntry.sections.push(currentSection)
      }
      continue
    }

    // 列表项
    if (currentSection && line.match(/^\s*[-*]\s+/)) {
      const item = line.replace(/^\s*[-*]\s+/, '').trim()
      if (item) currentSection.items.push(item)
      continue
    }
  }

  if (currentEntry) entries.push(currentEntry)
  return entries
}

export const CHANGELOG: ChangelogEntry[] = parseChangelog(changelogRaw)

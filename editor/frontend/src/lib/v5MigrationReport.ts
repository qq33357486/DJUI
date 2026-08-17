import type { CompatibilityIssue } from '@/types/protocolV6'
import { buildMigrationPrompt, inspectPageV6, inspectProjectV6 } from '@/lib/schemaV6'

export interface MigrationFileReportV6 {
  file: string
  sourceVersion: number | null
  status: 'v6' | 'legacy' | 'future' | 'invalid' | 'missing'
  issues: CompatibilityIssue[]
}

export interface MigrationReportV6 {
  targetProtocolVersion: 6
  canOpen: boolean
  canAutoMigrate: false
  files: MigrationFileReportV6[]
  prompt: string
}

function sourceVersion(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  if (typeof data.protocolVersion === 'number') return data.protocolVersion
  if (typeof data.version === 'number') return data.version
  return null
}

export function inspectMigrationFileV6(file: string, raw: unknown, kind: 'project' | 'page'): MigrationFileReportV6 {
  if (raw === null || raw === undefined) {
    return { file, sourceVersion: null, status: 'missing', issues: [{ path: '$', message: '文件不存在' }] }
  }
  const result = kind === 'project' ? inspectProjectV6(raw) : inspectPageV6(raw)
  if (result.ok) return { file, sourceVersion: 6, status: 'v6', issues: [] }
  return { file, sourceVersion: sourceVersion(raw), status: result.kind, issues: result.issues }
}

export function buildMigrationReportV6(files: MigrationFileReportV6[]): MigrationReportV6 {
  const blocking = files.filter(file => file.status !== 'v6')
  const issues = blocking.flatMap(file => file.issues.map(issue => ({ path: file.file + issue.path, message: issue.message })))
  return {
    targetProtocolVersion: 6,
    canOpen: blocking.length === 0,
    canAutoMigrate: false,
    files,
    prompt: buildMigrationPrompt(issues, blocking.map(file => file.file)),
  }
}

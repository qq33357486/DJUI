#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(process.argv[2] ?? process.cwd())
const pagesDir = path.join(root, 'ui', 'djui', 'pages')
const tolerance = Number(process.argv[3] ?? 0.5)

function flatten(node, parentId = '', result = new Map()) {
  if (!node || typeof node !== 'object') return result
  const t = node.transform ?? {}
  result.set(node.id, {
    parentId,
    x: Number(t.x ?? 0), y: Number(t.y ?? 0),
    width: Number(t.width ?? 100), height: Number(t.height ?? 100),
    side: node.anchor?.side ?? 'None',
  })
  for (const child of node.children ?? []) flatten(child, node.id, result)
  return result
}

function readHead(fileName) {
  return JSON.parse(execFileSync('git', ['show', `HEAD:ui/djui/pages/${fileName}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
}

const files = fs.readdirSync(pagesDir).filter((name) => name.endsWith('.json')).sort()
let totalMismatch = 0
for (const fileName of files) {
  let baseline
  try { baseline = readHead(fileName) } catch { continue }
  const current = JSON.parse(fs.readFileSync(path.join(pagesDir, fileName), 'utf8'))
  const before = flatten(baseline.root)
  const after = flatten(current.root)
  const mismatches = []
  for (const [id, a] of before) {
    const b = after.get(id)
    if (!b) { mismatches.push(`${id}: missing`); continue }
    const delta = Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y), Math.abs(a.width-b.width), Math.abs(a.height-b.height))
    if (a.parentId !== b.parentId || a.side !== b.side || delta > tolerance) mismatches.push(`${id}: parent ${a.parentId}->${b.parentId}, side ${a.side}->${b.side}, maxDelta=${delta}`)
  }
  for (const id of after.keys()) if (!before.has(id)) mismatches.push(`${id}: added`)
  totalMismatch += mismatches.length
  console.log(`${fileName}: baseline=${before.size} current=${after.size} mismatch=${mismatches.length}`)
  for (const line of mismatches.slice(0, 20)) console.log(`  ${line}`)
}
if (totalMismatch) { console.error(`Geometry invariant failed: ${totalMismatch} mismatch(es), tolerance=${tolerance}px`); process.exit(1) }
console.log(`Geometry invariant passed, tolerance=${tolerance}px`)

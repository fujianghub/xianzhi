/**
 * 漂移检查（05 §6）：Drizzle 业务表 ↔ 01-domain-model.md §3 的「列 | 类型 | 说明」机器契约。
 * 多表、少表、多列、少列、类型不符、可空不符都报；认证域（Better Auth 表）不入契约。
 * 用法：tsx scripts/check-schema-drift.ts   （退出码非 0 = 有漂移）
 */
import { readFileSync } from 'node:fs'
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as business from '../src/server/db/schema/business.ts'

type Col = { type: string; nullable: boolean }
type Table = Map<string, Col>

// ---------- 解析 01 §3 ----------
function parseDoc(md: string): Map<string, Table> {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => /^## 3\. /.test(l))
  const end = lines.findIndex((l, i) => i > start && /^## 4\. /.test(l))
  const tables = new Map<string, Table>()
  let pendingName: string | null = null
  let current: Table | null = null
  for (let i = start; i < end; i++) {
    const line = lines[i] ?? ''
    const h = /^### 3\.\d+ ([a-z_]+)/.exec(line)
    const b = /^\*\*([a-z_]+)\*\*\s*$/.exec(line)
    if (h) pendingName = h[1] ?? null
    else if (b) pendingName = b[1] ?? null
    if (/^\| 列 \| 类型 \| 说明 \|/.test(line)) {
      if (!pendingName) throw new Error(`01 §3 第 ${i + 1} 行：表格前缺少表名`)
      current = new Map()
      tables.set(pendingName, current)
      pendingName = null
      i++ // 跳过分隔行
      continue
    }
    if (current && line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim())
      const name = cells[1] ?? ''
      const rawType = (cells[2] ?? '').replace(/`/g, '')
      if (!name) continue
      const nullable = rawType.endsWith('?')
      current.set(name, { type: normalize(rawType.replace(/\?$/, '')), nullable })
    } else if (current && !line.startsWith('|')) {
      current = null
    }
  }
  return tables
}

/** 文档类型与 Drizzle SQL 类型统一写法。 */
function normalize(t: string): string {
  const s = t.trim().toLowerCase()
  const map: Record<string, string> = {
    timestamptz: 'timestamptz',
    'timestamp with time zone': 'timestamptz',
    // 业务表时间列统一毫秒精度（01 §1 注、迁移 0004），精度不在 01 逐列表里重复
    'timestamp (3) with time zone': 'timestamptz',
    bool: 'bool',
    boolean: 'bool',
    int: 'int',
    integer: 'int',
    int4: 'int',
    smallint: 'smallint',
    int2: 'smallint',
    'text[]': 'text[]',
    // 数组列（ADR-0009 calendar_events.exdates / alarms）
    'timestamptz[]': 'timestamptz[]',
    'timestamp (3) with time zone[]': 'timestamptz[]',
    'int[]': 'int[]',
    'integer[]': 'int[]',
  }
  return map[s] ?? s
}

// ---------- 读取 Drizzle ----------
function readDrizzle(): Map<string, Table> {
  const out = new Map<string, Table>()
  for (const value of Object.values(business)) {
    if (!is(value, PgTable)) continue
    const cols: Table = new Map()
    for (const col of Object.values(getTableColumns(value))) {
      cols.set(toSnake(col.name), { type: normalize(col.getSQLType()), nullable: !col.notNull })
    }
    out.set(getTableName(value), cols)
  }
  return out
}

const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)

// ---------- 对照 ----------
const md = readFileSync(new URL('../spec_dev_doc/01-domain-model.md', import.meta.url), 'utf8')
const doc = parseDoc(md)
const code = readDrizzle()
const problems: string[] = []

for (const name of doc.keys()) if (!code.has(name)) problems.push(`少表：${name}（01 有，代码无）`)
for (const name of code.keys()) if (!doc.has(name)) problems.push(`多表：${name}（代码有，01 无）`)
for (const [name, dcols] of doc) {
  const ccols = code.get(name)
  if (!ccols) continue
  for (const [c, d] of dcols) {
    const cc = ccols.get(c)
    if (!cc) {
      problems.push(`${name}.${c}：少列（01 有，代码无）`)
      continue
    }
    if (cc.type !== d.type) problems.push(`${name}.${c}：类型 01=${d.type} 代码=${cc.type}`)
    if (cc.nullable !== d.nullable)
      problems.push(
        `${name}.${c}：可空 01=${d.nullable ? '?' : 'not null'} 代码=${cc.nullable ? '?' : 'not null'}`,
      )
  }
  for (const c of ccols.keys())
    if (!dcols.has(c)) problems.push(`${name}.${c}：多列（代码有，01 无）`)
}

if (problems.length) {
  console.error(
    `schema drift：${problems.length} 处\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.info(
  `schema drift：零差异（${doc.size} 张表，${[...doc.values()].reduce((n, t) => n + t.size, 0)} 列）`,
)

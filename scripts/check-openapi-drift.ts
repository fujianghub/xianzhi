/**
 * 路由漂移检查（05 §6）：代码实际注册的 method + path ↔ 02 §9 路由表（机器契约）。
 * - 多路由（代码有、02 无）：一律失败
 * - 少路由（02 有、代码无）：只对「行内任一 REQ 的 Phase ≤ 当前 Phase」的端点失败；Phase 更晚的端点只提示
 * 路由清单取自 Hono `app.routes`（与 hono-openapi 生成的 method+path 等价，且不依赖给每个路由加 describeRoute；见 CHANGELOG）。
 * 用法：tsx scripts/check-openapi-drift.ts [--phase 0]
 */
import { readFileSync } from 'node:fs'

process.env.XZ_SKIP_DOTENV = '1'
process.env.DATABASE_URL ??= 'postgres://xz:xz@localhost:5433/xz'
process.env.APP_URL ??= 'http://localhost:3010'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3010'
process.env.BETTER_AUTH_SECRET ??= 'drift-check-only-secret-0123456789abcdefgh'
process.env.COLLAB_TOKEN_SECRET ??= 'drift-check-only-secret-0123456789abcdefgh'

const phaseArg = process.argv.indexOf('--phase')
const PHASE = phaseArg >= 0 ? Number(process.argv[phaseArg + 1]) : Number(process.env.XZ_PHASE ?? 0)

const spec = (f: string) => readFileSync(new URL(`../spec_dev_doc/${f}`, import.meta.url), 'utf8')

// 00：REQ → Phase
const reqPhase = new Map<string, number>()
for (const m of spec('00-requirements.md').matchAll(/^\| (REQ-[A-Z]+-\d{3}) \| P\d \| (\d) \|/gm))
  reqPhase.set(m[1] as string, Number(m[2]))

// 02 §9：行 → { method, path, reqs }
const md = spec('02-api-conventions.md').split('\n')
const s9 = md.findIndex((l) => /^## 9\. /.test(l))
const e9 = md.findIndex((l, i) => i > s9 && /^## 10\. /.test(l))
interface Row {
  method: string
  path: string
  required: boolean
}
const rows: Row[] = []
for (const line of md.slice(s9, e9)) {
  const m = /^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \|(.*)\|(.*)\|\s*$/.exec(line)
  if (!m) continue
  let path = (m[2] as string).replace(/\?.*$/, '')
  const cells = `${m[3]} ${m[4]}`
  // 缩写的 REQ 引用（REQ-WS-004 · 012 · 013）展开成完整 id
  const reqs: string[] = []
  for (const g of cells.matchAll(/(REQ-[A-Z]+)-(\d{3})((?:\s*[·~]\s*\d{3})*)/g)) {
    reqs.push(`${g[1]}-${g[2]}`)
    for (const n of (g[3] ?? '').matchAll(/\d{3}/g)) reqs.push(`${g[1]}-${n[0]}`)
  }
  const phases = reqs.map((r) => reqPhase.get(r)).filter((p): p is number => p !== undefined)
  const excluded = /二期|不验收/.test(cells)
  path = path === '/health' || path === '/health/details' ? `/api${path}` : `/api/v1${path}`
  rows.push({
    method: m[1] as string,
    path,
    required: !excluded && phases.length > 0 && Math.min(...phases) <= PHASE,
  })
}

// 代码路由（生产模式下不含 _debug）
const { createApp } = await import('../src/server/app.ts')
const { getAuth } = await import('../src/server/auth.ts')
const { getDb, closeDb } = await import('../src/server/db/index.ts')
const pino = (await import('pino')).default
const { SseHub } = await import('../src/server/lib/sse-hub.ts')
const app = createApp({
  auth: getAuth(),
  db: getDb(),
  logger: pino({ level: 'silent' }),
  appUrl: 'http://localhost:3010',
  collabSecret: 'x',
  dataDir: './data',
  nodeEnv: 'production',
  sseHub: new SseHub(),
})
const code = new Set<string>()
for (const r of app.routes) {
  if (r.method === 'ALL' || !/^\/api\/(v1\/|health)/.test(r.path)) continue
  const p = r.path.replace(/\/$/, '') || '/'
  code.add(`${r.method} ${p}`)
}
await closeDb()

const docKeys = new Set(rows.map((r) => `${r.method} ${r.path}`))
const extra = [...code].filter((k) => !docKeys.has(k))
const missing = rows
  .filter((r) => r.required && !code.has(`${r.method} ${r.path}`))
  .map((r) => `${r.method} ${r.path}`)
const later = rows.filter((r) => !r.required && !code.has(`${r.method} ${r.path}`)).length

if (extra.length || missing.length) {
  if (extra.length)
    console.error(`多路由（代码有、02 §9 无）：\n${extra.map((k) => `  - ${k}`).join('\n')}`)
  if (missing.length)
    console.error(`少路由（Phase ≤ ${PHASE} 应有）：\n${missing.map((k) => `  - ${k}`).join('\n')}`)
  process.exit(1)
}
console.info(
  `check-openapi-drift：零差异（代码 ${code.size} 条；02 §9 ${rows.length} 条，其中 Phase > ${PHASE} 未实现 ${later} 条）`,
)

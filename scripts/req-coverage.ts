/**
 * REQ 覆盖门槛（05 §5）：合并本次已产出的 debug/perf/req-coverage.*.json，对照 00-requirements.md。
 * - 只按本次实际运行的层计算：`--layers unit,api,collab` 或 `--layers e2e`（缺省 = 已存在的产物文件）
 * - Phase ≤ 当前 Phase 的 P0 REQ：其测试层与本次运行层有交集时，必须至少一个通过的用例，否则失败
 * - 测试层为「手工」的不进门槛；P1 只警告
 * 00 的测试层写法 → 本脚本层名：unit → unit · api → api · collab → collab · e2e / visual / a11y → e2e · e2e（infra）→ infra
 */
import { existsSync, readFileSync } from 'node:fs'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const PHASE = Number(arg('phase') ?? process.env.XZ_PHASE ?? 0)
const DIR = arg('dir') ?? process.env.XZ_COVERAGE_DIR ?? 'debug/perf'
const ALL = ['unit', 'api', 'collab', 'e2e', 'infra'] as const
type Layer = (typeof ALL)[number]
const layers =
  (arg('layers')?.split(',') as Layer[] | undefined) ??
  ALL.filter((l) => existsSync(`${DIR}/req-coverage.${l}.json`))
if (!layers.length) {
  console.error('req-coverage：没有任何 req-coverage.*.json 产物')
  process.exit(1)
}

const results = new Map<string, { passed: number; failed: number; layers: Set<Layer> }>()
for (const l of layers) {
  const f = `${DIR}/req-coverage.${l}.json`
  if (!existsSync(f)) {
    console.error(`req-coverage：缺少本次运行层的产物 ${f}`)
    process.exit(1)
  }
  for (const r of JSON.parse(readFileSync(f, 'utf8')) as { id: string; passed: boolean }[]) {
    const e = results.get(r.id) ?? { passed: 0, failed: 0, layers: new Set<Layer>() }
    if (r.passed) e.passed++
    else e.failed++
    e.layers.add(l)
    results.set(r.id, e)
  }
}

const md = readFileSync(new URL('../spec_dev_doc/00-requirements.md', import.meta.url), 'utf8')
const toLayer = (s: string): Layer[] => {
  const out = new Set<Layer>()
  for (const t of s.split(/[·,，]/).map((x) => x.trim().toLowerCase())) {
    if (t.startsWith('unit')) out.add('unit')
    else if (t.startsWith('api')) out.add('api')
    else if (t.startsWith('collab')) out.add('collab')
    else if (/infra/.test(t)) out.add('infra')
    else if (/^(e2e|visual|a11y)/.test(t)) out.add('e2e')
  }
  return [...out]
}
const missing: string[] = []
const warn: string[] = []
let checked = 0
for (const m of md.matchAll(/^\| (REQ-[A-Z]+-\d{3}) \| (P\d) \| (\d) \|.*\| ([^|]+) \|\s*$/gm)) {
  const [, id, prio, phase, layerCell] = m as unknown as [string, string, string, string, string]
  if (Number(phase) > PHASE || /手工/.test(layerCell)) continue
  const want = toLayer(layerCell).filter((l) => layers.includes(l))
  if (!want.length) continue
  checked++
  const r = results.get(id)
  // unit 需求可由同一 test 阶段的 api / collab 用例满足（更重的集成测试覆盖了同一断言；05 §5 注）
  const accept = new Set<Layer>(
    want.flatMap((l) => (l === 'unit' ? ['unit', 'api', 'collab'] : [l])) as Layer[],
  )
  const ok = !!r && r.passed > 0 && [...r.layers].some((l) => accept.has(l))
  if (!ok) (prio === 'P0' ? missing : warn).push(`${id}（${prio}，需要层 ${want.join('/')}）`)
}
if (warn.length)
  console.warn(`req-coverage 警告（P1/P2 无通过用例）：\n${warn.map((w) => `  - ${w}`).join('\n')}`)
if (missing.length) {
  console.error(
    `req-coverage：${missing.length} 个 P0 需求在本次运行层（${layers.join(',')}）没有通过的用例：\n${missing.map((w) => `  - ${w}`).join('\n')}`,
  )
  process.exit(1)
}
console.info(
  `req-coverage：Phase ≤ ${PHASE} · 层 ${layers.join(',')} · 校验 ${checked} 条 REQ，P0 全部有通过用例`,
)

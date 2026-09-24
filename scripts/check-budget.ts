/**
 * 性能预算（ADR §3、03 §9、05 §5、REQ-UI-015 · REQ-EDITOR-014）：gzip 后
 * - 首屏：index.html 直接引用的 JS（入口 + modulepreload）合计 ≤ 250 KB
 * - 编辑器 chunk（editor-*.js）≤ 400 KB
 * 结果写 debug/perf/budget.json。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = new URL('../dist/client', import.meta.url).pathname
const KB = 1024
const LIMITS = { initial: 250 * KB, editor: 400 * KB }
const gz = (f: string) => gzipSync(readFileSync(join(DIST, f))).length

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map(
  (m) => m[1] as string,
)
const initialBytes = initial.reduce((n, f) => n + gz(f), 0)
const editorFiles = readdirSync(join(DIST, 'assets')).filter((f) => /^editor-.*\.js$/.test(f))
const editorBytes = editorFiles.reduce((n, f) => n + gz(join('assets', f)), 0)

const report = {
  initial: {
    files: initial,
    gzipKB: +(initialBytes / KB).toFixed(1),
    limitKB: LIMITS.initial / KB,
  },
  editor: {
    files: editorFiles,
    gzipKB: +(editorBytes / KB).toFixed(1),
    limitKB: LIMITS.editor / KB,
  },
}
mkdirSync(new URL('../debug/perf', import.meta.url).pathname, { recursive: true })
writeFileSync(
  new URL('../debug/perf/budget.json', import.meta.url).pathname,
  `${JSON.stringify(report, null, 2)}\n`,
)

const problems: string[] = []
if (!initial.length) problems.push('index.html 未引用任何入口 JS')
if (initialBytes > LIMITS.initial)
  problems.push(`首屏 JS ${report.initial.gzipKB} KB > ${report.initial.limitKB} KB`)
if (!editorFiles.length) problems.push('未找到 editor-*.js（编辑器未独立分包）')
if (editorBytes > LIMITS.editor)
  problems.push(`编辑器 chunk ${report.editor.gzipKB} KB > ${report.editor.limitKB} KB`)
if (problems.length) {
  console.error(`check-budget：\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.info(
  `check-budget：首屏 ${report.initial.gzipKB} KB / ${report.initial.limitKB} KB · 编辑器 ${report.editor.gzipKB} KB / ${report.editor.limitKB} KB`,
)

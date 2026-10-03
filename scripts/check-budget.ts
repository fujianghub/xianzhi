/**
 * 性能预算（ADR §3、03 §9、05 §5、REQ-UI-015 · REQ-EDITOR-014）：gzip 后
 * - 首屏：入口与登录路由（`/login`，未登录访问任何页面都落在这里）的静态 import 闭包合计 ≤ 250 KB——
 *   按 Vite manifest 走链，与 e2e perf（REQ-UI-015，真实浏览器打开 /login 计下载的 JS）同口径；
 *   2026-10-03 前只算 index.html 直接引用的文件，漏了登录路由懒加载的 ~77 KB（debug/2026-10-03-perf-initial-js-login）
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

type ManifestChunk = { file: string; imports?: string[] }
const manifest = JSON.parse(readFileSync(join(DIST, '.vite/manifest.json'), 'utf8')) as Record<
  string,
  ManifestChunk
>
/** 从若干 manifest 键出发，沿静态 imports 收集要加载的 JS 文件（去重） */
function closure(keys: string[]): string[] {
  const seen = new Set<string>()
  const files = new Set<string>()
  const walk = (k: string) => {
    if (seen.has(k)) return
    seen.add(k)
    const c = manifest[k]
    if (!c) throw new Error(`manifest 缺少 ${k}`)
    if (c.file.endsWith('.js')) files.add(c.file)
    for (const i of c.imports ?? []) walk(i)
  }
  for (const k of keys) walk(k)
  return [...files]
}
const LOGIN = Object.keys(manifest).find((k) => /^routes\/login\.tsx\?tsr-split=component$/.test(k))
if (!LOGIN)
  throw new Error('manifest 里找不到登录路由组件 chunk（routes/login.tsx?tsr-split=component）')
const initial = closure(['index.html', LOGIN])
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
if (!initial.length) problems.push('首屏没有任何 JS（manifest 解析失败？）')
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

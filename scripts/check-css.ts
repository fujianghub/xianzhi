/**
 * 组件文件裸色值 / 嵌套 glass / !important 检查（04 §2、06 §8 §9、CLAUDE.md 不变量 5、REQ-UI-002）。
 * 扫描 src/client 下 .tsx/.ts/.css（tokens.css 除外）；注释跳过；行内 `xz-allow-color` 显式豁免。
 * 另：主色辉光 `glow-primary` 引用点 ≤ 6（ADR-0005 §4、REQ-UI-020：主按钮 hover、燕印、侧栏当前项、登录聚焦、成巢、里程碑）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../src/client', import.meta.url).pathname
const RULES: { name: string; re: RegExp }[] = [
  { name: '裸色值 hex', re: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![\w-])/ },
  { name: '裸色值 rgb/hsl/oklch', re: /\b(?:rgba?|hsla?|oklch|oklab)\(/ },
  { name: '!important', re: /!important/ },
]

/** 嵌套 glass：CSS 中某个（逗号分隔后的）选择器以后代 / 子代组合出现两个 glass* 类；:is()/:where() 内的列表不算嵌套。 */
export function nestedGlass(line: string): boolean {
  const sel = line.split('{')[0] ?? ''
  if (!sel.includes('.glass')) return false
  const flat = sel.replace(/:(?:is|where)\([^)]*\)/g, (m) =>
    m.includes('.glass') ? '.glass-any' : '',
  )
  return flat.split(',').some((one) => /\.glass[\w-]*[^,]*?[\s>~+]+[^,]*?\.glass/.test(one))
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(e) && !/tokens\.css$/.test(e) && !/routeTree\.gen\.ts$/.test(e))
      out.push(p)
  }
  return out
}

export const GLOW_PRIMARY_MAX = 6
const files = walk(ROOT)
const problems: string[] = []
const glowSites: string[] = []
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  src.split('\n').forEach((raw, i) => {
    const line = raw.replace(/(^|[^:])\/\/.*$/, '$1')
    if (/xz-allow-color/.test(raw)) return
    const at = `${f.replace(ROOT, 'src/client')}:${i + 1}`
    for (const r of RULES)
      if (r.re.test(line)) problems.push(`${at} ${r.name}: ${raw.trim().slice(0, 80)}`)
    if (/glow-primary/.test(line)) glowSites.push(at)
    if (f.endsWith('.css') && nestedGlass(line))
      problems.push(`${at} 嵌套 glass: ${raw.trim().slice(0, 80)}`)
  })
}
if (glowSites.length > GLOW_PRIMARY_MAX)
  problems.push(
    `glow-primary 引用 ${glowSites.length} 处 > ${GLOW_PRIMARY_MAX}（REQ-UI-020）：${glowSites.join('、')}`,
  )
if (problems.length) {
  console.error(
    `check-css：${problems.length} 处违规\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.info(
  `check-css：零违规（${files.length} 个文件；glow-primary 引用 ${glowSites.length} / ${GLOW_PRIMARY_MAX}）`,
)

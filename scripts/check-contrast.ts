/**
 * REQ-UI-003 对比度矩阵（06 §7、04 §2.1）：解析 src/client/styles/tokens.css 两主题，在「最坏合成底」上计算 WCAG 对比度。
 * - 日场最坏底：glass-thin 叠在 glow-2 峰值上（再叠 bg）；夜场：glass-thick 叠 glow-3 峰值
 * - 另算纸面 surface-solid
 * 门槛：燕印 seal-bird / seal-to ≥ 3、/ seal-from ≥ 2、seal-leaf / seal-to ≥ 3（ADR-0007）；fg ≥ 7、fg-muted ≥ 4.5、fg-faint ≥ 3；primary-fg on primary / primary-bright ≥ 4.5；语义色图标 on 纸面 ≥ 3；
 * 危险文字 on danger-soft ≥ 4.5；9 色板 fg on bg ≥ 4.5（AA，ADR-0010）。
 * ADR-0005：primary 只作填充，主色当文字 / 图标由 primary-text 承担（两底 ≥ 4.5）；danger-fg on danger ≥ 4.5；
 * 代码高亮 token on code-bg ≥ 4.5。
 */
import { readFileSync } from 'node:fs'
import { PALETTE_COLORS } from '../src/shared/schemas/enums.ts'

type RGBA = [number, number, number, number]
const FILE = new URL('../src/client/styles/tokens.css', import.meta.url)
const css = readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): Map<string, string> {
  // 引号风格随格式化器变化：同时接受单双引号
  const variants = [selector, selector.replace(/'/g, '"')]
  const i = variants.map((v) => css.indexOf(`${v} {`)).find((x) => x >= 0) ?? -1
  if (i < 0) throw new Error(`tokens.css 缺少 ${selector} 块`)
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('\n}', i))
  const m = new Map<string, string>()
  for (const d of body.matchAll(/(--xz-[\w-]+)\s*:\s*([^;]+);/g))
    m.set(d[1] as string, (d[2] as string).trim())
  return m
}

function parse(v: string): RGBA {
  const s = v.trim().toLowerCase()
  let m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) {
    const n = Number.parseInt(m[1] as string, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const p = (m[1] as string).split(',').map((x) => Number.parseFloat(x))
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
  }
  throw new Error(`无法解析颜色：${v}`)
}
const over = (top: RGBA, bottom: RGBA): RGBA => {
  const a = top[3]
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ]
}
const lum = ([r, g, b]: RGBA) => {
  const f = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: RGBA, b: RGBA) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

const light = block("[data-theme='light']")
const darkOverrides = block("[data-theme='dark']")
const dark = new Map([...light, ...darkOverrides])
const problems: string[] = []
const rows: string[] = []

for (const [name, t, worstGlass, worstGlow] of [
  ['日场', light, '--xz-glass-thin', '--xz-glow-2'],
  ['夜场', dark, '--xz-glass-thick', '--xz-glow-3'],
] as const) {
  const get = (k: string) => {
    const v = t.get(k)
    if (!v) throw new Error(`${name} 缺少 ${k}`)
    return parse(v)
  }
  const bg = get('--xz-bg')
  const worst = over(get(worstGlass), over(get(worstGlow), bg))
  const paperBg = get('--xz-surface-solid')
  const check = (label: string, fg: RGBA, back: RGBA, min: number) => {
    const r = ratio(over(fg, back), back)
    rows.push(`${name} ${label.padEnd(34)} ${r.toFixed(2).padStart(6)}  ≥ ${min}`)
    if (r < min) problems.push(`${name} ${label}: ${r.toFixed(2)} < ${min}`)
  }
  for (const [bgName, back] of [
    ['最坏玻璃底', worst],
    ['纸面', paperBg],
  ] as const) {
    check(`fg / ${bgName}`, get('--xz-fg'), back, 7)
    check(`fg-muted / ${bgName}`, get('--xz-fg-muted'), back, 4.5)
    check(`fg-faint / ${bgName}`, get('--xz-fg-faint'), back, 3)
    check(`primary-text / ${bgName}`, get('--xz-primary-text'), back, 4.5)
  }
  check('primary-fg / primary', get('--xz-primary-fg'), get('--xz-primary'), 4.5)
  check('primary-fg / primary-bright', get('--xz-primary-fg'), get('--xz-primary-bright'), 4.5)
  for (const s of ['primary-text', 'accent', 'success', 'warning', 'danger', 'info'])
    check(`${s} 图标 / 纸面`, get(`--xz-${s}`), paperBg, 3)
  // ADR-0007 燕印：暖白燕 / 嫩叶压在翡翠深渐变上（Logo 豁免 WCAG 1.4.11，此处防回归：深端 ≥ 3、浅端 ≥ 2）
  check('seal-bird / seal-to', get('--xz-seal-bird'), get('--xz-seal-to'), 3)
  check('seal-bird / seal-from', get('--xz-seal-bird'), get('--xz-seal-from'), 2)
  check('seal-leaf / seal-to', get('--xz-seal-leaf'), get('--xz-seal-to'), 3)
  check('danger / danger-soft', get('--xz-danger'), get('--xz-danger-soft'), 4.5)
  check('danger-fg / danger', get('--xz-danger-fg'), get('--xz-danger'), 4.5)
  // 逾期标题、错误说明等 danger 文字直接压在底板上（REQ-UI-013 axe）
  check('danger 文字 / 底板', get('--xz-danger'), bg, 4.5)
  // 侧栏导航图标色组（2026-09-24 侧栏改版）：图标 ≥ 3
  for (const c of ['amber', 'blue', 'cyan', 'violet', 'rose', 'emerald', 'lime', 'sky'])
    check(`icon-${c} / 最坏玻璃底`, get(`--xz-icon-${c}`), worst, 3)
  for (const c of [
    'fg',
    'comment',
    'keyword',
    'string',
    'number',
    'function',
    'type',
    'tag',
    'builtin',
  ])
    check(`code-${c} / code-bg`, get(`--xz-code-${c}`), get('--xz-code-bg'), 4.5)
  for (const c of PALETTE_COLORS)
    check(`palette ${c} fg / bg`, get(`--xz-palette-${c}-fg`), get(`--xz-palette-${c}-bg`), 4.5)
}

if (process.argv.includes('--verbose') || problems.length) console.info(rows.join('\n'))
if (problems.length) {
  console.error(
    `check-contrast：${problems.length} 项不达标\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.info(`check-contrast：${rows.length} 项全部达标（两主题）`)

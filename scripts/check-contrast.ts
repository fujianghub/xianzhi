/**
 * REQ-UI-003 对比度矩阵（06 §7、04 §2.1）：解析 src/client/styles/tokens.css 两主题，在「最坏合成底」上计算 WCAG 对比度。
 * - 日场最坏底：glass-thin 叠在 glow-2 峰值上（再叠 bg）；夜场：glass-thick 叠 glow-3 峰值
 * - 另算纸面 surface-solid
 * 门槛：fg ≥ 7、fg-muted ≥ 4.5、fg-faint ≥ 3；primary-fg on primary ≥ 4.5；语义色图标 on 纸面 ≥ 3；
 * 危险文字 on danger-soft ≥ 4.5；8 色板 fg on bg ≥ 4.5（AA）。
 */
import { readFileSync } from 'node:fs'

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
  }
  check('primary-fg / primary', get('--xz-primary-fg'), get('--xz-primary'), 4.5)
  for (const s of ['primary', 'accent', 'success', 'warning', 'danger', 'info'])
    check(`${s} 图标 / 纸面`, get(`--xz-${s}`), paperBg, 3)
  check('danger / danger-soft', get('--xz-danger'), get('--xz-danger-soft'), 4.5)
  for (const c of ['moss', 'amber', 'indigo', 'ochre', 'teal', 'plum', 'gray', 'pine'])
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

/**
 * REQ-UI-003 对比度矩阵（06 §7、04 §2.1）：解析 src/client/styles/tokens.css 两主题，在「最坏合成底」上计算 WCAG 对比度。
 * - 日场最坏底：glass-thin 叠在 glow-2 峰值上（再叠 bg）；夜场：glass-thick 叠 glow-3 峰值
 * - 另算纸面 surface-solid 与阅读纸张 paper-rice / paper-kraft（ADR-0024）
 * 门槛：燕印 seal-bird / seal-to ≥ 3、/ seal-from ≥ 2、seal-leaf / seal-to ≥ 3（ADR-0007）；fg ≥ 7、fg-muted ≥ 4.5、fg-faint ≥ 3；primary-fg on primary / primary-bright ≥ 4.5；语义色图标 on 纸面 ≥ 3；
 * 危险文字 on danger-soft ≥ 4.5；9 色板 fg on bg ≥ 4.5（AA，ADR-0010）。
 * ADR-0005：primary 只作填充，主色当文字 / 图标由 primary-text 承担（两底 ≥ 4.5）；danger-fg on danger ≥ 4.5；
 * 代码高亮 token on code-bg ≥ 4.5。
 */
import { readFileSync } from 'node:fs'
import {
  over,
  parseColor as parse,
  type RGBA,
  contrastRatio as ratio,
} from '../src/shared/contrast.ts'
import { PALETTE_COLORS } from '../src/shared/schemas/enums.ts'

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
    // ADR-0024 阅读纸张（整片底色的两种；纹理纸张以纸面为底）
    ['宣纸', get('--xz-paper-rice')],
    ['牛皮纸', get('--xz-paper-kraft')],
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
  // ADR-0025 文字色标记直接落在纸面 / 宣纸 / 牛皮纸上：9 色板 fg ≥ 4.5
  for (const c of PALETTE_COLORS)
    for (const [bgName, back] of [
      ['纸面', paperBg],
      ['宣纸', get('--xz-paper-rice')],
      ['牛皮纸', get('--xz-paper-kraft')],
    ] as const)
      check(`palette ${c} 文字 / ${bgName}`, get(`--xz-palette-${c}-fg`), back, 4.5)
}

/*
 * ADR-0047 玻璃强度预设（html[data-glass]）：玻璃更透、光晕更浓、纸面半透明后，在每团光晕峰值上重算
 * 玻璃（日场 glass-thin / 夜场 glass-thick）与纸面（paper-bg）的文字与图标对比度；流光的漂移层会把两团光叠在一起，按相邻两团叠加算。
 * 预设块按 CSS 优先级叠在主题之上：日场取含 `:root[data-glass="X"]` 的块；夜场先叠这些，再叠含 `:root[data-glass="X"][data-theme="dark"]` 的块（特异度更高，不论文件先后）。
 */
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sels: (m[1] as string).split(',').map((x) => x.trim().replace(/'/g, '"')),
  decls: new Map(
    [...(m[2] as string).matchAll(/(--xz-[\w-]+)\s*:\s*([^;]+);/g)].map(
      (d) => [d[1] as string, (d[2] as string).trim()] as const,
    ),
  ),
}))
const withPreset = (base: Map<string, string>, wanted: string[]) => {
  const out = new Map(base)
  for (const b of blocks)
    if (b.sels.some((x) => wanted.includes(x))) for (const [k, v] of b.decls) out.set(k, v)
  return out
}
let presetRows = 0
for (const level of ['clear', 'vivid', 'liquid'] as const) {
  const root = `:root[data-glass="${level}"]`
  for (const [name, t, glassKey] of [
    ['日场', withPreset(light, [root]), '--xz-glass-thin'],
    [
      '夜场',
      withPreset(withPreset(dark, [root]), [`${root}[data-theme="dark"]`]),
      '--xz-glass-thick',
    ],
  ] as const) {
    // 预设外的默认值在派生块里（纸面 = surface-solid）；var() 引用递归取值
    const get = (k: string): RGBA => {
      const fallback: Record<string, string> = {
        '--xz-paper-bg': 'var(--xz-surface-solid)',
        '--xz-sidebar-bg': 'var(--xz-glass-thick)',
        '--xz-topbar-bg': 'var(--xz-glass)',
        '--xz-wash-side-1': 'rgba(0, 0, 0, 0)',
        '--xz-wash-side-2': 'rgba(0, 0, 0, 0)',
        '--xz-wash-top': 'rgba(0, 0, 0, 0)',
      }
      const v = t.get(k) ?? fallback[k]
      if (!v) throw new Error(`${level} ${name} 缺少 ${k}`)
      const ref = /^var\((--xz-[\w-]+)\)$/.exec(v)
      return ref ? get(ref[1] as string) : parse(v === 'transparent' ? 'rgba(0, 0, 0, 0)' : v)
    }
    const bg = get('--xz-bg')
    const glows = ['--xz-glow-1', '--xz-glow-2', '--xz-glow-3', '--xz-glow-4']
      .filter((k) => t.get(k) && t.get(k) !== 'transparent')
      .map(get)
    const unders = glows.map((g, i) =>
      level === 'liquid' ? over(glows[(i + 1) % glows.length] as RGBA, over(g, bg)) : over(g, bg),
    )
    for (const [i, under] of unders.entries())
      for (const [bgName, back] of [
        ['玻璃', over(get(glassKey), under)],
        ['纸面', over(get('--xz-paper-bg'), under)],
        // ADR-0048：侧栏 / 顶栏背后另有定向光晕，叠在这团底板光晕上
        ['侧栏上', over(get('--xz-sidebar-bg'), over(get('--xz-wash-side-1'), under))],
        ['侧栏下', over(get('--xz-sidebar-bg'), over(get('--xz-wash-side-2'), under))],
        ['顶栏', over(get('--xz-topbar-bg'), over(get('--xz-wash-top'), under))],
      ] as const) {
        const tag = `[${level}] ${name} glow${i + 1} ${bgName}`
        for (const [k, min] of [
          ['fg', 7],
          ['fg-muted', 4.5],
          ['fg-faint', 3],
          ['primary-text', 4.5],
        ] as const) {
          const r = ratio(get(`--xz-${k}`), back)
          presetRows++
          if (r < min) problems.push(`${tag} ${k}: ${r.toFixed(2)} < ${min}`)
        }
      }
  }
}

if (process.argv.includes('--verbose') || problems.length) console.info(rows.join('\n'))
if (problems.length) {
  console.error(
    `check-contrast：${problems.length} 项不达标\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.info(
  `check-contrast：${rows.length} 项全部达标（两主题）；玻璃强度预设 ${presetRows} 项全部达标`,
)

/**
 * 皮肤（ADR-0059、REQ-UI-056 ~ 061）：从 codexthemes.ai 的 `.codex-theme` 包安装，只取 mode / palette / 背景图 / 焦点，
 * 包里的 CSS 一律丢弃（那是给 Codex 桌面端 DOM 写的）。palette 在这里换算成衔枝已有的 `--xz-*` token：
 * - 只覆盖 tokens.css 已定义的变量，不引入组件私有变量；皮肤锁定自带的日场 / 夜场，九色板、图标色、代码色等沿用该模式的原值
 * - 底板明度钳在本模式范围内（九色板 / 图标色按原模式校过对比度），文字 / 主色按 WCAG 步进修正到达标
 * - 输出的 CSS 只由数值格式化而来（颜色先解析成数字），id / 版本号过正则，杜绝注入
 * 纯函数：服务端（安装、`GET /skins/:id`）与单测共用。
 */
import { z } from 'zod'
import { contrastRatio, over, type RGBA } from './contrast.ts'

export const SKIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** 偏好里的「不用皮肤」（显式选它可盖过工作区默认皮肤） */
export const SKIN_NONE = 'none'
/** 保留 id：none = 不用主题；default = 公开的工作区默认主题接口（ADR-0060） */
const SKIN_RESERVED = new Set([SKIN_NONE, 'default'])
export const skinIdSchema = z
  .string()
  .regex(SKIN_ID_RE)
  .refine((v) => !SKIN_RESERVED.has(v), '保留字')
/** 偏好值：皮肤 id 或 none */
export const skinPrefSchema = z.string().regex(SKIN_ID_RE)

export const SKIN_MODES = ['light', 'dark'] as const
export type SkinMode = (typeof SKIN_MODES)[number]

/** 安装时从包里取用的 palette 键（都可缺省；缺的回落衔枝原值） */
export const SKIN_PALETTE_KEYS = [
  'canvas',
  'surface',
  'raised',
  'text',
  'muted',
  'accent',
  'border',
  'focus',
  'success',
  'warning',
  'danger',
] as const
export type SkinPaletteKey = (typeof SKIN_PALETTE_KEYS)[number]
export type SkinPalette = Partial<Record<SkinPaletteKey, string>>

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/
const FOCAL_RE = /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/
const VERSION_RE = /^[\w.+-]{1,32}$/

/** 落盘的 `skin.json`（安装器写、服务读；token 每次按 palette 现算，生成器改进后无需重装） */
export const skinRecordSchema = z.object({
  schema: z.literal(1),
  id: skinIdSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(400).default(''),
  author: z.string().max(80).default(''),
  mode: z.enum(SKIN_MODES),
  version: z.string().regex(VERSION_RE),
  palette: z.partialRecord(z.enum(SKIN_PALETTE_KEYS), z.string().regex(HEX_RE)),
  focal: z.string().regex(FOCAL_RE).default('50% 50%'),
  art: z.boolean(),
  source: z.object({
    kind: z.enum(['codexthemes', 'url', 'file']),
    ref: z.string().max(500),
    page: z.string().max(500).optional(),
  }),
  installedAt: z.string(),
})
export type SkinRecord = z.infer<typeof skinRecordSchema>

/** 列表视图（`GET /skins`）：不含 palette；rev = 样式表内容指纹（生成器改进后客户端缓存随之失效） */
export interface SkinSummary {
  id: string
  name: string
  description: string
  author: string
  mode: SkinMode
  version: string
  rev: string
  art: boolean
  page?: string
}

export const skinSummary = (s: SkinRecord): SkinSummary => ({
  id: s.id,
  name: s.name,
  description: s.description,
  author: s.author,
  mode: s.mode,
  version: s.version,
  rev: fnv1a(skinCss(s)),
  art: s.art,
  ...(s.source.page ? { page: s.source.page } : {}),
})

/** 32 位 FNV-1a（只作缓存指纹） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// ---------- 颜色 ----------

type RGB = [number, number, number]
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

export function parseHex(v: string): RGB | null {
  const s = v.trim().toLowerCase()
  if (!HEX_RE.test(s)) return null
  const h = s.length === 4 ? [...s.slice(1)].map((c) => c + c).join('') : s.slice(1)
  const n = Number.parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const hex = (c: RGB) => `#${c.map((x) => clamp(x).toString(16).padStart(2, '0')).join('')}`
const rgba = (c: RGB, a: number) => `rgba(${c.map(clamp).join(', ')}, ${+a.toFixed(3)})`
/** a 占 t（0–1），其余为 b */
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] * t + b[0] * (1 - t),
  a[1] * t + b[1] * (1 - t),
  a[2] * t + b[2] * (1 - t),
]
const A = (c: RGB, a = 1): RGBA => [c[0], c[1], c[2], a]
const ratio = (a: RGB, b: RGB) => contrastRatio(A(a), A(b))
const luminance = (c: RGB) => {
  const f = (x: number) => {
    const s = x / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

/** 朝 toward 逐步混合，直到对所有底色都 ≥ min（最多混到纯色） */
function ensure(c: RGB, backs: RGB[], min: number, toward: RGB): RGB {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const x = mix(toward, c, t)
    if (backs.every((b) => ratio(x, b) >= min)) return x
  }
  return toward
}

/** 底色明度钳在模式范围内：夜场不亮于 lum 0.035，日场不暗于 lum 0.72 */
function clampBase(c: RGB, mode: SkinMode): RGB {
  const ok = (x: RGB) => (mode === 'dark' ? luminance(x) <= 0.035 : luminance(x) >= 0.72)
  if (ok(c)) return c
  const toward = mode === 'dark' ? BLACK : WHITE
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    const x = mix(toward, c, t)
    if (ok(x)) return x
  }
  return toward
}

/** 由背景图 / canvas 推断模式（包里 mode 缺失或为 mixed 时） */
export function inferMode(palette: SkinPalette): SkinMode {
  const c = palette.canvas ? parseHex(palette.canvas) : null
  return c && luminance(c) < 0.18 ? 'dark' : 'light'
}

// ---------- palette → token ----------

/**
 * 图片强度（ADR-0061）：淡 = 遮罩厚、卡片实底（ADR-0059 原样）；中（默认）= 遮罩薄、卡片近实底；浓 = 遮罩很薄、卡片半透明。
 * 日场遮罩比夜场厚：日场插画多为中等明度，比底色暗得多，遮罩太薄时直接压在图上的浅灰字会发虚（夜场插画本身偏暗，浅字没问题）。
 * 玻璃 / 卡片按主题 surface 染色；记录正文阅读纸面（`.paper.xz-reading`）各档都是实底。
 */
export const SKIN_ART_LEVELS = ['soft', 'medium', 'strong'] as const
export type SkinArtLevel = (typeof SKIN_ART_LEVELS)[number]
export const DEFAULT_SKIN_ART: SkinArtLevel = 'medium'
type Material = { thin: number; glass: number; thick: number; veil: number; paper: number }
const SKIN_ART: Record<SkinMode, Record<SkinArtLevel, Material>> = {
  dark: {
    soft: { thin: 0.6, glass: 0.7, thick: 0.8, veil: 0.55, paper: 1 },
    medium: { thin: 0.52, glass: 0.62, thick: 0.72, veil: 0.28, paper: 0.9 },
    strong: { thin: 0.4, glass: 0.5, thick: 0.6, veil: 0.12, paper: 0.78 },
  },
  light: {
    soft: { thin: 0.58, glass: 0.68, thick: 0.8, veil: 0.62, paper: 1 },
    medium: { thin: 0.5, glass: 0.6, thick: 0.72, veil: 0.45, paper: 0.9 },
    strong: { thin: 0.4, glass: 0.5, thick: 0.6, veil: 0.3, paper: 0.78 },
  },
}

export interface SkinTokens {
  /** 基础 token（= 默认档「中」的材质） */
  vars: Record<string, string>
  /** 各档图片强度的材质覆盖（玻璃 / 卡片 / 遮罩 / 文字光晕） */
  levels: Record<SkinArtLevel, Record<string, string>>
  /** 减弱透明度时的覆盖（玻璃改实色） */
  opaque: Record<string, string>
}

export function skinTokens(rec: Pick<SkinRecord, 'mode' | 'palette'>): SkinTokens {
  const { mode, palette: p } = rec
  const dark = mode === 'dark'
  const get = (k: SkinPaletteKey) => (p[k] ? parseHex(p[k] as string) : null)
  const away = dark ? WHITE : BLACK // 文字往这边推才更醒目
  const mats = SKIN_ART[mode]

  const canvas = clampBase(get('canvas') ?? (dark ? [10, 12, 11] : [244, 244, 241]), mode)
  const surface = clampBase(get('surface') ?? canvas, mode)
  const raised = clampBase(get('raised') ?? surface, mode)
  const accent = get('accent') ?? (dark ? [46, 231, 156] : [2, 179, 119])
  const glow1 = A(accent, dark ? 0.2 : 0.18)
  const focus = get('focus')
  const glow2 = A(focus ?? mix(accent, canvas, 0.6), dark ? 0.16 : 0.14)

  // 最坏底：各档里最薄的玻璃压在最浓光晕上（与 check-contrast 同口径）；纸面取最透的一档（背景图按底色估，图本身不可知）
  const thinnest = Math.min(...SKIN_ART_LEVELS.map((l) => mats[l].thin))
  const paperMin = Math.min(...SKIN_ART_LEVELS.map((l) => mats[l].paper))
  const worst = over(A(surface, thinnest), over(glow1, A(canvas))).slice(0, 3) as RGB
  const paperWorst = over(A(surface, paperMin), A(canvas)).slice(0, 3) as RGB
  const backs = [worst, paperWorst, surface, raised, canvas]

  const fg = ensure(get('text') ?? (dark ? [236, 234, 227] : [29, 33, 28]), backs, 7, away)
  const muted = ensure(get('muted') ?? mix(fg, canvas, 0.62), backs, 4.5, away)
  const faint = ensure(mix(muted, canvas, 0.7), backs, 3, away)

  // 主色：作填充（按钮、当前项）+ 文字（primary-text）；填充上的字取深墨或白，挑对比更高的
  const bright = mix(WHITE, accent, dark ? 0.22 : 0.16)
  const inkDark = mix(accent, BLACK, 0.14)
  const pick = (fill: RGB[]) =>
    [inkDark, WHITE as RGB]
      .map((ink) => ({ ink, r: Math.min(...fill.map((f) => ratio(ink, f))) }))
      .sort((a, b) => b.r - a.r)[0] as { ink: RGB; r: number }
  let primary = accent
  let primaryBright = bright
  let { ink: primaryFg } = pick([primary, primaryBright])
  // 填充与墨色对比不足：把填充推离墨色
  if (pick([primary, primaryBright]).r < 4.5) {
    const toward = luminance(primaryFg) > 0.5 ? BLACK : WHITE
    primary = ensure(primary, [primaryFg], 4.5, toward)
    primaryBright = ensure(primaryBright, [primaryFg], 4.5, toward)
    primaryFg = pick([primary, primaryBright]).ink
  }
  const primaryText = ensure(accent, backs, 4.5, away)
  const soft = (c: RGB) => mix(c, surface, dark ? 0.22 : 0.16)

  const vars: Record<string, string> = {
    'color-scheme': mode,
    '--xz-bg': hex(canvas),
    '--xz-glow-1': rgba(accent, glow1[3]),
    '--xz-glow-2': rgba(glow2.slice(0, 3) as RGB, glow2[3]),
    '--xz-glow-3': rgba(mix(accent, canvas, 0.4), 0.12),
    '--xz-glass-opaque': hex(raised),
    '--xz-surface-solid': hex(surface),
    '--xz-surface-solid-2': hex(mix(fg, surface, 0.04)),
    '--xz-border': rgba(get('border') ?? mix(fg, canvas, 0.3), dark ? 0.5 : 0.55),
    '--xz-divider': rgba(get('border') ?? mix(fg, canvas, 0.3), dark ? 0.28 : 0.3),
    '--xz-fg': hex(fg),
    '--xz-fg-muted': hex(muted),
    '--xz-fg-faint': hex(faint),
    '--xz-primary': hex(primary),
    '--xz-primary-bright': hex(primaryBright),
    '--xz-primary-fg': hex(primaryFg),
    '--xz-primary-text': hex(primaryText),
    '--xz-primary-soft': hex(soft(accent)),
    '--xz-shadow-seal': `0 4px 16px ${rgba(accent, 0.32)}, inset 0 1px 0 rgba(255, 255, 255, 0.4)`,
  }
  const material = (m: Material): Record<string, string> => ({
    '--xz-glass-thin': rgba(surface, m.thin),
    '--xz-glass': rgba(surface, m.glass),
    '--xz-glass-thick': rgba(surface, m.thick),
    '--xz-paper-bg': m.paper >= 1 ? 'var(--xz-surface-solid)' : rgba(surface, m.paper),
    '--xz-skin-veil': rgba(canvas, m.veil),
    // 直接压在图上的字（页标题、分组标签）垫一圈不透明底色光晕（地图标注式）；淡档遮罩够厚，不加
    '--xz-skin-halo': m.veil >= 0.5 ? 'transparent' : hex(canvas),
  })
  Object.assign(vars, material(mats[DEFAULT_SKIN_ART]))
  if (focus) {
    const c = ensure(focus, [surface], 3, away)
    vars['--xz-accent'] = hex(c)
    vars['--xz-accent-soft'] = hex(soft(c))
  }
  for (const k of ['success', 'warning'] as const) {
    const c0 = get(k)
    if (!c0) continue
    const c = ensure(c0, [surface, worst], 3, away)
    vars[`--xz-${k}`] = hex(c)
    vars[`--xz-${k}-soft`] = hex(soft(c))
  }
  const d0 = get('danger')
  if (d0) {
    const dSoft = soft(d0)
    // danger 字直接压在底板 / 淡底上（≥ 4.5），danger 填充上的字（danger-fg）≥ 4.5
    const d = ensure(d0, [canvas, surface, worst, dSoft], 4.5, away)
    vars['--xz-danger'] = hex(d)
    vars['--xz-danger-soft'] = hex(dSoft)
    vars['--xz-danger-fg'] = hex(
      ratio(WHITE, d) >= ratio(mix(d, BLACK, 0.12), d) ? WHITE : mix(d, BLACK, 0.12),
    )
  }
  return {
    vars,
    levels: {
      soft: material(mats.soft),
      medium: material(mats.medium),
      strong: material(mats.strong),
    },
    opaque: {
      '--xz-glass-thin': hex(surface),
      '--xz-glass': hex(surface),
      '--xz-glass-thick': hex(raised),
      '--xz-paper-bg': 'var(--xz-surface-solid)',
      '--xz-skin-veil': hex(canvas),
      '--xz-skin-halo': 'transparent',
    },
  }
}

/** 背景图地址（同源 API，带版本号可长缓存） */
export const skinAssetUrl = (id: string, version: string, kind: 'art' | 'thumb') =>
  `/api/v1/skins/${id}/${kind}?v=${encodeURIComponent(version)}`

const decls = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

/**
 * 主题样式表：`:root[data-skin="<id>"]` 覆盖 token（基础 = 默认档「中」）；`[data-skin-art="soft|strong"]` 换材质档（ADR-0061）；
 * 减弱透明度（系统设置 / 手动档）时玻璃改实色、遮罩改不透明，放在最后且特异度不低于档位块。
 * 主题生效时客户端移除 `data-glass`，玻璃强度预设不参与（主题自带材质）。
 */
export function skinCss(rec: SkinRecord): string {
  if (!SKIN_ID_RE.test(rec.id) || !VERSION_RE.test(rec.version)) throw new Error('非法皮肤')
  const t = skinTokens(rec)
  const sel = `:root[data-skin="${rec.id}"]`
  const art = rec.art ? `url("${skinAssetUrl(rec.id, rec.version, 'art')}")` : 'none'
  const focal = FOCAL_RE.test(rec.focal) ? rec.focal : '50% 50%'
  const vars = { ...t.vars, '--xz-skin-art': art, '--xz-skin-pos': focal }
  const level = (l: SkinArtLevel) => `${sel}[data-skin-art="${l}"] {\n${decls(t.levels[l])}\n}`
  return [
    `${sel} {\n${decls(vars)}\n}`,
    level('soft'),
    level('strong'),
    `@media (prefers-reduced-transparency: reduce), print {\n${sel}, ${sel}[data-skin-art] {\n${decls(t.opaque)}\n}\n}`,
    `:root[data-transparency="reduce"]${sel.slice(5)}, :root[data-transparency="reduce"]${sel.slice(5)}[data-skin-art] {\n${decls(t.opaque)}\n}`,
  ].join('\n')
}

// ---------- `.codex-theme` 包规范化（安装器用；图片另行按魔数校验） ----------

/** 只校验要用到的字段；自由文本不限长（整包已限 30 MB），用时再截断；焦点等解析不了就回落默认，不一票否决 */
const text = z.string().optional().catch(undefined)
const imageSchema = z
  .object({ filename: z.string(), mimeType: z.string(), base64: z.string() })
  .nullish()
export const codexPackageSchema = z.object({
  format: z.literal('codex-theme'),
  schemaVersion: z.number().optional(),
  manifest: z.looseObject({
    id: text,
    displayName: text,
    description: text,
    version: text,
    mode: text,
    design: z.looseObject({ artFocalPoint: text }).optional().catch(undefined),
    palette: z.record(z.string(), z.unknown()).optional().catch(undefined),
    author: z
      .union([z.looseObject({ name: text }), z.string()])
      .optional()
      .catch(undefined),
  }),
  art: imageSchema,
  preview: imageSchema.catch(undefined),
})
export type CodexPackage = z.infer<typeof codexPackageSchema>

/** 主题包 id → 本地 id：小写、非法字符换连字符 */
export function slugSkinId(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return SKIN_ID_RE.test(s) && !SKIN_RESERVED.has(s) ? s : ''
}

/** 只保留合法 hex 的 palette 键（"native unchanged" 之类丢弃） */
export function normalizePalette(raw: Record<string, unknown> | undefined): SkinPalette {
  const out: SkinPalette = {}
  for (const k of SKIN_PALETTE_KEYS) {
    const v = raw?.[k]
    if (typeof v === 'string' && HEX_RE.test(v.trim().toLowerCase()))
      out[k] = v.trim().toLowerCase()
  }
  return out
}

/** 焦点只认「NN% NN%」，其余回落居中 */
export function normalizeFocal(raw: string | undefined): string {
  const m = raw ? /^\s*(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%\s*$/.exec(raw) : null
  if (!m) return '50% 50%'
  const n = (x: string) => Math.min(100, Math.round(Number(x)))
  return `${n(m[1] as string)}% ${n(m[2] as string)}%`
}

export function normalizeVersion(raw: string | undefined): string {
  const v = (raw ?? '').trim()
  return VERSION_RE.test(v) ? v : '0.0.0'
}

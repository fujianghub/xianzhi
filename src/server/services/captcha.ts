/**
 * 登录拼图滑块（ADR-0006、REQ-AUTH-016）：服务端出题、一次性校验。
 * - 画面：随机山脊 / 枝条 / 散点的 SVG 场景，sharp 以 2× 光栅化后缩到 320×160；缺口只由像素表达，响应里没有 x
 * - 答案：Better Auth `verification` 表（identifier `captcha:<id>`，value = {x, t}），120 s 过期；
 *   校验用一条 `DELETE … RETURNING` 取出即删，对错都消费（原子，防并发重放）
 * - 判定：|x − target| ≤ 6 且出题到提交 ≥ minSolveMs（防脚本秒解）
 * - 通行证：接受邀请后自动登录用的一次性豁免（identifier `captcha-pass:<id>`，60 s）
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { and, eq, like, lt } from 'drizzle-orm'
import sharp from 'sharp'
import type { Db } from '../db/index.ts'
import { verification } from '../db/schema/auth.ts'

export const CAPTCHA = {
  width: 320,
  height: 160,
  tolerance: 6,
  ttlMs: 120_000,
  passTtlMs: 60_000,
} as const

export interface CaptchaOptions {
  /** 非生产可开：响应附带答案，供 API 测试与 e2e 走真实流程（生产强制 false，见 app.ts） */
  debug?: boolean
  /** 最短解题时间，默认 600 ms；测试注入 0 */
  minSolveMs?: number
}

export interface CaptchaChallenge {
  id: string
  background: string
  piece: string
  y: number
  pieceSize: number
  width: number
  height: number
  debugX?: number
}

type Rgb = [number, number, number]
/** 画面色板（与站点 token 无关：验证码图是位图内容，不是界面样式） */
const PALETTES: { top: Rgb; bottom: Rgb; ink: Rgb; accent: Rgb }[] = [
  { top: [226, 244, 236], bottom: [184, 226, 208], ink: [18, 104, 76], accent: [2, 179, 119] },
  { top: [247, 238, 222], bottom: [232, 212, 178], ink: [96, 70, 38], accent: [194, 133, 44] },
  { top: [226, 232, 246], bottom: [192, 204, 234], ink: [44, 56, 110], accent: [92, 112, 182] },
  { top: [242, 230, 238], bottom: [222, 196, 214], ink: [104, 46, 86], accent: [170, 84, 140] },
  { top: [224, 240, 240], bottom: [186, 220, 222], ink: [28, 90, 96], accent: [40, 150, 160] },
  { top: [48, 54, 66], bottom: [26, 30, 40], ink: [214, 206, 180], accent: [226, 169, 79] },
]

const rgb = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]
const rand = (min: number, max: number) => min + (randomInt(0, 10_000) / 10_000) * (max - min)

/** 2× 画布上的场景：纵向渐变 + 三层山脊 + 枝条折线 + 散点 */
function scene(S: number): string {
  const W = CAPTCHA.width * S
  const H = CAPTCHA.height * S
  const p = PALETTES[randomInt(0, PALETTES.length)] as (typeof PALETTES)[number]
  const parts: string[] = [
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="${rand(0, 0.4).toFixed(2)}" y2="1">`,
    `<stop offset="0" stop-color="${rgb(p.top)}"/><stop offset="1" stop-color="${rgb(p.bottom)}"/>`,
    '</linearGradient></defs>',
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>`,
  ]
  for (let i = 0; i < 3; i++) {
    const base = H * (0.45 + 0.17 * i)
    const pts: string[] = [`0,${H}`]
    for (let x = 0; x <= W; x += W / 8)
      pts.push(`${x.toFixed(0)},${(base + rand(-H / 9, H / 9)).toFixed(0)}`)
    pts.push(`${W},${H}`)
    parts.push(
      `<polygon points="${pts.join(' ')}" fill="${rgb(mix(p.bottom, p.ink, 0.2 + 0.2 * i))}"/>`,
    )
  }
  for (let i = 0, n = randomInt(3, 6); i < n; i++) {
    const pts: string[] = []
    for (let k = 0, m = randomInt(3, 6); k < m; k++)
      pts.push(`${rand(0, W).toFixed(0)},${rand(0, H).toFixed(0)}`)
    parts.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${rgb(p.ink, rand(0.35, 0.7))}" stroke-width="${rand(1.5, 3.5) * S}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  }
  for (let i = 0, n = randomInt(14, 26); i < n; i++)
    parts.push(
      `<circle cx="${rand(0, W).toFixed(0)}" cy="${rand(0, H).toFixed(0)}" r="${(rand(1, 3) * S).toFixed(1)}" fill="${rgb(i % 3 ? p.ink : p.accent, rand(0.3, 0.8))}"/>`,
    )
  return parts.join('')
}

/** 拼块轮廓（box×box 局部坐标，2× 尺度）：圆角主体 + 四边各一个凸 / 凹 / 平口 */
function pieceShape(box: number): { body: string; holes: string } {
  const pad = box * 0.18
  const r = box * 0.13
  const inner = box - pad * 2
  const tabs: number[] = [0, 1, 2, 3].map(() => randomInt(-1, 2))
  if (!tabs.some((t) => t !== 0)) tabs[randomInt(0, 4)] = 1
  const mids: [number, number][] = [
    [box / 2, pad],
    [box - pad, box / 2],
    [box / 2, box - pad],
    [pad, box / 2],
  ]
  let body = `<rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${box * 0.1}"/>`
  let holes = ''
  tabs.forEach((t, i) => {
    const [cx, cy] = mids[i] as [number, number]
    if (t === 1) body += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`
    if (t === -1) holes += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`
  })
  return { body, holes }
}

function mask(id: string, shape: { body: string; holes: string }) {
  return `<mask id="${id}"><g fill="#fff">${shape.body}</g><g fill="#000">${shape.holes}</g></mask>`
}

/** 1px 白色棱线：遮罩减去腐蚀后的遮罩 */
const RIM = `<filter id="rim" x="0" y="0" width="100%" height="100%"><feMorphology in="SourceAlpha" operator="erode" radius="2.4" result="e"/><feComposite in="SourceAlpha" in2="e" operator="out" result="ring"/><feFlood flood-color="#fff"/><feComposite in2="ring" operator="in"/></filter>`

/** 纯渲染（不落库）：返回两张 webp 与答案，供 createCaptcha 与单测使用。 */
export async function renderCaptcha() {
  const S = 2
  const box = randomInt(50, 59) // 1× 像素
  const x = randomInt(box + 12, CAPTCHA.width - box - 8)
  const y = randomInt(8, CAPTCHA.height - box - 8)
  const W = CAPTCHA.width * S
  const H = CAPTCHA.height * S
  const B = box * S
  const shape = pieceShape(B)
  const art = scene(S)

  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${art}<defs>${mask('m', shape)}${RIM}</defs><g transform="translate(${x * S} ${y * S})"><rect width="${B}" height="${B}" fill="#000" fill-opacity=".48" mask="url(#m)"/><g filter="url(#rim)" opacity=".6"><rect width="${B}" height="${B}" fill="#fff" mask="url(#m)"/></g></g></svg>`
  const pieceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${B}" height="${B}"><defs>${mask('m', shape)}${RIM}</defs><g mask="url(#m)"><g transform="translate(${-x * S} ${-y * S})">${art}</g></g><g filter="url(#rim)" opacity=".85"><rect width="${B}" height="${B}" fill="#fff" mask="url(#m)"/></g></svg>`

  const [bg, piece] = await Promise.all([
    sharp(Buffer.from(bgSvg))
      .resize(CAPTCHA.width, CAPTCHA.height, { kernel: 'lanczos3' })
      .webp({ quality: 82 })
      .toBuffer(),
    sharp(Buffer.from(pieceSvg))
      .resize(box, box, { kernel: 'lanczos3' })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer(),
  ])
  return { bg, piece, x, y, box }
}

export async function createCaptcha(db: Db, opts: CaptchaOptions = {}): Promise<CaptchaChallenge> {
  const { bg, piece, x, y, box } = await renderCaptcha()
  const id = randomBytes(16).toString('base64url')
  const now = Date.now()
  // 顺手清掉过期题目（表很小，按前缀 + 过期时间删）
  await db
    .delete(verification)
    .where(
      and(like(verification.identifier, 'captcha%'), lt(verification.expiresAt, new Date(now))),
    )
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: `captcha:${id}`,
    value: JSON.stringify({ x, t: now }),
    expiresAt: new Date(now + CAPTCHA.ttlMs),
  })
  return {
    id,
    background: `data:image/webp;base64,${bg.toString('base64')}`,
    piece: `data:image/webp;base64,${piece.toString('base64')}`,
    y,
    pieceSize: box,
    width: CAPTCHA.width,
    height: CAPTCHA.height,
    ...(opts.debug ? { debugX: x } : {}),
  }
}

/** 校验 `x-captcha` 头：`<id>:<x>`（拼图）或 `pass:<id>`（邀请通行证）。任何结果都消费掉该题。 */
export async function verifyCaptcha(
  db: Db,
  header: string | undefined,
  opts: CaptchaOptions = {},
): Promise<boolean> {
  if (!header) return false
  const sep = header.indexOf(':')
  if (sep <= 0) return false
  const [a, b] = [header.slice(0, sep), header.slice(sep + 1)]
  if (a === 'pass') {
    const [row] = await db
      .delete(verification)
      .where(eq(verification.identifier, `captcha-pass:${b}`))
      .returning()
    return !!row && row.expiresAt.getTime() > Date.now()
  }
  const [row] = await db
    .delete(verification)
    .where(eq(verification.identifier, `captcha:${a}`))
    .returning()
  if (!row || row.expiresAt.getTime() <= Date.now()) return false
  const xi = Number(b)
  if (!Number.isFinite(xi)) return false
  const { x, t } = JSON.parse(row.value) as { x: number; t: number }
  if (Date.now() - t < (opts.minSolveMs ?? 600)) return false
  return Math.abs(Math.round(xi) - x) <= CAPTCHA.tolerance
}

/** 接受邀请成功后签发：60 s 内可替代一次拼图，仅用于紧随其后的自动登录。 */
export async function issueCaptchaPass(db: Db): Promise<string> {
  const id = randomBytes(16).toString('base64url')
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: `captcha-pass:${id}`,
    value: '',
    expiresAt: new Date(Date.now() + CAPTCHA.passTtlMs),
  })
  return `pass:${id}`
}

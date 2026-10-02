import { createHmac } from 'node:crypto'
import { type APIRequestContext, expect, type Page } from '@playwright/test'

/** 可用 XZ_E2E_BASE 指向其它验证实例（如 worktree 自己的 3021）；默认 3011 */
export const BASE = process.env.XZ_E2E_BASE ?? 'http://localhost:3011'
export const MAILPIT = 'http://localhost:8025'
export const OWNER = { email: 'owner@demo.local', password: 'demo-owner' }
export const MEMBER = { email: 'member@demo.local', password: 'demo-member' }
export const GUEST = { email: 'guest@demo.local', password: 'demo-guest' }
export const STATE = { owner: 'e2e/.auth/owner.json', member: 'e2e/.auth/member.json' }

/**
 * 完成登录拼图（REQ-AUTH-016）：验证实例回显答案（data-debug-x，production 不回显），按手柄行程换算后用真实鼠标拖拽。
 * 先等 700 ms 满足服务端最短解题时间。
 */
export async function solveCaptcha(page: Page) {
  const box = page.getByTestId('captcha')
  await expect(box).toHaveAttribute('data-debug-x', /^\d+$/)
  await expect(box).not.toHaveAttribute('data-solved', /.*/)
  const x = Number(await box.getAttribute('data-debug-x'))
  const handle = page.getByTestId('captcha-handle')
  const max = Number(await handle.getAttribute('aria-valuemax'))
  // 先等：满足服务端最短解题时间，也等换题后手柄的回弹动画结束，再量位置
  await page.waitForTimeout(700)
  const hb = await handle.boundingBox()
  const tb = await handle.locator('..').boundingBox()
  if (!hb || !tb) throw new Error('captcha handle not visible')
  const dx = (x / max) * (tb.width - hb.width)
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(box).toHaveAttribute('data-solved', 'true')
}

export async function login(page: Page, u: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(u.email)
  await page.getByLabel('密码', { exact: true }).fill(u.password)
  await solveCaptcha(page)
  await page.getByTestId('login-submit').click()
}

/** 同站 JSON 请求（过 CSRF）。 */
export const sameSite = { origin: BASE, 'sec-fetch-site': 'same-origin' }

export async function mailTo(req: APIRequestContext, to: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await req.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    const j = (await r.json()) as { messages: { ID: string }[] }
    if (j.messages[0])
      return (await (await req.get(`${MAILPIT}/api/v1/message/${j.messages[0].ID}`)).json()) as {
        Text: string
        HTML: string
        Subject: string
      }
    await new Promise((res) => setTimeout(res, 250))
  }
  throw new Error(`Mailpit 未收到发给 ${to} 的邮件`)
}

/** RFC 6238 TOTP（SHA1 / 6 位 / 30s），base32 密钥。 */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [])
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', bytes).update(counter).digest()
  const o = (h[h.length - 1] as number) & 0xf
  const n =
    (((h[o] as number) & 0x7f) << 24) |
    ((h[o + 1] as number) << 16) |
    ((h[o + 2] as number) << 8) |
    (h[o + 3] as number)
  return String(n % 1_000_000).padStart(6, '0')
}

/** 当前视口内可见且 backdrop-filter 生效的元素数（06 §8）。 */
export async function countBlur(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(el)
      const bf = cs.backdropFilter || 'none'
      if (bf === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none')
        continue
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
      // ADR-0046：正在播退出动画、dur-fast 后即卸载的浮层不计
      if (el.closest('[data-xz-exit][data-state="closed"]')) continue
      n++
    }
    return n
  })
}

/**
 * 外观偏好随账号保存（ADR-0049）：用例要指定主题 / 密度 / 动效 / 玻璃强度时走 API 设账号值，用完 resetAppearance 复位
 * （xz_e2e 共用库、按人存；勿再写 localStorage——登录后会被账号值覆盖）。
 */
export async function setAppearancePref(
  req: APIRequestContext,
  appearance: Record<string, string | null>,
) {
  const r = await req.patch('/api/v1/me/preferences', { data: { appearance }, headers: sameSite })
  expect(r.status(), await r.text()).toBe(200)
}
export async function resetAppearance(req: APIRequestContext) {
  await setAppearancePref(req, { theme: null, density: null, motion: null, glass: null })
}
/** 等外观偏好的 PATCH 落库（UI 改完立刻 reload 的用例） */
export const appearanceSaved = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/api/v1/me/preferences') && r.request().method() === 'PATCH',
  )

export async function createEntry(req: APIRequestContext, body: Record<string, unknown>) {
  const r = await req.post('/api/v1/entries', { data: body, headers: sameSite })
  expect(r.status()).toBe(201)
  return ((await r.json()) as { id: string }).id
}

/** 打开文档栏「阅读」弹层并切到某分页（ADR-0037：四图标胶囊合为一个弹层，分页沿用 reading-open-* testid） */
export async function openReading(page: Page, tab: 'font' | 'paper' | 'layout' | 'toc') {
  // ADR-0046：Esc 后弹层还在播退出动画（仍「可见」），只认打开态，并等退场的卸载
  const t = page.locator('[data-xz-exit][data-state="open"]').getByTestId(`reading-open-${tab}`)
  if (!(await t.isVisible())) {
    await expect(page.locator('[data-xz-exit][data-state="closed"]')).toHaveCount(0)
    await page.getByTestId('reading-open').click()
  }
  await t.click()
}

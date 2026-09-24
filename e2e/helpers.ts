import { createHmac } from 'node:crypto'
import { type APIRequestContext, expect, type Page } from '@playwright/test'

export const BASE = 'http://localhost:3011'
export const MAILPIT = 'http://localhost:8025'
export const OWNER = { email: 'owner@demo.local', password: 'demo-owner' }
export const MEMBER = { email: 'member@demo.local', password: 'demo-member' }
export const GUEST = { email: 'guest@demo.local', password: 'demo-guest' }
export const STATE = { owner: 'e2e/.auth/owner.json', member: 'e2e/.auth/member.json' }

export async function login(page: Page, u: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(u.email)
  await page.getByLabel('密码').fill(u.password)
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
      n++
    }
    return n
  })
}

export async function createEntry(req: APIRequestContext, body: Record<string, unknown>) {
  const r = await req.post('/api/v1/entries', { data: body, headers: sameSite })
  expect(r.status()).toBe(201)
  return ((await r.json()) as { id: string }).id
}

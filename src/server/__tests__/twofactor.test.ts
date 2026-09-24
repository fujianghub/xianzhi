/** REQ-AUTH-006（api）2FA：开启需 TOTP 验证、10 个恢复码、登录需二次验证、恢复码一次性；REQ-AUTH-008 魔法链接一次性。 */
import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, mailbox, OWNER, seedOwner, signIn } from './helpers.ts'

function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [])
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = (h[h.length - 1] as number) & 0xf
  const n =
    (((h[o] as number) & 0x7f) << 24) |
    ((h[o + 1] as number) << 16) |
    ((h[o + 2] as number) << 8) |
    (h[o + 3] as number)
  return String(n % 1_000_000).padStart(6, '0')
}
const cookiesOf = (res: Response) =>
  (res.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')

describe('2FA & magic link', () => {
  let app: ReturnType<typeof buildApp>['app']
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
  })

  it('REQ-AUTH-006 开启 2FA：enable 返回 10 个恢复码，verify-totp 后生效；再登录需 TOTP；恢复码用一次即失效', async () => {
    const { cookie } = await signIn(app, OWNER.email, OWNER.password)
    const en = await app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ password: OWNER.password }),
    })
    expect(en.status).toBe(200)
    const { totpURI, backupCodes } = (await en.json()) as { totpURI: string; backupCodes: string[] }
    expect(backupCodes).toHaveLength(10)
    const secret =
      new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret') ?? ''
    const v = await app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ code: totp(secret) }),
    })
    expect(v.status).toBe(200)

    const second = await signIn(app, OWNER.email, OWNER.password)
    expect(second.res.status).toBe(200)
    expect(((await second.res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(
      true,
    )
    expect((await app.request('/api/v1/me', { headers: { cookie: second.cookie } })).status).toBe(
      401,
    ) // 半登录态不可访问业务 API
    const ok = await app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: jsonHeaders({ cookie: second.cookie }),
      body: JSON.stringify({ code: totp(secret) }),
    })
    expect(ok.status).toBe(200)
    expect((await app.request('/api/v1/me', { headers: { cookie: cookiesOf(ok) } })).status).toBe(
      200,
    )

    const useBackup = async () => {
      const s = await signIn(app, OWNER.email, OWNER.password)
      return app.request('/api/auth/two-factor/verify-backup-code', {
        method: 'POST',
        headers: jsonHeaders({ cookie: s.cookie }),
        body: JSON.stringify({ code: backupCodes[0] }),
      })
    }
    expect((await useBackup()).status).toBe(200)
    expect((await useBackup()).status).not.toBe(200)
  })

  it('REQ-AUTH-008 魔法链接：已注册邮箱收到邮件；链接点一次登录成功，再点失效', async () => {
    await truncateAll()
    await seedOwner()
    mailbox.length = 0
    const req = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: OWNER.email, callbackURL: '/today' }),
    })
    expect(req.status).toBe(200)
    const link = /https?:\/\/\S+/.exec(mailbox.at(-1)?.text ?? '')?.[0]
    expect(link).toBeTruthy()
    const u = new URL(link as string)
    const first = await app.request(`${u.pathname}${u.search}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
      redirect: 'manual',
    })
    expect([200, 302]).toContain(first.status)
    const cookie = cookiesOf(first)
    expect(cookie).toContain('session_token')
    expect((await app.request('/api/v1/me', { headers: { cookie } })).status).toBe(200)
    const again = await app.request(`${u.pathname}${u.search}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
      redirect: 'manual',
    })
    expect(cookiesOf(again)).not.toContain('session_token=')
  })
})

/** ADR-0008 开放注册 + 待审批 + 用户名登录（REQ-AUTH-017 · 018 · 019 · 020，api 层）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getAuth } from '../auth.ts'
import { member, session, user } from '../db/schema/auth.ts'
import { events, joinRequests } from '../db/schema/business.ts'
import { createOwner } from '../services/workspace.ts'
import { db, truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']

async function captchaOf(app: App): Promise<string> {
  const q = await app.request('/api/captcha')
  const c = (await q.json()) as { id: string; debugX: number }
  return `${c.id}:${c.debugX}`
}

async function register(app: App, body: Record<string, string>, captcha?: string) {
  return app.request('/api/v1/workspace/join-requests', {
    method: 'POST',
    headers: jsonHeaders({ 'x-captcha': captcha ?? (await captchaOf(app)) }),
    body: JSON.stringify(body),
  })
}

async function signInUsername(app: App, username: string, password: string) {
  const res = await app.request('/api/auth/sign-in/username', {
    method: 'POST',
    headers: jsonHeaders({ 'x-captcha': await captchaOf(app) }),
    body: JSON.stringify({ username, password }),
  })
  return { res, setCookie: res.headers.get('set-cookie') ?? '' }
}

describe('ADR-0008 注册与审批', () => {
  let app: App
  let ownerCookie = ''
  const alice = {
    email: 'alice@xz.local',
    username: 'Alice_01',
    name: '爱丽丝',
    password: 'alice-pw1',
  }

  beforeAll(async () => {
    await truncateAll()
    await createOwner(db(), getAuth(), { ...OWNER, username: 'owneR' })
    app = buildApp().app
    ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('REQ-AUTH-017 注册缺拼图 400 CAPTCHA_INVALID，不建号', async () => {
    const res = await register(app, alice, 'bogus:1')
    expect(res.status).toBe(400)
    expect((await problemOf(res)).code).toBe('CAPTCHA_INVALID')
    expect(await db().select().from(user).where(eq(user.email, alice.email))).toHaveLength(0)
  })

  it('REQ-AUTH-017 注册按 IP 限流：超限 429', async () => {
    const limited = buildApp({ registerLimit: 1 }).app
    const body = { ...alice, username: 'x!!' } // 校验失败也计数
    expect((await register(limited, body)).status).toBe(422)
    expect((await register(limited, body)).status).toBe(429)
  })

  it('REQ-AUTH-017 密码 < 8 位 / 非法用户名 422', async () => {
    expect((await register(app, { ...alice, password: 'short7!' })).status).toBe(422)
    expect((await register(app, { ...alice, username: 'a b' })).status).toBe(422)
    expect((await register(app, { ...alice, username: '_x' })).status).toBe(422)
  })

  it('REQ-AUTH-017 注册成功：201 pending；user 有、member 无；admin 收到 member.requested', async () => {
    const res = await register(app, alice)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ status: 'pending' })
    const [u] = await db().select().from(user).where(eq(user.email, alice.email))
    expect(u?.username).toBe('alice_01')
    expect(u?.displayUsername).toBe('Alice_01')
    expect(
      await db()
        .select()
        .from(member)
        .where(eq(member.userId, u?.id ?? '')),
    ).toHaveLength(0)
    const ev = await db().select().from(events).where(eq(events.kind, 'member.requested'))
    expect(ev).toHaveLength(1)
  })

  it('REQ-AUTH-017 重复邮箱 / 用户名 409 CONFLICT_UNIQUE（按字段）', async () => {
    const dupEmail = await register(app, { ...alice, username: 'alice02' })
    expect(dupEmail.status).toBe(409)
    expect((await problemOf(dupEmail)).errors?.[0]?.path).toBe('email')
    const dupName = await register(app, { ...alice, email: 'a2@xz.local', username: 'ALICE_01' })
    expect(dupName.status).toBe(409)
    expect((await problemOf(dupName)).errors?.[0]?.path).toBe('username')
  })

  it('REQ-AUTH-018 待审批账号登录：密码对 → 403 REGISTRATION_PENDING，不下发 Cookie、不留会话', async () => {
    const r = await signIn(app, alice.email, alice.password)
    expect(r.res.status).toBe(403)
    expect((await problemOf(r.res)).code).toBe('REGISTRATION_PENDING')
    expect(r.setCookie).not.toMatch(/session_token=[^;]+/)
    const [u] = await db().select().from(user).where(eq(user.email, alice.email))
    expect(
      await db()
        .select()
        .from(session)
        .where(eq(session.userId, u?.id ?? '')),
    ).toHaveLength(0)
    // 密码错仍是 401，不泄露待审批状态
    expect((await signIn(app, alice.email, 'wrong-password')).res.status).toBe(401)
  })

  it('REQ-AUTH-018 待审批账号不能收魔法链接', async () => {
    const res = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: alice.email, callbackURL: '/' }),
    })
    expect(res.status).toBe(200)
    const { mailbox } = await import('./helpers.ts')
    expect(mailbox.some((m) => m.to === alice.email)).toBe(false)
  })

  it('REQ-AUTH-018 列表仅 owner/admin；审批后成为 member 并可登录', async () => {
    const list = await app.request('/api/v1/workspace/join-requests', {
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(list.status).toBe(200)
    const { items } = (await list.json()) as { items: { id: string; username: string }[] }
    expect(items).toHaveLength(1)
    expect(items[0]?.username).toBe('Alice_01')
    const id = items[0]?.id ?? ''
    const ok = await app.request(`/api/v1/workspace/join-requests/${id}/approve`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({}),
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { role: string }).role).toBe('member')
    const again = await app.request(`/api/v1/workspace/join-requests/${id}/approve`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({}),
    })
    expect(again.status).toBe(409)
    const r = await signIn(app, alice.email, alice.password)
    expect(r.res.status).toBe(200)
    // member 不可审批
    const forbidden = await app.request('/api/v1/workspace/join-requests', {
      headers: jsonHeaders({ cookie: r.cookie }),
    })
    expect(forbidden.status).toBe(403)
  })

  it('REQ-AUTH-019 驳回：删号，可用同邮箱重新注册', async () => {
    const bob = { email: 'bob@xz.local', username: 'bob', name: 'Bob', password: 'bob-pass-1' }
    expect((await register(app, bob)).status).toBe(201)
    const [jr] = await db()
      .select({ id: joinRequests.id })
      .from(joinRequests)
      .where(eq(joinRequests.status, 'pending'))
    const res = await app.request(`/api/v1/workspace/join-requests/${jr?.id}/reject`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(res.status).toBe(204)
    expect(await db().select().from(user).where(eq(user.email, bob.email))).toHaveLength(0)
    expect((await register(app, bob)).status).toBe(201)
  })

  it('REQ-AUTH-020 用户名登录（大小写不敏感），同样过拼图', async () => {
    const r = await signInUsername(app, 'OWNER', OWNER.password)
    expect(r.res.status).toBe(200)
    expect(r.setCookie).toMatch(/session_token=/)
    const noCaptcha = await app.request('/api/auth/sign-in/username', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ username: 'owner', password: OWNER.password }),
    })
    expect(noCaptcha.status).toBe(400)
    const bad = await signInUsername(app, 'owner', 'wrong-password')
    expect(bad.res.status).toBe(401)
  })

  it('REQ-AUTH-020 待审批用户用用户名登录同样 403 REGISTRATION_PENDING', async () => {
    const r = await signInUsername(app, 'bob', 'bob-pass-1')
    expect(r.res.status).toBe(403)
    expect((await problemOf(r.res)).code).toBe('REGISTRATION_PENDING')
  })
})

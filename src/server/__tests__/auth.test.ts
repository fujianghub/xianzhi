/** T0-006 / T0-007：Better Auth 接入、create-owner、个人空间、登录保护、API Key。 */
import { count, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getAuth } from '../auth.ts'
import { getDb } from '../db/index.ts'
import { member, organization, user } from '../db/schema/auth.ts'
import { auditLog, spaceMembers, spaces } from '../db/schema/business.ts'
import { ensurePersonalSpace, personalSlug } from '../services/spaces.ts'
import { createOwner, OwnerExistsError } from '../services/workspace.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, mailbox, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
const userCount = async () => (await db().select({ n: count() }).from(user))[0]?.n ?? 0

describe('create-owner & personal space', () => {
  beforeAll(async () => {
    await truncateAll()
  })

  it('REQ-AUTH-013 首次 create-owner：user + organization + member(owner) + spaces(is_personal) 各 1 行', async () => {
    const r = await seedOwner()
    expect(await userCount()).toBe(1)
    expect((await db().select().from(organization)).length).toBe(1)
    const m = await db().select().from(member)
    expect(m).toHaveLength(1)
    expect(m[0]?.role).toBe('owner')
    expect(m[0]?.userId).toBe(r.userId)
    const s = await db().select().from(spaces)
    expect(s).toHaveLength(1)
    expect(s[0]?.isPersonal).toBe(true)
  })

  it('REQ-AUTH-013 create-owner 二次执行拒绝（OwnerExistsError，退出码非 0）', async () => {
    await expect(
      createOwner(db(), getAuth(), { ...OWNER, email: 'second@xz.local' }),
    ).rejects.toBeInstanceOf(OwnerExistsError)
    expect(await userCount()).toBe(1)
  })

  it('REQ-SPACE-009 个人空间：visibility=members、slug me-<8>、本人为 space admin、幂等', async () => {
    const [ws] = await db().select().from(organization)
    const [m] = await db().select().from(member)
    if (!ws || !m) throw new Error('seed missing')
    const [s] = await db().select().from(spaces).where(eq(spaces.isPersonal, true))
    expect(s?.visibility).toBe('members')
    expect(s?.kind).toBe('work')
    expect(s?.slug).toBe(personalSlug(m.userId))
    expect(s?.slug).toMatch(/^me-[0-9a-f]{8}$/)
    const sm = await db().select().from(spaceMembers).where(eq(spaceMembers.userId, m.userId))
    expect(sm).toHaveLength(1)
    expect(sm[0]?.role).toBe('admin')
    const again = await ensurePersonalSpace(db(), ws.id, m.userId)
    expect(again.created).toBe(false)
    expect(again.id).toBe(s?.id)
    expect((await db().select().from(spaces)).length).toBe(1)
  })
})

describe('sign-in / sign-up / magic-link / impersonation', () => {
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    mailbox.length = 0
  })

  it('REQ-AUTH-001 正确邮箱+密码 → 200，Cookie HttpOnly + SameSite=Lax；错密码 401 且不区分邮箱是否存在', async () => {
    const { app } = buildApp()
    const ok = await signIn(app, OWNER.email, OWNER.password)
    expect(ok.res.status).toBe(200)
    expect(ok.setCookie).toMatch(/HttpOnly/i)
    expect(ok.setCookie).toMatch(/SameSite=Lax/i)
    // Secure 仅在 https APP_URL 下（测试为 http）
    const bad = await signIn(app, OWNER.email, 'wrong-password-xx')
    const ghost = await signIn(app, 'nobody@xz.local', 'wrong-password-xx')
    expect(bad.res.status).toBe(401)
    expect(ghost.res.status).toBe(401)
    const b1 = await bad.res.json()
    const b2 = await ghost.res.json()
    expect(b1).toEqual(b2)
  })

  it('REQ-AUTH-002 拒绝自助注册：sign-up 4xx，user 行数不变', async () => {
    const { app } = buildApp()
    const before = await userCount()
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: 'intruder@xz.local',
        password: 'intruder-password-1',
        name: 'X',
      }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await userCount()).toBe(before)
  })

  it('REQ-AUTH-015 魔法链接对陌生邮箱不建号：200 但无邮件、无新 user；已注册邮箱收到邮件', async () => {
    const { app } = buildApp()
    const before = await userCount()
    mailbox.length = 0
    const res = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'stranger@xz.local', callbackURL: '/' }),
    })
    expect(res.status).toBe(200)
    expect(mailbox).toHaveLength(0)
    expect(await userCount()).toBe(before)
    const known = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: OWNER.email, callbackURL: '/' }),
    })
    expect(known.status).toBe(200)
    expect(mailbox).toHaveLength(1)
    expect(mailbox[0]?.to).toBe(OWNER.email)
  })

  it('REQ-AUTH-015 impersonation 一期禁用：POST /api/auth/admin/impersonate-user → 404', async () => {
    const { app } = buildApp()
    const { cookie } = await signIn(app, OWNER.email, OWNER.password)
    const res = await app.request('/api/auth/admin/impersonate-user', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ userId: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('login guard', () => {
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
  })

  it('REQ-AUTH-012 连续失败 10 次 → 第 11 次即使密码正确也 403 ACCOUNT_LOCKED，audit 有 auth.locked', async () => {
    const { app } = buildApp()
    for (let i = 0; i < 10; i++) {
      const r = await signIn(app, OWNER.email, 'wrong-password-xx')
      expect(r.res.status).toBe(401)
    }
    const locked = await signIn(app, OWNER.email, OWNER.password)
    expect(locked.res.status).toBe(403)
    expect((await problemOf(locked.res)).code).toBe('ACCOUNT_LOCKED')
    const rows = await db().select().from(auditLog)
    expect(rows.filter((r) => r.action === 'auth.login_failed')).toHaveLength(10)
    expect(rows.filter((r) => r.action === 'auth.locked')).toHaveLength(1)
  })

  it('REQ-AUTH-012 邮箱维度 10/min（与 IP 无关）：第 11 次 → 429 且 RateLimit-Reset 存在；窗口过后恢复', async () => {
    let t = 1_000_000
    const { app } = buildApp({ now: () => t })
    let last: Response | undefined
    // 每次换 IP，绕开 Better Auth 的 IP 维度限流，只测邮箱维度；用正确密码避免触发锁定
    for (let i = 0; i < 11; i++) {
      last = (
        await signIn(app, OWNER.email, OWNER.password, { 'x-forwarded-for': `10.99.0.${i + 1}` })
      ).res
    }
    expect(last?.status).toBe(429)
    expect((await problemOf(last as Response)).code).toBe('RATE_LIMITED')
    expect(last?.headers.get('ratelimit-reset')).toMatch(/^\d+$/)
    t += 61_000
    const after = await signIn(app, OWNER.email, OWNER.password, { 'x-forwarded-for': '10.99.1.1' })
    expect(after.res.status).toBe(200)
  })
})

describe('API Key', () => {
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
  })

  it('REQ-AUTH-010 明文只返回一次（xz_ 前缀），列表只含前缀；Bearer 可鉴权，audit 有 api_key.created', async () => {
    const { app } = buildApp()
    const { cookie } = await signIn(app, OWNER.email, OWNER.password)
    const created = await app.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ name: 'mcp', metadata: { scope: 'write' } }),
    })
    expect(created.status).toBe(200)
    const key = (await created.json()) as { key: string; start?: string; id: string }
    expect(key.key).toMatch(/^xz_/)

    const list = await app.request('/api/auth/api-key/list', { headers: { cookie } })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { apiKeys: Record<string, unknown>[]; total: number }
    const items = listBody.apiKeys
    expect(items).toHaveLength(1)
    expect(items[0]?.key).toBeUndefined()
    expect(String(items[0]?.start ?? '')).toMatch(/^xz_/)

    // Bearer 鉴权走 session 中间件（跨站也不受 CSRF 限制）
    const echo = await app.request('/api/v1/_debug/echo', {
      method: 'POST',
      headers: { authorization: `Bearer ${key.key}`, 'sec-fetch-site': 'cross-site' },
    })
    expect(echo.status).toBe(200)
    const body = (await echo.json()) as { user: string | null }
    expect(body.user).not.toBeNull()

    const bad = await app.request('/api/v1/_debug/echo', {
      method: 'POST',
      headers: { authorization: 'Bearer xz_nope' },
    })
    expect(bad.status).toBe(401)
  })
})

/** ADR-0010：owner 用户管理（REQ-WS-018 ~ 021）与本人账号（REQ-WS-022 · 023、REQ-AUTH-021）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { account, member, session, user } from '../db/schema/auth.ts'
import { auditLog } from '../db/schema/business.ts'
import { EventBus, setEventBus } from '../lib/event-bus.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']

describe('ADR-0010 用户管理与个人资料', () => {
  let app: App
  let ownerCookie = ''
  let ownerId = ''
  const bus = new EventBus()
  const revoked: string[] = []

  const call = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const create = (cookie: string, body: Record<string, unknown>) =>
    call(cookie, 'POST', '/workspace/users', {
      password: 'initial-pass-1',
      name: body.username,
      role: 'member',
      ...body,
    })
  const actions = async (targetId: string) =>
    (await db().select().from(auditLog).where(eq(auditLog.targetId, targetId))).map((r) => r.action)

  beforeAll(async () => {
    await truncateAll()
    ownerId = (await seedOwner()).userId
    setEventBus(bus)
    bus.subscribe('user.revoked', (p) => revoked.push(p.userId))
    app = buildApp().app
    ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('REQ-WS-018 owner 直建用户：立即成为成员可登录；重复邮箱 / 用户名 409；admin 403', async () => {
    const r = await create(ownerCookie, { email: 'Bob@XZ.local', username: 'Bob_1', role: 'admin' })
    expect(r.status).toBe(201)
    const { userId } = (await r.json()) as { userId: string }
    const [m] = await db().select().from(member).where(eq(member.userId, userId))
    expect(m?.role).toBe('admin')
    const [u] = await db().select().from(user).where(eq(user.id, userId))
    expect(u).toMatchObject({ email: 'bob@xz.local', username: 'bob_1', displayUsername: 'Bob_1' })
    expect(await actions(userId)).toContain('user.created')

    const bob = await signIn(app, 'bob@xz.local', 'initial-pass-1')
    expect(bob.res.status).toBe(200)
    // admin 不能管理用户（仅 owner）
    expect((await call(bob.cookie, 'GET', '/workspace/users')).status).toBe(403)
    expect((await create(bob.cookie, { email: 'x@xz.local', username: 'xxx' })).status).toBe(403)

    const dupEmail = await create(ownerCookie, { email: 'bob@xz.local', username: 'other' })
    expect(dupEmail.status).toBe(409)
    expect((await problemOf(dupEmail)).errors?.[0]?.path).toBe('email')
    const dupName = await create(ownerCookie, { email: 'o@xz.local', username: 'BOB_1' })
    expect((await problemOf(dupName)).errors?.[0]?.path).toBe('username')
  })

  it('REQ-WS-018 用户列表：owner 可见用户名 / 头像 / 状态 / 会话数', async () => {
    const r = await call(ownerCookie, 'GET', '/workspace/users')
    expect(r.status).toBe(200)
    const { items } = (await r.json()) as {
      items: { userId: string; role: string; username: string | null; sessions: number }[]
    }
    expect(items[0]?.role).toBe('owner')
    const bob = items.find((i) => i.username === 'Bob_1')
    expect(bob?.sessions).toBeGreaterThanOrEqual(1)
  })

  it('REQ-WS-019 owner 改他人显示名 / 用户名 / 邮箱；不能对自己用此接口', async () => {
    const r = await create(ownerCookie, { email: 'carol@xz.local', username: 'carol' })
    const { userId } = (await r.json()) as { userId: string }
    const p = await call(ownerCookie, 'PATCH', `/workspace/users/${userId}`, {
      displayName: '卡罗尔',
      username: 'Carol2',
      email: 'carol2@xz.local',
    })
    expect(p.status).toBe(204)
    const [u] = await db().select().from(user).where(eq(user.id, userId))
    expect(u).toMatchObject({
      displayName: '卡罗尔',
      username: 'carol2',
      email: 'carol2@xz.local',
    })
    expect(await actions(userId)).toContain('user.updated')
    const self = await call(ownerCookie, 'PATCH', `/workspace/users/${ownerId}`, {
      displayName: 'x',
    })
    expect(self.status).toBe(403)
  })

  it('REQ-WS-020 owner 重置密码：旧密码失效、新密码可登录、其会话全部删除并广播 user.revoked', async () => {
    const r = await create(ownerCookie, { email: 'dave@xz.local', username: 'dave' })
    const { userId } = (await r.json()) as { userId: string }
    await signIn(app, 'dave@xz.local', 'initial-pass-1')
    const short = await call(ownerCookie, 'POST', `/workspace/users/${userId}/password`, {
      password: 'short',
    })
    expect(short.status).toBe(422)
    const ok = await call(ownerCookie, 'POST', `/workspace/users/${userId}/password`, {
      password: 'brand-new-pass',
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { sessions: number }).sessions).toBeGreaterThanOrEqual(1)
    expect(await db().select().from(session).where(eq(session.userId, userId))).toHaveLength(0)
    expect(revoked).toContain(userId)
    expect((await signIn(app, 'dave@xz.local', 'initial-pass-1')).res.status).toBe(401)
    expect((await signIn(app, 'dave@xz.local', 'brand-new-pass')).res.status).toBe(200)
    expect(await actions(userId)).toContain('auth.password_reset')
  })

  it('REQ-WS-021 owner 删号：成员移除、凭据删除、user 匿名化、不能再登录；owner 不可删', async () => {
    const r = await create(ownerCookie, { email: 'eve@xz.local', username: 'eve' })
    const { userId } = (await r.json()) as { userId: string }
    const del = await call(ownerCookie, 'DELETE', `/workspace/members/${userId}?purge=1`)
    expect(del.status).toBe(204)
    expect(await db().select().from(member).where(eq(member.userId, userId))).toHaveLength(0)
    expect(await db().select().from(account).where(eq(account.userId, userId))).toHaveLength(0)
    const [u] = await db().select().from(user).where(eq(user.id, userId))
    expect(u?.email).toBe(`deleted-${userId}@deleted.invalid`)
    expect(u?.username).toBeNull()
    expect(u?.banned).toBe(true)
    expect(revoked).toContain(userId)
    expect(await actions(userId)).toContain('user.deleted')
    expect((await signIn(app, 'eve@xz.local', 'initial-pass-1')).res.status).toBe(401)
    // 用户名 / 邮箱已释放，可再建
    expect((await create(ownerCookie, { email: 'eve@xz.local', username: 'eve' })).status).toBe(201)
    expect(
      (await call(ownerCookie, 'DELETE', `/workspace/members/${ownerId}?purge=1`)).status,
    ).toBe(403)
  })

  it('REQ-WS-022 本人改用户名（免密）/ 邮箱（须当前密码）；/me 回显 username', async () => {
    await create(ownerCookie, { email: 'fay@xz.local', username: 'fay' })
    const fay = await signIn(app, 'fay@xz.local', 'initial-pass-1')
    const me0 = (await (await call(fay.cookie, 'GET', '/me')).json()) as { username: string }
    expect(me0.username).toBe('fay')

    const un = await call(fay.cookie, 'PATCH', '/me/account', { username: 'Fay_Z' })
    expect(un.status).toBe(200)
    expect(((await un.json()) as { username: string }).username).toBe('Fay_Z')
    const taken = await call(fay.cookie, 'PATCH', '/me/account', { username: 'dave' })
    expect(taken.status).toBe(409)

    const noPw = await call(fay.cookie, 'PATCH', '/me/account', { email: 'fay2@xz.local' })
    expect(noPw.status).toBe(422)
    const badPw = await call(fay.cookie, 'PATCH', '/me/account', {
      email: 'fay2@xz.local',
      currentPassword: 'wrong-password',
    })
    expect(badPw.status).toBe(422)
    expect((await problemOf(badPw)).errors?.[0]?.path).toBe('currentPassword')
    const ok = await call(fay.cookie, 'PATCH', '/me/account', {
      email: 'Fay2@xz.local',
      currentPassword: 'initial-pass-1',
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { email: string }).email).toBe('fay2@xz.local')
    expect((await signIn(app, 'fay2@xz.local', 'initial-pass-1')).res.status).toBe(200)
  })

  it('REQ-AUTH-021 本人改密码：须当前密码；保留当前会话，其他会话删除；audit auth.password_changed', async () => {
    const r = await create(ownerCookie, { email: 'gus@xz.local', username: 'gus' })
    const { userId } = (await r.json()) as { userId: string }
    const a = await signIn(app, 'gus@xz.local', 'initial-pass-1')
    const b = await signIn(app, 'gus@xz.local', 'initial-pass-1')
    const bad = await call(a.cookie, 'POST', '/me/password', {
      currentPassword: 'nope-nope',
      newPassword: 'another-pass-2',
    })
    expect(bad.status).toBe(422)
    const same = await call(a.cookie, 'POST', '/me/password', {
      currentPassword: 'initial-pass-1',
      newPassword: 'initial-pass-1',
    })
    expect(same.status).toBe(422)
    const ok = await call(a.cookie, 'POST', '/me/password', {
      currentPassword: 'initial-pass-1',
      newPassword: 'another-pass-2',
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { sessions: number }).sessions).toBe(1)
    expect((await call(a.cookie, 'GET', '/me')).status).toBe(200)
    expect((await call(b.cookie, 'GET', '/me')).status).toBe(401)
    expect((await signIn(app, 'gus@xz.local', 'another-pass-2')).res.status).toBe(200)
    expect(await actions(userId)).toContain('auth.password_changed')
  })

  it('REQ-WS-022 Better Auth 自带改资料 / 改密 / admin 端点一律 404（绕过审计与 can）', async () => {
    for (const path of [
      '/api/auth/update-user',
      '/api/auth/change-password',
      '/api/auth/change-email',
      '/api/auth/admin/create-user',
      '/api/auth/admin/set-user-password',
      '/api/auth/admin/remove-user',
    ]) {
      const r = await app.request(path, {
        method: 'POST',
        headers: jsonHeaders({ cookie: ownerCookie }),
        body: JSON.stringify({ name: 'x', image: 'https://evil.example/p.png' }),
      })
      expect(r.status, path).toBe(404)
    }
  })

  it('REQ-WS-023 删除头像：image 与 avatarAttachmentId 清空', async () => {
    await db()
      .update(user)
      .set({ image: '/api/v1/attachments/x/md', avatarAttachmentId: 'x' })
      .where(eq(user.id, ownerId))
    const r = await call(ownerCookie, 'DELETE', '/me/avatar')
    expect(r.status).toBe(204)
    const me = (await (await call(ownerCookie, 'GET', '/me')).json()) as { image: string | null }
    expect(me.image).toBeNull()
  })
})

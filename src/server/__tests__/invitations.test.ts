/** T0-010 邀请流程：REQ-AUTH-003 · 004 · 005（api 层）。 */
import { and, eq, gt } from 'drizzle-orm'
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { invitation, member, organization, user } from '../db/schema/auth.ts'
import { auditLog, events, spaces } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, mailbox, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
const INVITEE = { email: 'alice@xz.local', name: 'Alice', password: 'alice-password-123' }

describe('invitations', () => {
  let ownerCookie = ''
  let inviteId = ''
  let app: ReturnType<typeof buildApp>['app']

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    mailbox.length = 0
    app = buildApp().app
    ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('REQ-AUTH-003 admin 创建邀请 → 201，邮件含一次性链接，audit member.invited', async () => {
    const res = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ email: INVITEE.email, role: 'member' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      email: string
      role: string
      status: string
      expiresAt: string
    }
    inviteId = body.id
    expect(body.status).toBe('pending')
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000)
    expect(mailbox).toHaveLength(1)
    expect(mailbox[0]?.to).toBe(INVITEE.email)
    expect(mailbox[0]?.text).toContain(`/invite/${inviteId}`)
    expect(mailbox[0]?.html).toContain(`/invite/${inviteId}`)
    expect(mailbox[0]?.html).toContain('接受邀请')
    const a = await db().select().from(auditLog).where(eq(auditLog.action, 'member.invited'))
    expect(a).toHaveLength(1)
    // 列表可见
    const list = await app.request('/api/v1/workspace/invitations', {
      headers: { cookie: ownerCookie },
    })
    const items = ((await list.json()) as { items: { id: string }[] }).items
    expect(items.map((i) => i.id)).toEqual([inviteId])
  })

  it('REQ-AUTH-003 校验：非法邮箱 / 非法角色 → 422 errors[].path', async () => {
    const res = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ email: 'not-an-email', role: 'owner' }),
    })
    expect(res.status).toBe(422)
    const p = await problemOf(res)
    expect(p.code).toBe('VALIDATION')
    expect(p.errors?.map((e) => e.path).sort()).toEqual(['email', 'role'])
  })

  it('REQ-AUTH-003 公开查看邀请：邮箱脱敏、角色、工作区名', async () => {
    const res = await app.request(`/api/v1/workspace/invitations/${inviteId}`)
    expect(res.status).toBe(200)
    const b = (await res.json()) as {
      email: string
      role: string
      workspaceName: string
      inviterName: string
    }
    expect(b.email).toBe('al***@xz.local')
    expect(b.role).toBe('member')
    expect(b.workspaceName).toBe('衔枝')
    expect(b.inviterName).toBe('Owner')
  })

  it('REQ-AUTH-003 邮箱不匹配 → 403；匹配 → 201 建号、member.role=member、个人空间、可登录、events member.joined', async () => {
    const wrong = await app.request(`/api/v1/workspace/invitations/${inviteId}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...INVITEE, email: 'mallory@xz.local' }),
    })
    expect(wrong.status).toBe(403)
    expect((await problemOf(wrong)).code).toBe('FORBIDDEN')

    const ok = await app.request(`/api/v1/workspace/invitations/${inviteId}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...INVITEE, email: 'Alice@XZ.local' }), // 大小写不敏感
    })
    expect(ok.status).toBe(201)
    const { userId } = (await ok.json()) as { userId: string }
    const [m] = await db().select().from(member).where(eq(member.userId, userId))
    expect(m?.role).toBe('member')
    const ps = await db()
      .select()
      .from(spaces)
      .where(and(eq(spaces.createdBy, userId), eq(spaces.isPersonal, true)))
    expect(ps).toHaveLength(1)
    const [inv] = await db().select().from(invitation).where(eq(invitation.id, inviteId))
    expect(inv?.status).toBe('accepted')
    const ev = await db().select().from(events).where(eq(events.kind, 'member.joined'))
    expect(ev).toHaveLength(1)
    expect((ev[0]?.payload as { email?: string } | undefined)?.email).toBe(INVITEE.email)
    const joined = await db().select().from(auditLog).where(eq(auditLog.action, 'member.joined'))
    expect(joined.some((r) => r.actorId === userId)).toBe(true)

    const login = await signIn(app, INVITEE.email, INVITEE.password)
    expect(login.res.status).toBe(200)
    const me = await app.request('/api/v1/_debug/echo', {
      method: 'POST',
      headers: jsonHeaders({ cookie: login.cookie }),
    })
    expect(((await me.json()) as { user: string }).user).toBe(userId)
  })

  it('REQ-AUTH-004 已接受的邀请再次打开 / 再次接受 → 410 INVITATION_EXPIRED，user 行数不变', async () => {
    const before = (await db().select().from(user)).length
    const get = await app.request(`/api/v1/workspace/invitations/${inviteId}`)
    expect(get.status).toBe(410)
    expect(await problemOf(get)).toMatchObject({ code: 'INVITATION_EXPIRED', reason: 'used' })
    const again = await app.request(`/api/v1/workspace/invitations/${inviteId}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(INVITEE),
    })
    expect(again.status).toBe(410)
    expect((await db().select().from(user)).length).toBe(before)
  })

  it('REQ-AUTH-005 member 创建邀请 → 403 FORBIDDEN；member 列表 → 403', async () => {
    const { cookie } = await signIn(app, INVITEE.email, INVITEE.password)
    const res = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ email: 'bob@xz.local', role: 'member' }),
    })
    expect(res.status).toBe(403)
    expect((await problemOf(res)).code).toBe('FORBIDDEN')
    const list = await app.request('/api/v1/workspace/invitations', { headers: { cookie } })
    expect(list.status).toBe(403)
  })

  it('REQ-AUTH-003 过期邀请打开 → 410；撤回 → 204 且再打开 410；不存在 → 404', async () => {
    const create = async (email: string) => {
      const r = await app.request('/api/v1/workspace/invitations', {
        method: 'POST',
        headers: jsonHeaders({ cookie: ownerCookie }),
        body: JSON.stringify({ email, role: 'guest' }),
      })
      return ((await r.json()) as { id: string }).id
    }
    const expiredId = await create('old@xz.local')
    await db()
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, expiredId))
    const e = await app.request(`/api/v1/workspace/invitations/${expiredId}`)
    expect(e.status).toBe(410)
    const acc = await app.request(`/api/v1/workspace/invitations/${expiredId}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'old@xz.local', name: 'Old', password: 'old-password-1234' }),
    })
    expect(acc.status).toBe(410)

    const cancelId = await create('cancel@xz.local')
    const del = await app.request(`/api/v1/workspace/invitations/${cancelId}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(del.status).toBe(204)
    expect((await app.request(`/api/v1/workspace/invitations/${cancelId}`)).status).toBe(410)
    expect((await app.request(`/api/v1/workspace/invitations/${v7()}`)).status).toBe(404)
  })

  it('REQ-AUTH-003 重复邀请同邮箱：旧邀请作废只留一条待接受；已是成员 → 409', async () => {
    const mk = () =>
      app.request('/api/v1/workspace/invitations', {
        method: 'POST',
        headers: jsonHeaders({ cookie: ownerCookie }),
        body: JSON.stringify({ email: 'twice@xz.local', role: 'member' }),
      })
    await mk()
    const second = await mk()
    expect(second.status).toBe(201)
    const pending = await db()
      .select()
      .from(invitation)
      .where(and(eq(invitation.email, 'twice@xz.local'), eq(invitation.status, 'pending')))
    expect(pending).toHaveLength(1)
    const dup = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ email: INVITEE.email, role: 'member' }),
    })
    expect(dup.status).toBe(409)
    expect((await problemOf(dup)).code).toBe('CONFLICT_UNIQUE')
  })

  it('REQ-AUTH-003 成员数（含待接受）达 50 → 422', async () => {
    const [ws] = await db().select().from(organization)
    const [owner] = await db().select().from(member).where(eq(member.role, 'owner'))
    if (!ws || !owner) throw new Error('seed missing')
    const now = await db().select().from(member)
    const pend = await db()
      .select()
      .from(invitation)
      .where(and(eq(invitation.status, 'pending'), gt(invitation.expiresAt, new Date())))
    const need = 50 - now.length - pend.length
    await db()
      .insert(invitation)
      .values(
        Array.from({ length: need }, (_, i) => ({
          id: v7(),
          organizationId: ws.id,
          email: `bulk${i}@xz.local`,
          role: 'member',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date(),
          inviterId: owner.userId,
        })),
      )
    const res = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ email: 'no51@xz.local', role: 'member' }),
    })
    expect(res.status).toBe(422)
    expect((await problemOf(res)).errors?.[0]?.path).toBe('email')
  })
})

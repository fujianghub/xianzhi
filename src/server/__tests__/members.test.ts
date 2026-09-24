/** T0-011：工作区信息、成员管理、owner 转让、审计日志。 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS } from '../../shared/schemas/enums.ts'
import { getDb } from '../db/index.ts'
import { apikey, member, organization, session, user } from '../db/schema/auth.ts'
import { auditLog, events, spaces, tasks } from '../db/schema/business.ts'
import { EventBus, setEventBus } from '../lib/event-bus.ts'
import { audit } from '../services/audit.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']

/** 经邀请流程建一个成员，返回其 userId 与登录 Cookie。 */
async function inviteAndJoin(
  app: App,
  ownerCookie: string,
  email: string,
  role: 'admin' | 'member' | 'guest',
  password = 'member-password-123',
) {
  const inv = await app.request('/api/v1/workspace/invitations', {
    method: 'POST',
    headers: jsonHeaders({ cookie: ownerCookie }),
    body: JSON.stringify({ email, role }),
  })
  const { id } = (await inv.json()) as { id: string }
  const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, name: email.split('@')[0], password }),
  })
  const { userId } = (await acc.json()) as { userId: string }
  const { cookie } = await signIn(app, email, password)
  return { userId, cookie, password }
}

describe('workspace & members', () => {
  let app: App
  let ownerCookie = ''
  let ownerId = ''
  let workspaceId = ''
  const bus = new EventBus()
  const revoked: string[] = []

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    ownerId = r.userId
    workspaceId = r.workspaceId
    setEventBus(bus)
    bus.subscribe('user.revoked', (p) => revoked.push(p.userId))
    app = buildApp().app
    ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('REQ-WS-001 member 可读工作区；PATCH member 403 / admin 200 且 audit workspace.settings_changed', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'reader@xz.local', 'member')
    const get = await app.request('/api/v1/workspace', { headers: { cookie: m.cookie } })
    expect(get.status).toBe(200)
    const ws = (await get.json()) as {
      name: string
      slug: string
      memberCount: number
      settings: Record<string, unknown>
    }
    expect(ws.name).toBe('衔枝')
    expect(ws.memberCount).toBe(2)
    const deny = await app.request('/api/v1/workspace', {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: m.cookie }),
      body: JSON.stringify({ name: 'X' }),
    })
    expect(deny.status).toBe(403)
    const ok = await app.request('/api/v1/workspace', {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ name: '衔枝 · 实验', settings: { weekStartsOn: 1 } }),
    })
    expect(ok.status).toBe(200)
    expect(
      ((await ok.json()) as { name: string; settings: { weekStartsOn: number } }).settings
        .weekStartsOn,
    ).toBe(1)
    const rows = await db()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'workspace.settings_changed'))
    expect(rows).toHaveLength(1)
  })

  it('REQ-WS-002 改角色 → 200，audit member.role_changed，下一次请求按新角色判定', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'promote@xz.local', 'member')
    const before = await app.request('/api/v1/workspace/invitations', {
      headers: { cookie: m.cookie },
    })
    expect(before.status).toBe(403)
    const res = await app.request(`/api/v1/workspace/members/${m.userId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { role: string }).role).toBe('admin')
    const after = await app.request('/api/v1/workspace/invitations', {
      headers: { cookie: m.cookie },
    })
    expect(after.status).toBe(200) // 同一 Cookie，新角色即时生效
    const rows = await db()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'member.role_changed'))
    expect(rows.at(-1)?.meta).toEqual({ from: 'member', to: 'admin' })
    // role=owner 不可经 PATCH 设置
    const bad = await app.request(`/api/v1/workspace/members/${m.userId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(bad.status).toBe(422)
    // 列表含 status
    const list = await app.request('/api/v1/workspace/members', { headers: { cookie: m.cookie } })
    const items = (
      (await list.json()) as { items: { userId: string; role: string; status: string }[] }
    ).items
    expect(items.find((i) => i.userId === m.userId)).toMatchObject({
      role: 'admin',
      status: 'active',
    })
  })

  it('REQ-WS-003 唯一 owner 降级 / 移除 → 409 CONFLICT_LAST_OWNER；admin 不能动 owner', async () => {
    const adm = await inviteAndJoin(app, ownerCookie, 'adm@xz.local', 'admin')
    const demote = await app.request(`/api/v1/workspace/members/${ownerId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: adm.cookie }),
      body: JSON.stringify({ role: 'member' }),
    })
    expect(demote.status).toBe(403) // admin 不能操作 owner
    const selfDemote = await app.request(`/api/v1/workspace/members/${ownerId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(selfDemote.status).toBe(409)
    expect((await problemOf(selfDemote)).code).toBe('CONFLICT_LAST_OWNER')
    const leave = await app.request('/api/v1/workspace/members/me', {
      method: 'DELETE',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(leave.status).toBe(409)
  })

  it('REQ-WS-003 owner 转让：双方角色互换，events workspace.owner_transferred，audit 一行；member 调用 403', async () => {
    const to = await inviteAndJoin(app, ownerCookie, 'heir@xz.local', 'member')
    const deny = await app.request('/api/v1/workspace/owner-transfer', {
      method: 'POST',
      headers: jsonHeaders({ cookie: to.cookie }),
      body: JSON.stringify({ toUserId: ownerId }),
    })
    expect(deny.status).toBe(403)
    const ok = await app.request('/api/v1/workspace/owner-transfer', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ toUserId: to.userId }),
    })
    expect(ok.status).toBe(204)
    const roles = Object.fromEntries(
      (await db().select().from(member)).map((m) => [m.userId, m.role]),
    )
    expect(roles[to.userId]).toBe('owner')
    expect(roles[ownerId]).toBe('admin')
    const ev = await db()
      .select()
      .from(events)
      .where(eq(events.kind, 'workspace.owner_transferred'))
    expect(ev).toHaveLength(1)
    expect(ev[0]?.payload).toMatchObject({ fromUserId: ownerId, toUserId: to.userId })
    // 转回来，后续用例仍以 OWNER 为 owner
    const back = await app.request('/api/v1/workspace/owner-transfer', {
      method: 'POST',
      headers: jsonHeaders({ cookie: to.cookie }),
      body: JSON.stringify({ toUserId: ownerId }),
    })
    expect(back.status).toBe(204)
  })

  it('REQ-WS-004 · 012 · 013 · REQ-AUTH-014 移除成员：旧 Cookie 与 Key 401、user.revoked 广播、未完成任务置空 + task.unassigned、内容保留、audit member.removed', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'leaver@xz.local', 'member')
    // 自己建一个 API Key
    const keyRes = await app.request('/api/v1/me/keys', {
      method: 'POST',
      headers: jsonHeaders({ cookie: m.cookie }),
      body: JSON.stringify({ name: 'k', scope: 'read' }),
    })
    expect(keyRes.status).toBe(201)
    const { key } = (await keyRes.json()) as { key: string }
    // 2 个未完成 + 1 个已完成任务指派给他，落其个人空间
    const [ps] = await db()
      .select()
      .from(spaces)
      .where(and(eq(spaces.createdBy, m.userId), eq(spaces.isPersonal, true)))
    if (!ps) throw new Error('personal space missing')
    const mk = (status: string) => ({
      id: v7(),
      workspaceId,
      spaceId: ps.id,
      title: `t-${status}`,
      status,
      assigneeId: m.userId,
      creatorId: m.userId,
      sortKey: 'a0',
    })
    await db()
      .insert(tasks)
      .values([mk('todo'), mk('doing'), mk('done')])
    revoked.length = 0

    const del = await app.request(`/api/v1/workspace/members/${m.userId}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(del.status).toBe(204)
    expect(revoked).toEqual([m.userId])
    expect((await app.request('/api/v1/me', { headers: { cookie: m.cookie } })).status).toBe(401)
    expect(
      (await app.request('/api/v1/me', { headers: { authorization: `Bearer ${key}` } })).status,
    ).toBe(401)
    expect(await db().select().from(session).where(eq(session.userId, m.userId))).toHaveLength(0)
    const keys = await db().select().from(apikey).where(eq(apikey.referenceId, m.userId))
    expect(keys.every((k) => k.enabled === false)).toBe(true)
    const t = await db().select().from(tasks).where(eq(tasks.creatorId, m.userId))
    expect(t.filter((x) => x.status !== 'done').every((x) => x.assigneeId === null)).toBe(true)
    expect(t.find((x) => x.status === 'done')?.assigneeId).toBe(m.userId)
    expect(t.every((x) => x.creatorId === m.userId)).toBe(true) // 内容保留、创建者不变
    const ev = await db().select().from(events).where(eq(events.kind, 'task.unassigned'))
    expect(ev).toHaveLength(2)
    expect(ev[0]?.payload).toMatchObject({ prevAssigneeId: m.userId, reason: 'member_removed' })
    const a = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'member.removed'), eq(auditLog.targetId, m.userId)))
    expect(a).toHaveLength(1)
    // 再登录：账号还在但已不是成员 → 会话中间件视为未登录
    const again = await signIn(app, 'leaver@xz.local', m.password)
    expect((await app.request('/api/v1/me', { headers: { cookie: again.cookie } })).status).toBe(
      401,
    )
  })

  it('REQ-WS-014 停用 / 恢复：停用后 401 且广播；恢复后可重新登录', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'sus@xz.local', 'member')
    revoked.length = 0
    const s = await app.request(`/api/v1/workspace/members/${m.userId}/suspend`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(s.status).toBe(204)
    expect(revoked).toEqual([m.userId])
    expect((await app.request('/api/v1/me', { headers: { cookie: m.cookie } })).status).toBe(401)
    const list = await app.request('/api/v1/workspace/members', {
      headers: { cookie: ownerCookie },
    })
    const row = ((await list.json()) as { items: { userId: string; status: string }[] }).items.find(
      (i) => i.userId === m.userId,
    )
    expect(row?.status).toBe('suspended')
    const relogin = await signIn(app, 'sus@xz.local', m.password)
    expect(relogin.res.status).not.toBe(200)
    const u = await app.request(`/api/v1/workspace/members/${m.userId}/unsuspend`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(u.status).toBe(204)
    const ok = await signIn(app, 'sus@xz.local', m.password)
    expect(ok.res.status).toBe(200)
    expect((await app.request('/api/v1/me', { headers: { cookie: ok.cookie } })).status).toBe(200)
  })

  it('REQ-AUTH-009 admin 吊销会话后旧 Cookie 401；member 调用 403', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'rev@xz.local', 'member')
    const deny = await app.request(`/api/v1/workspace/members/${ownerId}/revoke-sessions`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: m.cookie }),
    })
    expect(deny.status).toBe(403)
    revoked.length = 0
    const res = await app.request(`/api/v1/workspace/members/${m.userId}/revoke-sessions`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { sessions: number }).sessions).toBeGreaterThanOrEqual(1)
    expect(revoked).toEqual([m.userId])
    expect((await app.request('/api/v1/me', { headers: { cookie: m.cookie } })).status).toBe(401)
    expect((await signIn(app, 'rev@xz.local', m.password)).res.status).toBe(200) // 可重新登录
  })

  it('REQ-WS-005 审计日志：admin 游标分页无重复无遗漏、筛选 action；member 403；limit>200 → 422', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'auditor@xz.local', 'member')
    expect(
      (await app.request('/api/v1/workspace/audit-log', { headers: { cookie: m.cookie } })).status,
    ).toBe(403)
    expect(
      (
        await app.request('/api/v1/workspace/audit-log?limit=201', {
          headers: { cookie: ownerCookie },
        })
      ).status,
    ).toBe(422)
    const all: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const url = `/api/v1/workspace/audit-log?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const res = await app.request(url, { headers: { cookie: ownerCookie } })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        items: { id: string; createdAt: string }[]
        nextCursor: string | null
      }
      all.push(...body.items.map((i) => i.id))
      cursor = body.nextCursor
      pages++
    } while (cursor && pages < 100)
    const total = (await db().select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId)))
      .length
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBe(total)
    const f = await app.request('/api/v1/workspace/audit-log?action=member.joined', {
      headers: { cookie: ownerCookie },
    })
    const items = ((await f.json()) as { items: { action: string }[] }).items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.action === 'member.joined')).toBe(true)
  })

  it('REQ-WS-006 登录 / 登出 / 失败 / 权限变更 / 移除 / Key 变更 / 设置变更各有 audit 行；无 UPDATE/DELETE 端点', async () => {
    const m = await inviteAndJoin(app, ownerCookie, 'logout@xz.local', 'member')
    expect((await signIn(app, 'logout@xz.local', 'wrong-password-000')).res.status).toBe(401)
    const out = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: jsonHeaders({ cookie: m.cookie }),
    })
    expect(out.status).toBe(200)
    const actions = new Set(
      (await db().select({ a: auditLog.action }).from(auditLog)).map((r) => r.a),
    )
    for (const a of [
      'auth.login',
      'auth.logout',
      'auth.login_failed',
      'member.invited',
      'member.joined',
      'member.role_changed',
      'member.removed',
      'member.suspended',
      'member.unsuspended',
      'workspace.owner_transferred',
      'workspace.settings_changed',
      'api_key.created',
    ]) {
      expect(actions.has(a), a).toBe(true)
    }
    const routes = app.routes.filter((r) => r.path.includes('audit-log'))
    expect([...new Set(routes.map((r) => r.method))]).toEqual(['GET'])
  })

  it('REQ-WS-017 代码中所有 audit() 的 action 均属 01 §3.12 枚举；写入非枚举值抛错', async () => {
    const root = new URL('../', import.meta.url).pathname
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e) && !p.includes('__tests__')) files.push(p)
      }
    }
    walk(root)
    const found = new Set<string>()
    for (const f of files)
      for (const m of readFileSync(f, 'utf8').matchAll(/action:\s*'([a-z0-9_.]+)'/g))
        found.add(m[1] ?? '')
    expect(found.size).toBeGreaterThan(10)
    for (const a of found) expect(AUDIT_ACTIONS, a).toContain(a)
    // biome-ignore lint/suspicious/noExplicitAny: 故意传非法值
    await expect(audit(db(), { action: 'nope.invalid' as any })).rejects.toThrow()
    const [ws] = await db().select().from(organization)
    expect(ws).toBeDefined()
    const [u] = await db().select().from(user).limit(1)
    expect(u).toBeDefined()
  })

  // Phase 2 顺延（tasks/phase-1.md T1-039）：测试名占位，实现随 Phase 2
  it.todo(
    'REQ-WS-015 注销账号：DELETE /me 匿名化 user、删会话与 Key、内容保留、audit user.deleted（Phase 2）',
  )
  it.todo('REQ-WS-016 批量转移作者：POST /workspace/members/:userId/transfer-content（Phase 2）')
})

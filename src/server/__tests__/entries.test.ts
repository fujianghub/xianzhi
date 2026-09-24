/** T0-013：entries 最小 CRUD（REQ-ENTRY-001 · 003 · 004 · 007）、REQ-WS-008 不可见 404 / 无权 403。 */
import { and, eq } from 'drizzle-orm'
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { auditLog, entries, spaces } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']

async function join(
  app: App,
  ownerCookie: string,
  email: string,
  role: 'admin' | 'member' | 'guest',
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
    body: JSON.stringify({ email, name: email.split('@')[0], password: 'member-password-123' }),
  })
  const { userId } = (await acc.json()) as { userId: string }
  return { userId, cookie: (await signIn(app, email, 'member-password-123')).cookie }
}

describe('entries', () => {
  let app: App
  let ownerCookie = ''
  let member: { userId: string; cookie: string }
  let guest: { userId: string; cookie: string }
  let workspaceId = ''
  let sharedSpaceId = ''

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp().app
    ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    member = await join(app, ownerCookie, 'writer@xz.local', 'member')
    guest = await join(app, ownerCookie, 'guest@xz.local', 'guest')
    // 一个 visibility=workspace 的共享空间（spaces 路由在 Phase 1，先直插）
    sharedSpaceId = v7()
    await db().insert(spaces).values({
      id: sharedSpaceId,
      workspaceId,
      name: '共享',
      slug: 'shared',
      kind: 'project',
      visibility: 'workspace',
      sortKey: 'a1',
      createdBy: r.userId,
    })
  })

  const post = (cookie: string, body: unknown) =>
    app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify(body),
    })

  it('REQ-ENTRY-001 创建 201 返回 id，ydoc 为空文档，缺省落个人空间；fields 非法 422 path=fields.severity；kind 非法 422', async () => {
    const res = await post(member.cookie, {
      kind: 'bug',
      title: '登录报错',
      fields: { severity: 'high', status: 'open' },
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const [row] = await db().select().from(entries).where(eq(entries.id, id))
    expect(row?.ydoc.length).toBeGreaterThan(0)
    expect(row?.ydoc.length).toBeLessThan(20) // 空 Y.Doc 的 update 很小
    const [ps] = await db()
      .select()
      .from(spaces)
      .where(and(eq(spaces.createdBy, member.userId), eq(spaces.isPersonal, true)))
    expect(row?.spaceId).toBe(ps?.id)
    expect(row?.visibility).toBe('private') // 个人空间缺省 private（REQ-ENTRY-003，注 2026-09-24）

    const bad = await post(member.cookie, { kind: 'bug', title: 'x', fields: { severity: 'x' } })
    expect(bad.status).toBe(422)
    const p = await problemOf(bad)
    expect(p.code).toBe('VALIDATION')
    expect(p.errors?.map((e) => e.path)).toContain('fields.severity')
    expect((await post(member.cookie, { kind: 'todo', title: 'x' })).status).toBe(422)
  })

  it('REQ-ENTRY-003 详情不含 ydoc；?withBody=1 才有 pmJson；列表不返回正文列且带 excerpt', async () => {
    const created = await post(member.cookie, {
      kind: 'note',
      title: '随笔一',
      spaceId: sharedSpaceId,
      visibility: 'workspace',
    })
    const { id } = (await created.json()) as { id: string }
    const d = await app.request(`/api/v1/entries/${id}`, { headers: { cookie: member.cookie } })
    expect(d.status).toBe(200)
    const body = (await d.json()) as Record<string, unknown>
    expect(body.ydoc).toBeUndefined()
    expect(body.pmJson).toBeUndefined()
    expect(body.author).toEqual({ id: member.userId, displayName: 'writer' })
    const wb = (await (
      await app.request(`/api/v1/entries/${id}?withBody=1`, { headers: { cookie: member.cookie } })
    ).json()) as Record<string, unknown>
    expect('pmJson' in wb).toBe(true)
    const list = await app.request(`/api/v1/entries?spaceId=${sharedSpaceId}`, {
      headers: { cookie: ownerCookie },
    })
    expect(list.status).toBe(200)
    const items = ((await list.json()) as { items: Record<string, unknown>[] }).items
    expect(items.map((i) => i.id)).toContain(id)
    for (const i of items) {
      expect(i.ydoc).toBeUndefined()
      expect(i.pmJson).toBeUndefined()
      expect(i.plain).toBeUndefined()
      expect(typeof i.excerpt).toBe('string')
    }
  })

  it('REQ-WS-008 · 009 他人 private 记录 → 404（含 admin）；guest 未加入的 workspace 空间 → 404（列表按 spaceId 筛选同样 404）；归档空间写 → 403', async () => {
    const created = await post(member.cookie, {
      kind: 'journal',
      title: '私密',
      spaceId: sharedSpaceId,
      visibility: 'private',
    })
    const { id } = (await created.json()) as { id: string }
    expect(
      (await app.request(`/api/v1/entries/${id}`, { headers: { cookie: ownerCookie } })).status,
    ).toBe(404)
    expect(
      (await app.request(`/api/v1/entries/${id}`, { headers: { cookie: member.cookie } })).status,
    ).toBe(200)
    // guest：共享空间未显式加入 → 404（REQ-WS-009）
    const pub = await post(member.cookie, {
      kind: 'note',
      title: '公开',
      spaceId: sharedSpaceId,
      visibility: 'workspace',
    })
    const pubId = ((await pub.json()) as { id: string }).id
    expect(
      (await app.request(`/api/v1/entries/${pubId}`, { headers: { cookie: guest.cookie } })).status,
    ).toBe(404)
    expect(
      (
        await app.request(`/api/v1/entries?spaceId=${sharedSpaceId}`, {
          headers: { cookie: guest.cookie },
        })
      ).status,
    ).toBe(404)
    // 空间归档后：可读，PATCH 403
    await db().update(spaces).set({ archivedAt: new Date() }).where(eq(spaces.id, sharedSpaceId))
    const detail = (await (
      await app.request(`/api/v1/entries/${pubId}`, { headers: { cookie: member.cookie } })
    ).json()) as { updatedAt: string }
    const patch = await app.request(`/api/v1/entries/${pubId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: member.cookie }),
      body: JSON.stringify({ title: 'x', ifUpdatedAt: detail.updatedAt }),
    })
    expect(patch.status).toBe(403)
    await db().update(spaces).set({ archivedAt: null }).where(eq(spaces.id, sharedSpaceId))
  })

  it('REQ-ENTRY-004 PATCH 带 ifUpdatedAt：不匹配 409 CONFLICT_STALE + current；匹配 200；他人记录 member 403、admin 200', async () => {
    const created = await post(member.cookie, {
      kind: 'decision',
      title: '选型',
      spaceId: sharedSpaceId,
      fields: { status: 'proposed' },
    })
    const { id } = (await created.json()) as { id: string }
    const d = (await (
      await app.request(`/api/v1/entries/${id}`, { headers: { cookie: member.cookie } })
    ).json()) as { updatedAt: string }
    const stale = await app.request(`/api/v1/entries/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: member.cookie }),
      body: JSON.stringify({ title: 'x', ifUpdatedAt: '2020-01-01T00:00:00Z' }),
    })
    expect(stale.status).toBe(409)
    const sp = await problemOf(stale)
    expect(sp.code).toBe('CONFLICT_STALE')
    expect((sp.current as { id: string }).id).toBe(id)
    const ok = await app.request(`/api/v1/entries/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: member.cookie }),
      body: JSON.stringify({
        title: '选型（已定）',
        fields: { status: 'accepted', decidedAt: '2026-09-23' },
        pinned: true,
        ifUpdatedAt: d.updatedAt,
      }),
    })
    expect(ok.status).toBe(200)
    const after = (await ok.json()) as {
      title: string
      pinned: boolean
      fields: { status: string }
      updatedAt: string
    }
    expect(after).toMatchObject({
      title: '选型（已定）',
      pinned: true,
      fields: { status: 'accepted' },
    })
    // fields 与 kind 不符 → 422
    const badFields = await app.request(`/api/v1/entries/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: member.cookie }),
      body: JSON.stringify({ fields: { severity: 'high' }, ifUpdatedAt: after.updatedAt }),
    })
    expect(badFields.status).toBe(422)
    // 另一个 member 不是作者 → 403；admin → 200
    const other = await join(app, ownerCookie, 'other@xz.local', 'member')
    const deny = await app.request(`/api/v1/entries/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: other.cookie }),
      body: JSON.stringify({ title: 'hack', ifUpdatedAt: after.updatedAt }),
    })
    expect(deny.status).toBe(403)
    const adminOk = await app.request(`/api/v1/entries/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ title: '管理员改', ifUpdatedAt: after.updatedAt }),
    })
    expect(adminOk.status).toBe(200)
  })

  it('REQ-ENTRY-007 软删 204 → 详情 404、列表不含、?deleted=1 可见；restore 恢复；permanent 仅 admin 且写 audit', async () => {
    const created = await post(member.cookie, {
      kind: 'note',
      title: '待删',
      spaceId: sharedSpaceId,
      visibility: 'workspace',
    })
    const { id } = (await created.json()) as { id: string }
    expect(
      (
        await app.request(`/api/v1/entries/${id}`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie: member.cookie }),
        })
      ).status,
    ).toBe(204)
    expect(
      (await app.request(`/api/v1/entries/${id}`, { headers: { cookie: ownerCookie } })).status,
    ).toBe(404)
    const listed = (
      (await (
        await app.request(`/api/v1/entries?spaceId=${sharedSpaceId}`, {
          headers: { cookie: member.cookie },
        })
      ).json()) as { items: { id: string }[] }
    ).items
    expect(listed.map((i) => i.id)).not.toContain(id)
    const trash = (
      (await (
        await app.request('/api/v1/entries?deleted=1', { headers: { cookie: member.cookie } })
      ).json()) as { items: { id: string; deletedAt: string }[] }
    ).items
    expect(trash.map((i) => i.id)).toContain(id)
    const restored = await app.request(`/api/v1/entries/${id}/restore`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: member.cookie }),
    })
    expect(restored.status).toBe(200)
    expect(
      (await app.request(`/api/v1/entries/${id}`, { headers: { cookie: ownerCookie } })).status,
    ).toBe(200)
    // 永久删除：member 403，admin 204 + audit
    expect(
      (
        await app.request(`/api/v1/entries/${id}?permanent=1`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie: member.cookie }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(`/api/v1/entries/${id}?permanent=1`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie: ownerCookie }),
        })
      ).status,
    ).toBe(204)
    expect(await db().select().from(entries).where(eq(entries.id, id))).toHaveLength(0)
    expect(
      await db().select().from(auditLog).where(eq(auditLog.action, 'entry.permanently_deleted')),
    ).toHaveLength(1)
  })

  it('REQ-ENTRY-002 列表游标翻页无重复无遗漏；sort 白名单外 422；归档默认隐藏', async () => {
    for (let i = 0; i < 7; i++)
      await post(member.cookie, {
        kind: 'note',
        title: `分页${i}`,
        spaceId: sharedSpaceId,
        visibility: 'workspace',
      })
    const all: string[] = []
    let cursor: string | null = null
    do {
      const url = `/api/v1/entries?spaceId=${sharedSpaceId}&limit=3&sort=-createdAt${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const body = (await (
        await app.request(url, { headers: { cookie: ownerCookie } })
      ).json()) as { items: { id: string }[]; nextCursor: string | null }
      all.push(...body.items.map((i) => i.id))
      cursor = body.nextCursor
    } while (cursor)
    expect(new Set(all).size).toBe(all.length)
    const visibleTotal = (
      (await (
        await app.request(`/api/v1/entries?spaceId=${sharedSpaceId}&limit=200&withTotal=1`, {
          headers: { cookie: ownerCookie },
        })
      ).json()) as { total: number }
    ).total
    expect(all.length).toBe(visibleTotal)
    expect(
      (await app.request('/api/v1/entries?sort=ydoc', { headers: { cookie: ownerCookie } })).status,
    ).toBe(422)
    const first = all[0] as string
    await app.request(`/api/v1/entries/${first}/archive`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    const afterArchive = (
      (await (
        await app.request(`/api/v1/entries?spaceId=${sharedSpaceId}&limit=200`, {
          headers: { cookie: ownerCookie },
        })
      ).json()) as { items: { id: string }[] }
    ).items
    expect(afterArchive.map((i) => i.id)).not.toContain(first)
    const archived = (
      (await (
        await app.request(`/api/v1/entries?spaceId=${sharedSpaceId}&archived=1`, {
          headers: { cookie: ownerCookie },
        })
      ).json()) as { items: { id: string }[] }
    ).items
    expect(archived.map((i) => i.id)).toEqual([first])
  })
})

describe('departed author', () => {
  it('REQ-WS-012 成员被移除后其记录保留、author_id 不变，作者显示「已离开的成员」', async () => {
    await truncateAll()
    await seedOwner()
    const app = buildApp().app
    const ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const m = await join(app, ownerCookie, 'leaver2@xz.local', 'member')
    const sp = await app.request('/api/v1/spaces', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ name: 'Shared', kind: 'work' }),
    })
    const shared = ((await sp.json()) as { id: string }).id
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie: m.cookie }),
      // 个人空间只允许 private（REQ-ENTRY-003），离开者的共享记录写在全员可见空间
      body: JSON.stringify({
        kind: 'note',
        title: '离开前写的',
        spaceId: shared,
        visibility: 'workspace',
      }),
    })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    expect(
      (
        await app.request(`/api/v1/workspace/members/${m.userId}`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie: ownerCookie }),
        })
      ).status,
    ).toBe(204)
    const res = await app.request(`/api/v1/entries/${id}`, { headers: { cookie: ownerCookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { authorId: string; author: { displayName: string } }
    expect(body.authorId).toBe(m.userId)
    expect(body.author.displayName).toBe('已离开的成员')
  })
})

/** REQ-SPACE-009 个人空间不可删除、不可加人（api）；普通空间加成员发 space.invited。 */
import { and, eq } from 'drizzle-orm'
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { auditLog, events, spaceMembers, spaces } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()

describe('spaces (Phase 0 subset)', () => {
  let app: ReturnType<typeof buildApp>['app']
  let cookie = ''
  let ownerId = ''
  let workspaceId = ''
  let memberId = ''
  let memberCookie = ''
  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    ownerId = r.userId
    workspaceId = r.workspaceId
    app = buildApp().app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const inv = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ email: 's@xz.local', role: 'member' }),
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 's@xz.local', name: 'S', password: 'space-password-1' }),
    })
    memberId = ((await acc.json()) as { userId: string }).userId
    memberCookie = (await signIn(app, 's@xz.local', 'space-password-1')).cookie
  })

  it('REQ-SPACE-009 个人空间：DELETE → 403；POST /:id/members → 403（owner 也不行）', async () => {
    const [ps] = await db()
      .select()
      .from(spaces)
      .where(and(eq(spaces.createdBy, ownerId), eq(spaces.isPersonal, true)))
    const del = await app.request(`/api/v1/spaces/${ps?.id}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie }),
    })
    expect(del.status).toBe(403)
    const add = await app.request(`/api/v1/spaces/${ps?.id}/members`, {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    })
    expect(add.status).toBe(403)
    expect((await problemOf(add)).code).toBe('FORBIDDEN')
    // 他人的个人空间对 member 不可见 → 404（不泄露存在性）
    expect(
      (
        await app.request(`/api/v1/spaces/${ps?.id}`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie: memberCookie }),
        })
      ).status,
    ).toBe(404)
  })

  it('普通空间：加成员 201 并发 space.invited；member 删空间 403、owner 204 且 audit space.deleted', async () => {
    const id = v7()
    await db().insert(spaces).values({
      id,
      workspaceId,
      name: '项目',
      slug: 'proj',
      kind: 'project',
      visibility: 'members',
      sortKey: 'a1',
      createdBy: ownerId,
    })
    await db().insert(spaceMembers).values({ spaceId: id, userId: ownerId, role: 'admin' })
    const add = await app.request(`/api/v1/spaces/${id}/members`, {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    })
    expect(add.status).toBe(201)
    const ev = await db().select().from(events).where(eq(events.kind, 'space.invited'))
    expect(ev).toHaveLength(1)
    expect((ev[0]?.visibilityScope as { userIds?: string[] } | undefined)?.userIds).toEqual([
      memberId,
    ])
    expect(
      (
        await app.request(`/api/v1/spaces/${id}`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie: memberCookie }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(`/api/v1/spaces/${id}`, {
          method: 'DELETE',
          headers: jsonHeaders({ cookie }),
        })
      ).status,
    ).toBe(204)
    expect(
      await db().select().from(auditLog).where(eq(auditLog.action, 'space.deleted')),
    ).toHaveLength(1)
  })
})

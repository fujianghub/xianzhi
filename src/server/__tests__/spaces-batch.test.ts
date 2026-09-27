/**
 * ADR-0021 空间批量操作（REQ-SPACE-010 ~ 012，api 层）：`POST /spaces/batch` 逐个鉴权、部分失败、dryRun 计数、回收站批量恢复 / 彻底删除。
 */
import { and, eq, inArray } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { auditLog, entries, spaces } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface SpaceJson {
  id: string
  isPersonal: boolean
  groupId: string | null
  archivedAt: string | null
}
interface BatchJson {
  ok: string[]
  failed: { id: string; code: string; message: string }[]
  counts: { entries: number; tasks: number }
}

describe('ADR-0021 spaces batch', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'member2', U> = {} as never

  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (who: U, name: string) => {
    const r = await req(who, 'POST', '/spaces', { kind: 'project', name })
    expect(r.status).toBe(201)
    return (await r.json()) as SpaceJson
  }
  const batch = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/spaces/batch', body)
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200)
    return (await r.json()) as BatchJson
  }
  const list = async (who: U, qs = '') =>
    ((await (await req(who, 'GET', `/spaces${qs}`)).json()) as { items: SpaceJson[] }).items
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

  async function invite(email: string): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'batch-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'batch-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('bm@xz.local')
    u.member2 = await invite('bm2@xz.local')
  })

  it('REQ-SPACE-010 批量归档 / 取消归档 / 移到大类：逐个鉴权，无权与个人空间进 failed，其余生效', async () => {
    const mine = [await create(u.member, 'B1'), await create(u.member, 'B2')]
    const other = await create(u.member2, 'Other')
    const personal = (await list(u.member)).find((s) => s.isPersonal)
    expect(personal).toBeTruthy()
    const all = [...ids(mine), other.id, personal?.id as string]

    const arch = await batch(u.member, { op: 'archive', ids: all })
    expect(arch.ok.sort()).toEqual(ids(mine).sort())
    expect(arch.failed.map((f) => [f.id, f.code]).sort()).toEqual(
      [
        [other.id, 'FORBIDDEN'],
        [personal?.id, 'FORBIDDEN'],
      ].sort(),
    )
    expect(ids(await list(u.member, '?archived=1'))).toEqual(expect.arrayContaining(ids(mine)))
    expect(ids(await list(u.member))).not.toContain(mine[0]?.id)

    const un = await batch(u.member, { op: 'unarchive', ids: ids(mine) })
    expect(un.ok).toHaveLength(2)
    expect(ids(await list(u.member))).toEqual(expect.arrayContaining(ids(mine)))

    const group = (await (
      await req(u.owner, 'POST', '/space-groups', { name: '批量组' })
    ).json()) as { id: string }
    const mv = await batch(u.member, {
      op: 'move',
      ids: [...ids(mine), other.id],
      groupId: group.id,
    })
    expect(mv.ok.sort()).toEqual(ids(mine).sort())
    expect(mv.failed.map((f) => f.id)).toEqual([other.id])
    const after = await list(u.member)
    expect(
      after
        .filter((s) => s.groupId === group.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual(ids(mine).sort())
    await batch(u.member, { op: 'move', ids: ids(mine), groupId: null })
    expect((await list(u.member)).filter((s) => s.groupId === group.id)).toHaveLength(0)
    // 不存在的大类：整批 422
    const bad = await req(u.member, 'POST', '/spaces/batch', {
      op: 'move',
      ids: ids(mine),
      groupId: '00000000-0000-4000-8000-000000000000',
    })
    expect(bad.status).toBe(422)
  })

  it('REQ-SPACE-011 批量删除仅工作区 owner/admin；dryRun 只计数不写库；删除后可批量恢复（撤销）', async () => {
    const a = await create(u.member, 'Del A')
    const b = await create(u.member, 'Del B')
    for (const s of [a, b])
      await req(u.member, 'POST', '/entries', { kind: 'note', title: 'n', spaceId: s.id })
    await req(u.member, 'POST', '/tasks', { title: 't', spaceId: a.id, status: 'todo' })

    const denied = await batch(u.member, { op: 'delete', ids: [a.id, b.id] })
    expect(denied.ok).toEqual([])
    expect(denied.failed.every((f) => f.code === 'FORBIDDEN')).toBe(true)

    const dry = await batch(u.owner, { op: 'delete', ids: [a.id, b.id], dryRun: true })
    expect(dry.ok.sort()).toEqual([a.id, b.id].sort())
    expect(dry.counts).toEqual({ entries: 2, tasks: 1 })
    const rows = await db()
      .select()
      .from(spaces)
      .where(inArray(spaces.id, [a.id, b.id]))
    expect(rows.every((r) => r.deletedAt === null)).toBe(true)

    const del = await batch(u.owner, { op: 'delete', ids: [a.id, b.id] })
    expect(del.ok).toHaveLength(2)
    expect(ids(await list(u.owner))).not.toContain(a.id)
    const audits = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'space.deleted'), inArray(auditLog.targetId, [a.id, b.id])))
    expect(audits).toHaveLength(2)

    const res = await batch(u.owner, { op: 'restore', ids: [a.id, b.id] })
    expect(res.ok).toHaveLength(2)
    expect(ids(await list(u.owner))).toEqual(expect.arrayContaining([a.id, b.id]))
  })

  it('REQ-SPACE-012 回收站批量彻底删除：只接受已删除的空间，member 全部 403，内容一并清除', async () => {
    const a = await create(u.owner, 'Purge A')
    const live = await create(u.owner, 'Purge Live')
    const e = (await (
      await req(u.owner, 'POST', '/entries', { kind: 'note', title: 'n', spaceId: a.id })
    ).json()) as { id: string }
    await batch(u.owner, { op: 'delete', ids: [a.id] })

    const member = await batch(u.member, { op: 'purge', ids: [a.id] })
    expect(member.failed[0]?.code).toBe('FORBIDDEN')

    const r = await batch(u.owner, { op: 'purge', ids: [a.id, live.id] })
    expect(r.ok).toEqual([a.id])
    expect(r.failed).toEqual([expect.objectContaining({ id: live.id, code: 'CONFLICT_STALE' })])
    expect(await db().select().from(spaces).where(eq(spaces.id, a.id))).toHaveLength(0)
    expect(await db().select().from(entries).where(eq(entries.id, e.id))).toHaveLength(0)
    expect(await db().select().from(spaces).where(eq(spaces.id, live.id))).toHaveLength(1)

    // 超过 100 个：422
    const many = Array.from({ length: 101 }, () => live.id)
    expect((await req(u.owner, 'POST', '/spaces/batch', { op: 'purge', ids: many })).status).toBe(
      422,
    )
  })
})

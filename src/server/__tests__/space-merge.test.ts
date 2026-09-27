/**
 * ADR-0022 合并空间（REQ-SPACE-013 · 014，api 层）：`POST /spaces/:id/merge` 搬记录 / 任务 / 成员、目录与任务顺序、A 进回收站、dryRun 与权限。
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { auditLog, entries, spaceMembers, spaces, tasks } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface Preview {
  entries: number
  tasks: number
  members: number
  visibilityWidened: boolean
}

describe('ADR-0022 space merge', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'member2', U> = {} as never

  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const json = async <T>(r: Response | Promise<Response>, status = 200): Promise<T> => {
    const res = await r
    expect(res.status, await res.clone().text()).toBe(status)
    return (status === 204 ? undefined : await res.json()) as T
  }
  const space = (who: U, name: string, visibility: 'workspace' | 'members' = 'workspace') =>
    json<{ id: string; slug: string }>(
      req(who, 'POST', '/spaces', { kind: 'project', name, visibility }),
      201,
    )
  const entry = (who: U, spaceId: string, title: string, parentId?: string | null) =>
    json<{ id: string }>(
      req(who, 'POST', '/entries', {
        kind: 'note',
        title,
        spaceId,
        ...(parentId !== undefined ? { parentId } : {}),
      }),
      201,
    )
  const task = (who: U, spaceId: string, title: string) =>
    json<{ id: string }>(req(who, 'POST', '/tasks', { title, spaceId, status: 'todo' }), 201)
  const merge = (who: U, from: string, into: string, dryRun?: boolean) =>
    req(who, 'POST', `/spaces/${from}/merge`, { into, ...(dryRun ? { dryRun } : {}) })

  async function invite(email: string, role: 'admin' | 'member' | 'guest' = 'member'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'merge-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'merge-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('mm@xz.local')
    u.member2 = await invite('mm2@xz.local')
  })

  it('REQ-SPACE-013 合并：记录 / 任务 / 评论跟到 B，目录与任务顺序接在 B 之后，成员取较高角色，A 进回收站并审计', async () => {
    const a = await space(u.owner, 'Merge A')
    const b = await space(u.owner, 'Merge B')
    // B 已有顶层页与任务
    const bTop = await entry(u.owner, b.id, 'B 顶层', null)
    const bTask = await task(u.owner, b.id, 'B 任务')
    // A：两个顶层页（第二个带子页）、一篇不在目录的、一篇回收站里的、两个任务（其一带评论）
    const a1 = await entry(u.owner, a.id, 'A 顶层一', null)
    const a2 = await entry(u.owner, a.id, 'A 顶层二', null)
    const a2c = await entry(u.owner, a.id, 'A 子页', a2.id)
    const loose = await entry(u.owner, a.id, 'A 不在目录')
    const trashed = await entry(u.owner, a.id, 'A 已删')
    await json(req(u.owner, 'DELETE', `/entries/${trashed.id}`), 204)
    const t1 = await task(u.owner, a.id, 'A 任务一')
    const t2 = await task(u.owner, a.id, 'A 任务二')
    await json(
      req(u.owner, 'POST', '/comments', {
        targetType: 'task',
        targetId: t1.id,
        bodyPm: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '评' }] }],
        },
      }),
      201,
    )
    // 成员：member 是 A 的 admin、B 的 viewer → 合并后 B 的 admin；member2 只在 A → 加进 B
    await json(
      req(u.owner, 'POST', `/spaces/${a.id}/members`, { userId: u.member.id, role: 'admin' }),
      201,
    )
    await json(
      req(u.owner, 'POST', `/spaces/${b.id}/members`, { userId: u.member.id, role: 'viewer' }),
      201,
    )
    await json(
      req(u.owner, 'POST', `/spaces/${a.id}/members`, { userId: u.member2.id, role: 'member' }),
      201,
    )

    const [a1Before] = await db().select().from(entries).where(eq(entries.id, a1.id))
    const r = await json<{ preview: Preview; into: { id: string } }>(merge(u.owner, a.id, b.id))
    expect(r.preview).toMatchObject({ entries: 4, tasks: 2, members: 2, visibilityWidened: false })
    expect(r.into.id).toBe(b.id)

    // 记录全部到 B（含回收站里的），updatedAt 不变
    const moved = await db()
      .select({
        id: entries.id,
        spaceId: entries.spaceId,
        parentId: entries.parentId,
        updatedAt: entries.updatedAt,
      })
      .from(entries)
      .where(eq(entries.spaceId, b.id))
    expect(moved.map((e) => e.id).sort()).toEqual(
      [bTop.id, a1.id, a2.id, a2c.id, loose.id, trashed.id].sort(),
    )
    expect(moved.find((e) => e.id === a1.id)?.updatedAt.toISOString()).toBe(
      a1Before?.updatedAt.toISOString(),
    )
    // 目录：B 顶层 → A 顶层一 → A 顶层二（子页层级不变）；不在目录的仍不在
    const top = await db()
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.spaceId, b.id), isNull(entries.parentId), isNull(entries.deletedAt)))
      .orderBy(asc(entries.treeOrder))
    const tree = await json<{ items: { id: string; parentId: string | null }[] }>(
      req(u.owner, 'GET', `/spaces/${b.id}/tree`),
    )
    expect(tree.items.filter((i) => !i.parentId).map((i) => i.id)).toEqual([bTop.id, a1.id, a2.id])
    expect(tree.items.find((i) => i.id === a2c.id)?.parentId).toBe(a2.id)
    expect(tree.items.map((i) => i.id)).not.toContain(loose.id)
    expect(top.map((e) => e.id)).toContain(loose.id)
    // 任务：B 的在前，A 的按原顺序接在后面；评论跟着任务
    const ts = await db()
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.spaceId, b.id), eq(tasks.status, 'todo')))
      .orderBy(asc(tasks.sortKey))
    expect(ts.map((t) => t.id)).toEqual([bTask.id, t1.id, t2.id])
    const cs = await json<{ items: unknown[] }>(
      req(u.owner, 'GET', `/comments?targetType=task&targetId=${t1.id}`),
    )
    expect(cs.items).toHaveLength(1)
    // 成员
    const mem = await db().select().from(spaceMembers).where(eq(spaceMembers.spaceId, b.id))
    const roleOf = (id: string) => mem.find((m) => m.userId === id)?.role
    expect(roleOf(u.member.id)).toBe('admin')
    expect(roleOf(u.member2.id)).toBe('member')
    // A 进回收站；审计
    const [aRow] = await db().select().from(spaces).where(eq(spaces.id, a.id))
    expect(aRow?.deletedAt).not.toBeNull()
    const trash = await json<{ items: { id: string }[] }>(req(u.owner, 'GET', '/spaces?deleted=1'))
    expect(trash.items.map((s) => s.id)).toContain(a.id)
    const [log] = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'space.merged'), eq(auditLog.targetId, a.id)))
    expect(log?.meta).toMatchObject({ intoId: b.id, entries: 4, tasks: 2, members: 2 })
    // 再合并已删的 A：404
    expect((await merge(u.owner, a.id, b.id)).status).toBe(404)
  })

  it('REQ-SPACE-014 dryRun 只预览不写库并标出可见性扩大；权限与前置校验', async () => {
    const a = await space(u.owner, 'Dry A', 'members')
    const b = await space(u.owner, 'Dry B', 'workspace')
    await entry(u.owner, a.id, 'x')
    const dry = await json<{ preview: Preview; into?: unknown }>(merge(u.owner, a.id, b.id, true))
    expect(dry.preview).toMatchObject({ entries: 1, tasks: 0, visibilityWidened: true })
    expect(dry.into).toBeUndefined()
    const [still] = await db().select().from(entries).where(eq(entries.spaceId, a.id))
    expect(still).toBeTruthy()
    const [aRow] = await db().select().from(spaces).where(eq(spaces.id, a.id))
    expect(aRow?.deletedAt).toBeNull()

    // 同一空间 422；个人空间 403
    expect((await merge(u.owner, b.id, b.id)).status).toBe(422)
    const personal = (
      await json<{ items: { id: string; isPersonal: boolean }[] }>(req(u.owner, 'GET', '/spaces'))
    ).items.find((s) => s.isPersonal)
    expect((await merge(u.owner, a.id, personal?.id as string)).status).toBe(403)
    // 目标已归档 403；源已归档可以（dryRun 验证）
    await json(req(u.owner, 'POST', `/spaces/${b.id}/archive`))
    expect((await merge(u.owner, a.id, b.id, true)).status).toBe(403)
    await json(req(u.owner, 'POST', `/spaces/${b.id}/unarchive`))
    await json(req(u.owner, 'POST', `/spaces/${a.id}/archive`))
    expect((await merge(u.owner, a.id, b.id, true)).status).toBe(200)
    await json(req(u.owner, 'POST', `/spaces/${a.id}/unarchive`))

    // 两边的空间管理员但只是工作区 member：删不了源 → 403
    const c = await space(u.member, 'Member C')
    const d = await space(u.member, 'Member D')
    expect((await merge(u.member, c.id, d.id, true)).status).toBe(403)
    // 看不到源空间：404
    expect((await merge(u.member2, a.id, b.id, true)).status).toBe(404)
  })
})

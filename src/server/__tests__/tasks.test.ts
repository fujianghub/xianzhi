/**
 * T1-003 任务读路径 + CRUD 骨架（REQ-TASK-004 · 005 · 006 · 017 · 019，api 层）。
 * 「现在」用真实时钟；今日边界由 src/shared/tz.ts 按同一时区算出，任务时刻取边界内外各 30 分钟。
 */
import { and, eq, sql } from 'drizzle-orm'
import { v4 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import { dayRange } from '../../shared/tz.ts'
import { getDb } from '../db/index.ts'
import { user as userTable } from '../db/schema/auth.ts'
import {
  auditLog,
  idempotencyKeys,
  notifications,
  tasks,
  taskWatchers,
} from '../db/schema/business.ts'
import { EventBus } from '../lib/event-bus.ts'
import { tsvText } from '../lib/tokenize.ts'
import { emit } from '../services/events.ts'
import { fanoutEvent } from '../services/notify.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface T {
  id: string
  title: string
  status: string
  dueAt: string | null
  spaceId: string
  sortKey: string
  updatedAt: string
  descriptionPm?: unknown
}
const MIN = 60_000
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('T1-003 tasks', () => {
  let app: App
  let workspaceId = ''
  const u: Record<'owner' | 'member' | 'member2' | 'guest', U> = {} as never
  let productId = ''
  let secretId = ''

  const req = (
    who: U,
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie, ...extra }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const countTasks = async () =>
    (await db().select({ n: sql<number>`count(*)::int` }).from(tasks))[0]?.n ?? 0
  const create = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/tasks', body)
    expect(r.status, await r.clone().text()).toBe(201)
    return (await r.json()) as T
  }
  const list = async (who: U, qs: string) => {
    const r = await req(who, 'GET', `/tasks?${qs}`)
    expect(r.status, await r.clone().text()).toBe(200)
    return (await r.json()) as { items: T[]; nextCursor: string | null; total?: number }
  }
  const setTz = (id: string, tz: string) =>
    db().update(userTable).set({ timezone: tz }).where(eq(userTable.id, id))

  async function invite(email: string, role: 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'task-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'task-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('tm@xz.local', 'member')
    u.member2 = await invite('tm2@xz.local', 'member')
    u.guest = await invite('tg@xz.local', 'guest')
    const p = await req(u.owner, 'POST', '/spaces', {
      name: 'Product',
      slug: 'product',
      kind: 'project',
    })
    productId = ((await p.json()) as { id: string }).id
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'Secret',
      slug: 'secret',
      kind: 'work',
      visibility: 'members',
    })
    secretId = ((await s.json()) as { id: string }).id
    await req(u.owner, 'POST', `/spaces/${secretId}/members`, {
      userId: u.guest.id,
      role: 'viewer',
    })
  })

  it('REQ-TASK-004 创建缺省落个人空间；详情含 descriptionPm；列内 sortKey 递增；描述派生可被 q 命中', async () => {
    const a = await create(u.member, { title: '写周报', descriptionPm: doc('周五前交给产品组') })
    const b = await create(u.member, { title: '第二个' })
    const [personal] = await db()
      .execute<{ id: string }>(
        sql`select id from spaces where created_by = ${u.member.id} and is_personal`,
      )
      .then((x) => x.rows)
    expect(a.spaceId).toBe(personal?.id)
    expect(a.status).toBe('inbox')
    expect(b.sortKey > a.sortKey).toBe(true)
    const got = (await (await req(u.member, 'GET', `/tasks/${a.id}`)).json()) as T
    expect(got.descriptionPm).toEqual(doc('周五前交给产品组'))
    const [row] = await db()
      .select({ plain: tasks.descriptionPlain })
      .from(tasks)
      .where(eq(tasks.id, a.id))
    expect(row?.plain).toContain('产品组')
    expect((await list(u.member, 'q=产品组')).items.map((x) => x.id)).toEqual([a.id])
    expect((await req(u.member, 'GET', '/tasks/not-a-uuid')).status).toBe(422)
  })

  it('REQ-TASK-004 limit=201 → 422；sort 白名单外 → 422；limit=200 翻页无重复无遗漏且无 descriptionPm（多种排序）', async () => {
    expect((await req(u.owner, 'GET', `/tasks?spaceId=${productId}&limit=201`)).status).toBe(422)
    const bad = await req(u.owner, 'GET', `/tasks?spaceId=${productId}&sort=hacker`)
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).code).toBe('VALIDATION')
    // 批量造 450 条：相同 priority / 部分 dueAt 为空，考验游标元组比较
    const base = Date.now()
    const values = Array.from({ length: 450 }, (_, i) => ({
      workspaceId,
      spaceId: productId,
      title: `批量 ${String(i % 37).padStart(2, '0')}`,
      status: 'todo',
      priority: i % 5,
      dueAt: i % 3 === 0 ? null : new Date(base + (i % 50) * MIN),
      creatorId: u.owner.id,
      descriptionPm: doc(`描述 ${i}`),
      sortKey: `a${String(i).padStart(4, '0')}`,
      updatedAt: new Date(base - (i % 7) * 1000),
    }))
    await db().insert(tasks).values(values)
    for (const sort of [
      '-updatedAt',
      'dueAt',
      '-dueAt',
      '-priority',
      'title',
      'sortKey',
      'createdAt',
    ]) {
      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        if (++pages > 5) throw new Error(`${sort} 游标不前进`)
        const page = await list(
          u.owner,
          `spaceId=${productId}&limit=200&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`,
        )
        for (const it of page.items) {
          expect(it).not.toHaveProperty('descriptionPm')
          seen.push(it.id)
        }
        cursor = page.nextCursor
      } while (cursor)
      expect(new Set(seen).size, sort).toBe(seen.length)
      expect(seen.length, sort).toBe(450)
    }
    const withTotal = await list(u.owner, `spaceId=${productId}&limit=10&withTotal=1&status=todo`)
    expect(withTotal.total).toBe(450)
  })

  it('REQ-TASK-005 今日：上海时区今日 23:30 到期含、明日 00:30 不含、今日到期但 done 不含；逾期与今日开始含；他人的不含', async () => {
    await setTz(u.member.id, 'Asia/Shanghai')
    const { start, end } = dayRange('Asia/Shanghai', new Date())
    const iso = (t: number) => new Date(t).toISOString()
    const late = await create(u.member, {
      title: '今晚',
      dueAt: iso(end.getTime() - 30 * MIN),
      status: 'todo',
    })
    const tomorrow = await create(u.member, {
      title: '明晨',
      dueAt: iso(end.getTime() + 30 * MIN),
      status: 'todo',
    })
    const done = await create(u.member, {
      title: '已完成',
      dueAt: iso(end.getTime() - 60 * MIN),
      status: 'done',
    })
    const overdue = await create(u.member, {
      title: '逾期',
      dueAt: iso(start.getTime() - 24 * 60 * MIN),
      status: 'doing',
    })
    const scheduled = await create(u.member, {
      title: '今日开始',
      scheduledAt: iso(start.getTime() + 60 * MIN),
      status: 'todo',
    })
    const others = await create(u.member2, {
      title: '别人的',
      dueAt: iso(end.getTime() - 30 * MIN),
      status: 'todo',
      spaceId: productId,
    })
    const ids = (await list(u.member, 'view=today&limit=200')).items.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining([late.id, overdue.id, scheduled.id]))
    expect(ids).not.toContain(tomorrow.id)
    expect(ids).not.toContain(done.id)
    expect(ids).not.toContain(others.id)
    // 指派给我的他人任务也算「我的」
    await req(u.member2, 'PATCH', `/tasks/${others.id}`, {
      assigneeId: u.member.id,
      ifUpdatedAt: others.updatedAt,
    })
    expect((await list(u.member, 'view=today&limit=200')).items.map((x) => x.id)).toContain(
      others.id,
    )
  })

  it('REQ-TASK-017 同一 dueAt：两个时区的用户看到相同 UTC；due=today 的边界按各自时区', async () => {
    await setTz(u.member.id, 'Asia/Shanghai')
    await setTz(u.member2.id, 'America/Los_Angeles')
    const now = new Date()
    const sh = dayRange('Asia/Shanghai', now)
    const la = dayRange('America/Los_Angeles', now)
    // 取「只在上海今日」内的时刻：上海今日内且不在洛杉矶今日内
    const candidates = [sh.start.getTime() + 30 * MIN, sh.end.getTime() - 30 * MIN]
    const onlySh = candidates.find((t) => t < la.start.getTime() || t >= la.end.getTime())
    expect(onlySh).toBeDefined()
    const t = await create(u.owner, {
      title: '跨时区',
      spaceId: productId,
      status: 'todo',
      dueAt: new Date(onlySh ?? 0).toISOString(),
    })
    const a = await list(u.member, `spaceId=${productId}&due=today&limit=200`)
    const b = await list(u.member2, `spaceId=${productId}&due=today&limit=200`)
    expect(a.items.map((x) => x.id)).toContain(t.id)
    expect(b.items.map((x) => x.id)).not.toContain(t.id)
    const g1 = (await (await req(u.member, 'GET', `/tasks/${t.id}`)).json()) as T
    const g2 = (await (await req(u.member2, 'GET', `/tasks/${t.id}`)).json()) as T
    expect(g1.dueAt).toBe(g2.dueAt)
    // week / overdue 不报错且 overdue 只含未完成
    expect((await req(u.member, 'GET', '/tasks?due=week')).status).toBe(200)
    const od = await list(u.member, 'due=overdue&limit=200')
    expect(od.items.every((x) => !['done', 'cancelled'].includes(x.status))).toBe(true)
  })

  it('REQ-TASK-024 日历区间 from/to：截止或计划开始落在区间内都返回、跨空间且只含可见；缺一 / 倒置 / 超 62 天 / 与 view 同用 → 422', async () => {
    const base = Date.UTC(2031, 0, 5, 4) // 远离「今天」，不与其它用例串味
    const at = (d: number) => new Date(base + d * 86_400_000).toISOString()
    const due = await create(u.owner, {
      title: '日历截止',
      spaceId: productId,
      status: 'todo',
      dueAt: at(1),
    })
    const sched = await create(u.owner, {
      title: '日历开始',
      spaceId: productId,
      status: 'todo',
      scheduledAt: at(2),
    })
    const outside = await create(u.owner, { title: '区间外', spaceId: productId, dueAt: at(40) })
    const hidden = await create(u.owner, { title: '机密日历', spaceId: secretId, dueAt: at(1) })
    const q = `from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(35))}&limit=200`
    const ids = (await list(u.member, q)).items.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining([due.id, sched.id]))
    expect(ids).not.toContain(outside.id)
    expect(ids).not.toContain(hidden.id) // member 看不到 secret 空间
    expect((await list(u.owner, q)).items.map((x) => x.id)).toContain(hidden.id)

    const bad = [
      `from=${encodeURIComponent(at(0))}`,
      `from=${encodeURIComponent(at(3))}&to=${encodeURIComponent(at(1))}`,
      `from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(63))}`,
      `view=today&from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(7))}`,
    ]
    for (const b of bad) expect((await req(u.member, 'GET', `/tasks?${b}`)).status, b).toBe(422)
  })

  it('REQ-TASK-006 收件箱：status=inbox 且创建者或指派人为我；view=inbox 与 status 同用 → 422', async () => {
    const mineInbox = await create(u.member2, { title: '我的收件' })
    const assignedToMe = await create(u.member, {
      title: '派给 m2',
      spaceId: productId,
      assigneeId: u.member2.id,
    })
    const notMine = await create(u.member, { title: '他人收件', spaceId: productId })
    const todo = await create(u.member2, { title: '已排期', status: 'todo' })
    const ids = (await list(u.member2, 'view=inbox&limit=200')).items.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining([mineInbox.id, assignedToMe.id]))
    expect(ids).not.toContain(notMine.id)
    expect(ids).not.toContain(todo.id)
    expect((await req(u.member2, 'GET', '/tasks?view=inbox&status=inbox')).status).toBe(422)
  })

  it('REQ-TASK-019 空间 viewer（guest）可读任务、写全部 403；不可见 spaceId 404；不能指派给看不到空间的人', async () => {
    const t = await create(u.owner, { title: '机密任务', spaceId: secretId, status: 'todo' })
    const r = await req(u.guest, 'GET', `/tasks?spaceId=${secretId}`)
    expect(r.status).toBe(200)
    expect(((await r.json()) as { items: T[] }).items.map((x) => x.id)).toContain(t.id)
    expect(
      (await req(u.guest, 'PATCH', `/tasks/${t.id}`, { title: 'x', ifUpdatedAt: t.updatedAt }))
        .status,
    ).toBe(403)
    expect((await req(u.guest, 'POST', '/tasks', { title: 'x', spaceId: secretId })).status).toBe(
      403,
    )
    expect((await req(u.guest, 'DELETE', `/tasks/${t.id}`)).status).toBe(403)
    // 非成员 member：空间不可见 → 列表筛选 404、详情 404
    expect((await req(u.member, 'GET', `/tasks?spaceId=${secretId}`)).status).toBe(404)
    expect((await req(u.member, 'GET', `/tasks/${t.id}`)).status).toBe(404)
    const bad = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      assigneeId: u.member.id,
      ifUpdatedAt: t.updatedAt,
    })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe('assigneeId')
  })

  it('PATCH：状态进入 done 写 completedAt、换列落列底；过期 ifUpdatedAt 409；软删后 404', async () => {
    const t = await create(u.owner, { title: '流转', spaceId: productId, status: 'todo' })
    const r = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      status: 'done',
      ifUpdatedAt: t.updatedAt,
    })
    expect(r.status).toBe(200)
    const d = (await r.json()) as T & { completedAt: string | null }
    expect(d.completedAt).not.toBeNull()
    const stale = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      title: 'x',
      ifUpdatedAt: t.updatedAt,
    })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { current: T }).current.status).toBe('done')
    const back = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      status: 'todo',
      ifUpdatedAt: d.updatedAt,
    })
    expect(((await back.json()) as { completedAt: string | null }).completedAt).toBeNull()
    expect((await req(u.owner, 'DELETE', `/tasks/${t.id}`)).status).toBe(204)
    expect((await req(u.owner, 'GET', `/tasks/${t.id}`)).status).toBe(404)
  })

  it('REQ-TASK-001 同 Idempotency-Key 重放同 id 且不新增；创建者与指派人自动为 watcher；非法 key 422；失败请求可用同 key 重试；24h 后视为新请求', async () => {
    const key = v4()
    const body = { title: '幂等', spaceId: productId, assigneeId: u.member.id }
    const before = await countTasks()
    const r1 = await req(u.owner, 'POST', '/tasks', body, { 'idempotency-key': key })
    expect(r1.status).toBe(201)
    const t1 = (await r1.json()) as T
    const r2 = await req(u.owner, 'POST', '/tasks', body, { 'idempotency-key': key })
    expect(r2.status).toBe(201)
    expect(r2.headers.get('idempotent-replayed')).toBe('true')
    expect(((await r2.json()) as T).id).toBe(t1.id)
    expect(await countTasks()).toBe(before + 1)
    const w = await db().select().from(taskWatchers).where(eq(taskWatchers.taskId, t1.id))
    expect(w.map((x) => x.userId).sort()).toEqual([u.owner.id, u.member.id].sort())
    // 非 UUID
    expect((await req(u.owner, 'POST', '/tasks', body, { 'idempotency-key': 'abc' })).status).toBe(
      422,
    )
    // 失败（422）不占用 key，改正后同 key 成功
    const k2 = v4()
    expect(
      (await req(u.owner, 'POST', '/tasks', { title: '' }, { 'idempotency-key': k2 })).status,
    ).toBe(422)
    expect(
      (await req(u.owner, 'POST', '/tasks', { title: 'ok' }, { 'idempotency-key': k2 })).status,
    ).toBe(201)
    // 他人用同 key：照常创建，不回放 owner 的响应
    const other = await req(
      u.member,
      'POST',
      '/tasks',
      { title: '别人的' },
      { 'idempotency-key': key },
    )
    expect(other.status).toBe(201)
    expect(((await other.json()) as T).id).not.toBe(t1.id)
    expect(other.headers.get('idempotent-replayed')).toBeNull()
    // 24h 后：视为新请求
    await db()
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(idempotencyKeys.key, key))
    const r3 = await req(u.owner, 'POST', '/tasks', body, { 'idempotency-key': key })
    expect(((await r3.json()) as T).id).not.toBe(t1.id)
  })

  it('REQ-TASK-001 并发同 key：只创建一条，另一个得到 409 CONFLICT_IN_FLIGHT 或回放', async () => {
    const key = v4()
    const before = await countTasks()
    const rs = await Promise.all(
      [1, 2, 3].map(() =>
        req(u.owner, 'POST', '/tasks', { title: '并发' }, { 'idempotency-key': key }),
      ),
    )
    const statuses = rs.map((r) => r.status).sort()
    expect(statuses.every((st) => st === 201 || st === 409)).toBe(true)
    expect(statuses).toContain(201)
    expect(await countTasks()).toBe(before + 1)
    for (const r of rs.filter((x) => x.status === 409))
      expect((await problemOf(r)).code).toBe('CONFLICT_IN_FLIGHT')
  })

  it('幂等中间件也挂在 POST /spaces 与 /entries：同 key 回放同 id（其余创建端点由 T1-040 覆盖）', async () => {
    const k = v4()
    const a = await req(
      u.member,
      'POST',
      '/spaces',
      { name: 'Idem', kind: 'work' },
      { 'idempotency-key': k },
    )
    const b = await req(
      u.member,
      'POST',
      '/spaces',
      { name: 'Idem', kind: 'work' },
      { 'idempotency-key': k },
    )
    expect(((await b.json()) as T).id).toBe(((await a.json()) as T).id)
    const k2 = v4()
    const e1 = await req(
      u.member,
      'POST',
      '/entries',
      { kind: 'note', title: 'n' },
      { 'idempotency-key': k2 },
    )
    const e2 = await req(
      u.member,
      'POST',
      '/entries',
      { kind: 'note', title: 'n' },
      { 'idempotency-key': k2 },
    )
    expect(((await e2.json()) as T).id).toBe(((await e1.json()) as T).id)
  })

  it('REQ-TASK-012 两客户端先后 PATCH：第二个 409 CONFLICT_STALE，current.updatedAt = 第一个写入后的值', async () => {
    const t = await create(u.owner, { title: '并发编辑', spaceId: productId, status: 'todo' })
    const first = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      title: 'A',
      ifUpdatedAt: t.updatedAt,
    })
    expect(first.status).toBe(200)
    const a = (await first.json()) as T
    const second = await req(u.member, 'PATCH', `/tasks/${t.id}`, {
      title: 'B',
      ifUpdatedAt: t.updatedAt,
    })
    expect(second.status).toBe(409)
    const p = (await second.json()) as { code: string; current: T }
    expect(p.code).toBe('CONFLICT_STALE')
    expect(p.current.updatedAt).toBe(a.updatedAt)
    expect(p.current.title).toBe('A')
  })

  it('REQ-TASK-013 软删后列表不含、回收站含（创建者 / owner）；恢复回来；member 永久删 403；owner 永久删清除并审计', async () => {
    const t = await create(u.member, { title: '回收', spaceId: productId, status: 'todo' })
    expect((await req(u.member, 'DELETE', `/tasks/${t.id}`)).status).toBe(204)
    expect(
      (await list(u.member, `spaceId=${productId}&limit=200&status=todo`)).items.map((x) => x.id),
    ).not.toContain(t.id)
    expect((await list(u.member, 'deleted=1&limit=200')).items.map((x) => x.id)).toContain(t.id)
    expect((await list(u.owner, 'deleted=1&limit=200')).items.map((x) => x.id)).toContain(t.id)
    expect((await list(u.member2, 'deleted=1&limit=200')).items.map((x) => x.id)).not.toContain(
      t.id,
    )
    expect((await req(u.member2, 'POST', `/tasks/${t.id}/restore`)).status).toBe(404)
    const back = await req(u.member, 'POST', `/tasks/${t.id}/restore`)
    expect(back.status).toBe(200)
    expect(
      (await list(u.member, `spaceId=${productId}&limit=200&status=todo`)).items.map((x) => x.id),
    ).toContain(t.id)
    expect((await req(u.member, 'POST', `/tasks/${t.id}/restore`)).status).toBe(404) // 未删除
    expect((await req(u.member, 'DELETE', `/tasks/${t.id}?permanent=1`)).status).toBe(403)
    expect((await req(u.owner, 'DELETE', `/tasks/${t.id}?permanent=1`)).status).toBe(204)
    expect(await db().select().from(tasks).where(eq(tasks.id, t.id))).toHaveLength(0)
    const [a] = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'task.permanently_deleted'), eq(auditLog.targetId, t.id)))
    expect(a?.meta).toMatchObject({ title: '回收', wasDeleted: false })
  })

  it('REQ-TASK-008 子任务最多 2 层：A → B 可以，挂在 B 下的 C 422；有子任务的 B 不能再挂到别人下面；父子不能单独换空间', async () => {
    const a = await create(u.owner, { title: 'A', spaceId: productId, status: 'todo' })
    const b = await create(u.owner, {
      title: 'B',
      spaceId: productId,
      status: 'todo',
      parentId: a.id,
    })
    const c = await req(u.owner, 'POST', '/tasks', {
      title: 'C',
      spaceId: productId,
      parentId: b.id,
    })
    expect(c.status).toBe(422)
    expect((await problemOf(c)).errors?.[0]).toMatchObject({ path: 'parentId' })
    const x = await create(u.owner, { title: 'X', spaceId: productId, status: 'todo' })
    const moveA = await req(u.owner, 'PATCH', `/tasks/${a.id}`, {
      parentId: x.id,
      ifUpdatedAt: a.updatedAt,
    })
    expect(moveA.status).toBe(422) // A 有子任务 B
    const other = await req(u.owner, 'POST', '/tasks', {
      title: 'O',
      spaceId: secretId,
      parentId: a.id,
    })
    expect(other.status).toBe(422) // 跨空间
    const hop = await req(u.owner, 'PATCH', `/tasks/${b.id}`, {
      spaceId: secretId,
      ifUpdatedAt: b.updatedAt,
    })
    expect(hop.status).toBe(422)
    expect((await problemOf(hop)).errors?.[0]).toMatchObject({ path: 'spaceId' })
    // 同时解除父任务则可以换空间
    const ok = await req(u.owner, 'PATCH', `/tasks/${b.id}`, {
      spaceId: secretId,
      parentId: null,
      ifUpdatedAt: b.updatedAt,
    })
    expect(ok.status).toBe(200)
  })

  it('REQ-TASK-014 增删 watcher 影响 task.completed / task.commented 接收者；自己可关注，替别人需写权限且对方可见空间', async () => {
    const t = await create(u.owner, { title: '关注', spaceId: productId, status: 'todo' })
    const add = await req(u.owner, 'POST', `/tasks/${t.id}/watchers`, { userId: u.member2.id })
    expect(add.status).toBe(201)
    const listed = (await add.json()) as { items: { userId: string }[] }
    expect(listed.items.map((w) => w.userId).sort()).toEqual([u.owner.id, u.member2.id].sort())
    const bus = new EventBus()
    const deps = { db: db(), bus, appUrl: 'http://localhost:3010' }
    const completed = () =>
      emit(db(), {
        kind: 'task.completed',
        workspaceId,
        actorId: u.owner.id,
        targetType: 'task',
        targetId: t.id,
        payload: {
          taskId: t.id,
          title: '关注',
          actorId: u.owner.id,
          actorName: 'Owner',
          spaceSlug: 'product',
          completedAt: new Date().toISOString(),
        },
      })
    const notifiedFor = async (ev: string) =>
      (
        await db()
          .select({ u: notifications.userId })
          .from(notifications)
          .where(eq(notifications.eventId, ev))
      ).map((r) => r.u)
    const ev1 = await completed()
    await fanoutEvent(deps, ev1)
    expect(await notifiedFor(ev1)).toEqual([u.member2.id]) // 操作者 owner 自己不收
    const commented = await emit(db(), {
      kind: 'task.commented',
      workspaceId,
      actorId: u.member.id,
      targetType: 'task',
      targetId: t.id,
      payload: {
        taskId: t.id,
        title: '关注',
        commentId: t.id,
        threadId: t.id,
        actorId: u.member.id,
        actorName: 'tm',
        spaceSlug: 'product',
        summary: 'hi',
      },
    })
    await fanoutEvent(deps, commented)
    expect((await notifiedFor(commented)).sort()).toEqual([u.owner.id, u.member2.id].sort())
    // 取消关注后不再收
    expect((await req(u.member2, 'DELETE', `/tasks/${t.id}/watchers/${u.member2.id}`)).status).toBe(
      204,
    )
    const ev2 = await completed()
    await fanoutEvent(deps, ev2)
    expect(await notifiedFor(ev2)).toEqual([])
    // 权限：guest 可关注自己能读的任务，不能替别人；不能加看不到空间的人
    const secret = await create(u.owner, { title: '机密', spaceId: secretId, status: 'todo' })
    expect(
      (await req(u.guest, 'POST', `/tasks/${secret.id}/watchers`, { userId: u.guest.id })).status,
    ).toBe(201)
    expect(
      (await req(u.guest, 'POST', `/tasks/${secret.id}/watchers`, { userId: u.owner.id })).status,
    ).toBe(403)
    const bad = await req(u.owner, 'POST', `/tasks/${secret.id}/watchers`, { userId: u.member.id })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe('userId')
    expect((await req(u.member, 'GET', `/tasks/${secret.id}/watchers`)).status).toBe(404)
  })

  it('REQ-TASK-015 PATCH descriptionPm 后 description_plain 为纯文本、tsv 命中描述词（中文分词）', async () => {
    const t = await create(u.owner, { title: '描述', spaceId: productId, status: 'todo' })
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '准备季度复盘材料 ' },
            { type: 'text', text: 'Roadmap', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    const r = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      descriptionPm: pm,
      ifUpdatedAt: t.updatedAt,
    })
    expect(r.status, await r.clone().text()).toBe(200)
    const [row] = await db()
      .select({ plain: tasks.descriptionPlain })
      .from(tasks)
      .where(eq(tasks.id, t.id))
    expect(row?.plain).toBe('准备季度复盘材料 Roadmap')
    for (const word of ['复盘', 'roadmap', '描述']) {
      const hit = await db().execute<{ id: string }>(
        sql`select id from tasks where id = ${t.id} and tsv @@ to_tsquery('simple', ${tsvText(word).split(' ').filter(Boolean).join(' & ')})`,
      )
      expect(hit.rows, word).toHaveLength(1)
    }
    const miss = await db().execute<{ id: string }>(
      sql`select id from tasks where id = ${t.id} and tsv @@ to_tsquery('simple', ${tsvText('周报')})`,
    )
    expect(miss.rows).toHaveLength(0)
  })
})

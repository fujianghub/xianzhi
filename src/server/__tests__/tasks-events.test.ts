/** T1-004 任务事件 + T1-005 批量（REQ-TASK-002 · 007 · 010 · 016 · 021，api / 集成）。 */
import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { events, notifications, tasks, taskWatchers } from '../db/schema/business.ts'
import { runDueSoon } from '../jobs/dueSoon.ts'
import { EventBus } from '../lib/event-bus.ts'
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
  status: string
  updatedAt: string
  completedAt: string | null
  title: string
}
const H = 3_600_000

describe('T1-004 / T1-005 task events & batch', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'member2' | 'guest', U> = {} as never
  let productId = ''
  let secretId = ''
  const deps = () => ({ db: db(), bus: new EventBus(), appUrl: 'http://localhost:3010' })

  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/tasks', { spaceId: productId, status: 'todo', ...body })
    expect(r.status, await r.clone().text()).toBe(201)
    return (await r.json()) as T
  }
  const eventsOf = (taskId: string, kind: string) =>
    db()
      .select()
      .from(events)
      .where(and(eq(events.targetId, taskId), eq(events.kind, kind)))
  const fanAll = async (taskId: string, kind: string) => {
    for (const e of await eventsOf(taskId, kind)) await fanoutEvent(deps(), e.id)
  }
  const notified = async (taskId: string, kind: string) =>
    (
      await db()
        .select({ u: notifications.userId, title: notifications.title })
        .from(notifications)
        .innerJoin(events, eq(events.id, notifications.eventId))
        .where(and(eq(events.targetId, taskId), eq(notifications.kind, kind)))
    ).map((r) => r)

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
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('em@xz.local', 'member')
    u.member2 = await invite('em2@xz.local', 'member')
    u.guest = await invite('eg@xz.local', 'guest')
    const p = await req(u.owner, 'POST', '/spaces', { name: 'P', slug: 'pp', kind: 'project' })
    productId = ((await p.json()) as { id: string }).id
    expect(productId).toBeTruthy()
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'S',
      slug: 'ss',
      kind: 'work',
      visibility: 'members',
    })
    secretId = ((await s.json()) as { id: string }).id
    expect(secretId).toBeTruthy()
  })

  it('REQ-TASK-007 指派后 events 有 task.assigned 且新指派人在 watchers；新指派人收到通知，自指派不产生通知', async () => {
    const t = await create(u.owner, { title: '指派' })
    const r = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      assigneeId: u.member.id,
      ifUpdatedAt: t.updatedAt,
    })
    expect(r.status).toBe(200)
    const [ev] = await eventsOf(t.id, 'task.assigned')
    expect(ev?.payload).toMatchObject({
      assigneeId: u.member.id,
      actorId: u.owner.id,
      spaceSlug: 'pp',
    })
    const w = await db().select().from(taskWatchers).where(eq(taskWatchers.taskId, t.id))
    expect(w.map((x) => x.userId)).toContain(u.member.id)
    await fanAll(t.id, 'task.assigned')
    expect((await notified(t.id, 'task.assigned')).map((n) => n.u)).toEqual([u.member.id])
    // 自指派：有事件（活动流），无通知
    const self = await create(u.member, { title: '自己的', assigneeId: u.member.id })
    expect(await eventsOf(self.id, 'task.assigned')).toHaveLength(1)
    await fanAll(self.id, 'task.assigned')
    expect(await notified(self.id, 'task.assigned')).toHaveLength(0)
    // 指派给同一人不重复发
    const again = (await r.json()) as T
    await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      assigneeId: u.member.id,
      ifUpdatedAt: again.updatedAt,
    })
    expect(await eventsOf(t.id, 'task.assigned')).toHaveLength(1)
  })

  it('REQ-TASK-002 complete：completed_at 非空、events 有 task.completed、watchers 收到而操作者无通知；已完成再调幂等', async () => {
    const t = await create(u.owner, { title: '完成我', assigneeId: u.member.id })
    await req(u.member2, 'POST', `/tasks/${t.id}/watchers`, { userId: u.member2.id })
    const r = await req(u.member, 'POST', `/tasks/${t.id}/complete`)
    expect(r.status, await r.clone().text()).toBe(200)
    const done = (await r.json()) as T
    expect(done.status).toBe('done')
    expect(done.completedAt).not.toBeNull()
    const [ev] = await eventsOf(t.id, 'task.completed')
    expect(ev?.payload).toMatchObject({ prevStatus: 'todo', actorId: u.member.id })
    await fanAll(t.id, 'task.completed')
    const got = (await notified(t.id, 'task.completed')).map((n) => n.u).sort()
    expect(got).toEqual([u.owner.id, u.member2.id].sort()) // 操作者 member 不收
    expect((await req(u.member, 'POST', `/tasks/${t.id}/complete`)).status).toBe(200)
    expect(await eventsOf(t.id, 'task.completed')).toHaveLength(1)
    // viewer 不能完成
    const s = await create(u.owner, { title: '机密', spaceId: secretId })
    await req(u.owner, 'POST', `/spaces/${secretId}/members`, {
      userId: u.guest.id,
      role: 'viewer',
    })
    expect((await req(u.guest, 'POST', `/tasks/${s.id}/complete`)).status).toBe(403)
  })

  it('REQ-TASK-021 uncomplete 回到 prevStatus、发 task.uncompleted（仅活动流）；5 分钟内的完成通知原地改为「撤销了完成」', async () => {
    const t = await create(u.owner, { title: '撤销我', status: 'doing' })
    await req(u.owner, 'POST', `/tasks/${t.id}/watchers`, { userId: u.member2.id }) // owner 替 member2 加
    await req(u.owner, 'POST', `/tasks/${t.id}/complete`)
    await fanAll(t.id, 'task.completed')
    const r = await req(u.owner, 'POST', `/tasks/${t.id}/uncomplete`)
    expect(r.status).toBe(200)
    const back = (await r.json()) as T
    expect(back.status).toBe('doing')
    expect(back.completedAt).toBeNull()
    const [ev] = await eventsOf(t.id, 'task.uncompleted')
    expect(ev?.payload).toMatchObject({ prevStatus: 'doing' })
    const before = await db().select({ n: sql<number>`count(*)::int` }).from(notifications)
    await fanAll(t.id, 'task.uncompleted')
    const after = await db().select({ n: sql<number>`count(*)::int` }).from(notifications)
    expect(after[0]?.n).toBe(before[0]?.n) // 不新发
    const ns = await notified(t.id, 'task.completed')
    expect(ns.map((n) => n.title)).toEqual([expect.stringContaining('撤销了完成')])
    // 未完成时 uncomplete → 409
    expect((await req(u.owner, 'POST', `/tasks/${t.id}/uncomplete`)).status).toBe(409)
    // PATCH 离开 done 同样发 uncompleted
    const d = (await (await req(u.owner, 'POST', `/tasks/${t.id}/complete`)).json()) as T
    await req(u.owner, 'PATCH', `/tasks/${t.id}`, { status: 'todo', ifUpdatedAt: d.updatedAt })
    expect(await eventsOf(t.id, 'task.uncompleted')).toHaveLength(2)
  })

  it('REQ-TASK-010 截止前 24h 的指派任务发一次 task.due_soon；再跑不重复；改期后到新截止前 24h 再发一次', async () => {
    const now = new Date()
    const t = await create(u.owner, {
      title: '快到期',
      assigneeId: u.member.id,
      dueAt: new Date(now.getTime() + 23 * H).toISOString(),
    })
    await create(u.owner, { title: '没指派', dueAt: new Date(now.getTime() + 2 * H).toISOString() })
    await create(u.owner, {
      title: '还早',
      assigneeId: u.member.id,
      dueAt: new Date(now.getTime() + 30 * H).toISOString(),
    })
    const r1 = await runDueSoon(db(), now)
    expect(r1.emitted).toBe(1)
    expect((await runDueSoon(db(), now)).emitted).toBe(0)
    await fanAll(t.id, 'task.due_soon')
    expect((await notified(t.id, 'task.due_soon')).map((n) => n.u)).toEqual([u.member.id])
    // 改期到 +3 天：现在不发，到新截止前 24h 再发
    const cur = (await (await req(u.owner, 'GET', `/tasks/${t.id}`)).json()) as T
    const newDue = new Date(now.getTime() + 72 * H)
    await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      dueAt: newDue.toISOString(),
      ifUpdatedAt: cur.updatedAt,
    })
    expect((await runDueSoon(db(), now)).emitted).toBe(0)
    const later = new Date(newDue.getTime() - 20 * H)
    expect((await runDueSoon(db(), later)).emitted).toBeGreaterThanOrEqual(1)
    expect(await eventsOf(t.id, 'task.due_soon')).toHaveLength(2)
    // 完成的不发
    const done = await create(u.owner, {
      title: '已完成',
      assigneeId: u.member.id,
      status: 'done',
      dueAt: new Date(now.getTime() + 5 * H).toISOString(),
    })
    await runDueSoon(db(), now)
    expect(await eventsOf(done.id, 'task.due_soon')).toHaveLength(0)
  })

  it('REQ-TASK-016 batch：101 条 422；100 条全部成功逐条返回；其中 1 条无权 → 全部回滚并标出失败项', async () => {
    const ops101 = Array.from({ length: 101 }, (_, i) => ({
      op: 'complete',
      id: crypto.randomUUID(),
      i,
    }))
    expect(
      (
        await req(u.owner, 'POST', '/tasks/batch', {
          ops: ops101.map(({ op, id }) => ({ op, id })),
        })
      ).status,
    ).toBe(422)
    const ts = await Promise.all(
      Array.from({ length: 5 }, (_, i) => create(u.member, { title: `批 ${i}` })),
    )
    const ok = await req(u.member, 'POST', '/tasks/batch', {
      ops: [
        {
          op: 'update',
          id: ts[0]?.id,
          patch: { status: 'doing', sortKey: 'a1', ifUpdatedAt: ts[0]?.updatedAt },
        },
        { op: 'complete', id: ts[1]?.id },
        { op: 'delete', id: ts[2]?.id },
      ],
    })
    expect(ok.status, await ok.clone().text()).toBe(200)
    const body = (await ok.json()) as {
      results: { ok: boolean; status: number; task?: T | null }[]
    }
    expect(body.results.map((x) => x.ok)).toEqual([true, true, true])
    expect(body.results[0]?.task?.status).toBe('doing')
    // 失败回滚：第 2 条是 secret 空间任务（member 不可见 → 404）
    const secret = await create(u.owner, { title: '看不见', spaceId: secretId })
    const bad = await req(u.member, 'POST', '/tasks/batch', {
      ops: [
        { op: 'complete', id: ts[3]?.id },
        { op: 'complete', id: secret.id },
        { op: 'complete', id: ts[4]?.id },
      ],
    })
    expect(bad.status).toBe(404)
    const p = (await problemOf(bad)) as unknown as {
      results: { ok: boolean; index: number; rolledBack?: boolean }[]
    }
    expect(p.results.map((x) => x.ok)).toEqual([true, false, true])
    expect(p.results[0]?.rolledBack).toBe(true)
    const [r3] = await db()
      .select({ s: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, ts[3]?.id ?? ''))
    expect(r3?.s).toBe('todo') // 已回滚
    expect(await eventsOf(ts[3]?.id ?? '', 'task.completed')).toHaveLength(0) // 事件同事务回滚
  })
})

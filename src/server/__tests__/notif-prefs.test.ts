/** T1-027 通知偏好与合并（REQ-NOTIF-006 · 007，api 层）。 */
import { and, eq, isNull } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { events, notifications } from '../db/schema/business.ts'
import { EventBus } from '../lib/event-bus.ts'
import { fanoutEvent } from '../services/notify.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('T1-027 notification preferences', () => {
  let app: App
  const u = { owner: { id: '', cookie: '' }, member: { id: '', cookie: '' } }
  let spaceId = ''
  const deps = { db: db(), bus: new EventBus(), appUrl: 'http://localhost:3010' }
  const req = (who: { cookie: string }, method: string, path: string, b?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: b === undefined ? undefined : JSON.stringify(b),
    })
  /** 把未处理事件全部扇出（等价 outbox → notify.fanout）。 */
  const drain = async () => {
    const rows = await db().select({ id: events.id }).from(events).where(isNull(events.processedAt))
    for (const r of rows) {
      await fanoutEvent(deps, r.id)
      await db().update(events).set({ processedAt: new Date() }).where(eq(events.id, r.id))
    }
  }
  const notifsOf = (userId: string, kind: string) =>
    db()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)))

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    const inv = await req(u.owner, 'POST', '/workspace/invitations', {
      email: 'np@xz.local',
      role: 'member',
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'np@xz.local', name: 'NP', password: 'notif-pass-1' }),
    })
    u.member = {
      id: ((await acc.json()) as { userId: string }).userId,
      cookie: (await signIn(app, 'np@xz.local', 'notif-pass-1')).cookie,
    }
    const s = await req(u.owner, 'POST', '/spaces', { name: 'NP', slug: 'np-space', kind: 'work' })
    spaceId = ((await s.json()) as { id: string }).id
    await drain()
  })

  it('REQ-NOTIF-006 GET 缺行返回默认表；PUT task.completed 通道为空后不再收到', async () => {
    const g = await req(u.owner, 'GET', '/notifications/preferences')
    const prefs = (await g.json()) as {
      items: { eventKind: string; channels: string[]; isDefault: boolean }[]
    }
    const tc = prefs.items.find((p) => p.eventKind === 'task.completed')
    expect(tc?.isDefault).toBe(true)
    expect(tc?.channels).toContain('in_app')

    const mk = async (title: string) =>
      (await (await req(u.owner, 'POST', '/tasks', { title, spaceId, status: 'todo' })).json()) as {
        id: string
      }
    const a = await mk('偏好前')
    await req(u.member, 'POST', `/tasks/${a.id}/complete`)
    await drain()
    expect((await notifsOf(u.owner.id, 'task.completed')).length).toBe(1)

    const put = await req(u.owner, 'PUT', '/notifications/preferences', {
      items: [{ eventKind: 'task.completed', channels: [] }],
    })
    expect(put.status, await put.clone().text()).toBe(200)
    const after = (await put.json()) as typeof prefs
    expect(after.items.find((p) => p.eventKind === 'task.completed')).toMatchObject({
      channels: [],
      isDefault: false,
    })
    // 3 分钟之后另一条任务完成：若偏好无效会新增 / 合并
    await db()
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
    const b = await mk('偏好后')
    await req(u.member, 'POST', `/tasks/${b.id}/complete`)
    await drain()
    const rows = await notifsOf(u.owner.id, 'task.completed')
    expect(rows.length).toBe(1)
    expect(rows[0]?.title).not.toContain('偏好后')
    // 非法 kind / 通道 422；重复 kind 422
    expect(
      (
        await req(u.owner, 'PUT', '/notifications/preferences', {
          items: [{ eventKind: 'x', channels: [] }],
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await req(u.owner, 'PUT', '/notifications/preferences', {
          items: [
            { eventKind: 'task.assigned', channels: ['in_app'] },
            { eventKind: 'task.assigned', channels: [] },
          ],
        })
      ).status,
    ).toBe(422)
    // 整体覆盖：PUT 空数组回到默认
    await req(u.owner, 'PUT', '/notifications/preferences', { items: [] })
    const reset = (await (
      await req(u.owner, 'GET', '/notifications/preferences')
    ).json()) as typeof prefs
    expect(reset.items.every((p) => p.isDefault)).toBe(true)
  })

  it('REQ-NOTIF-007 同一人 3 分钟内在同一线程评论 3 次 → 目标作者 1 条通知，body 为最新；操作者不收', async () => {
    const t = (await (
      await req(u.owner, 'POST', '/tasks', { title: '合并评论', spaceId })
    ).json()) as { id: string }
    const root = await req(u.member, 'POST', '/comments', {
      targetType: 'task',
      targetId: t.id,
      bodyPm: body('第一条'),
    })
    const r0 = (await root.json()) as { id: string; threadId: string }
    for (const text of ['第二条', '第三条'])
      await req(u.member, 'POST', '/comments', {
        targetType: 'task',
        targetId: t.id,
        threadId: r0.threadId,
        parentId: r0.id,
        bodyPm: body(text),
      })
    await drain()
    const rows = (await notifsOf(u.owner.id, 'task.commented')).filter((n) => n.url.includes(t.id))
    expect(rows.length).toBe(1)
    expect(rows[0]?.body ?? '').toContain('第三条')
    expect(
      (await notifsOf(u.member.id, 'task.commented')).filter((n) => n.url.includes(t.id)),
    ).toEqual([])
  })
})

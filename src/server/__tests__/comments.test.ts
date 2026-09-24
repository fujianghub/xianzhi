/** T1-022 / T1-024 评论与提及（REQ-COMMENT-001 · 003 · 005 · 006 · 007）+ 01 §4 默认通道矩阵（REQ-NOTIF-012）。 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { EventKind } from '../../shared/schemas/enums.ts'
import { getDb } from '../db/index.ts'
import {
  comments,
  cycles,
  events,
  mentions,
  notificationDeliveries,
  notifications,
  taskWatchers,
} from '../db/schema/business.ts'
import { EventBus } from '../lib/event-bus.ts'
import { emit } from '../services/events.ts'
import { DEFAULT_CHANNELS, fanoutEvent } from '../services/notify.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface C {
  id: string
  threadId: string
  parentId: string | null
  deleted: boolean
  bodyPm: unknown
  resolvedAt: string | null
  updatedAt: string
}
const doc = (...parts: ({ text: string } | { mention: string })[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: parts.map((p) =>
        'text' in p
          ? { type: 'text', text: p.text }
          : { type: 'mention', attrs: { id: p.mention, label: 'x' } },
      ),
    },
  ],
})

describe('T1-022 comments', () => {
  let app: App
  let workspaceId = ''
  const u: Record<'owner' | 'admin' | 'author' | 'other' | 'guest' | 'outsider', U> = {} as never
  let spaceId = ''
  let taskId = ''
  let entryId = ''
  const deps = () => ({ db: db(), bus: new EventBus(), appUrl: 'http://localhost:3010' })
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const post = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/comments', body)
    expect(r.status, await r.clone().text()).toBe(201)
    return (await r.json()) as C
  }
  async function invite(email: string, role: 'admin' | 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'cmt-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'cmt-password-1')).cookie }
  }
  const fanEvents = async (kind: string, targetId: string) => {
    for (const e of await db()
      .select()
      .from(events)
      .where(and(eq(events.kind, kind), eq(events.targetId, targetId))))
      await fanoutEvent(deps(), e.id)
  }
  const recipients = async (kind: string, targetId: string) =>
    (
      await db()
        .select({ u: notifications.userId })
        .from(notifications)
        .innerJoin(events, eq(events.id, notifications.eventId))
        .where(and(eq(notifications.kind, kind), eq(events.targetId, targetId)))
    )
      .map((r) => r.u)
      .sort()

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.admin = await invite('ca@xz.local', 'admin')
    u.author = await invite('cau@xz.local', 'member')
    u.other = await invite('co@xz.local', 'member')
    u.guest = await invite('cg@xz.local', 'guest')
    u.outsider = await invite('cout@xz.local', 'member')
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'C',
      slug: 'cmt',
      kind: 'work',
      visibility: 'members',
    })
    spaceId = ((await s.json()) as { id: string }).id
    for (const who of [u.author, u.other])
      await req(u.owner, 'POST', `/spaces/${spaceId}/members`, { userId: who.id, role: 'member' })
    await req(u.owner, 'POST', `/spaces/${spaceId}/members`, { userId: u.guest.id, role: 'viewer' })
    taskId = (
      (await (
        await req(u.author, 'POST', '/tasks', { title: '有评论的任务', spaceId })
      ).json()) as { id: string }
    ).id
    entryId = (
      (await (
        await req(u.author, 'POST', '/entries', {
          kind: 'note',
          title: '有评论的记录',
          spaceId,
          visibility: 'space',
        })
      ).json()) as { id: string }
    ).id
  })

  it('REQ-COMMENT-001 可读目标的用户（含 guest viewer）可评论任务与记录；不可读 404；空评论 422；heading 等非子集节点 422', async () => {
    const c = await post(u.guest, {
      targetType: 'task',
      targetId: taskId,
      bodyPm: doc({ text: '访客的意见' }),
    })
    expect(c.threadId).toBe(c.id) // 首条评论即线程
    await post(u.guest, {
      targetType: 'entry',
      targetId: entryId,
      bodyPm: doc({ text: '也评记录' }),
    })
    expect(
      (
        await req(u.outsider, 'POST', '/comments', {
          targetType: 'task',
          targetId: taskId,
          bodyPm: doc({ text: 'x' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await req(u.author, 'POST', '/comments', {
          targetType: 'task',
          targetId: taskId,
          bodyPm: doc({ text: '   ' }),
        })
      ).status,
    ).toBe(422)
    const heading = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
      ],
    }
    expect(
      (
        await req(u.author, 'POST', '/comments', {
          targetType: 'task',
          targetId: taskId,
          bodyPm: heading,
        })
      ).status,
    ).toBe(422)
    const reply = await post(u.author, {
      targetType: 'task',
      targetId: taskId,
      parentId: c.id,
      bodyPm: doc({ text: '回复' }),
    })
    expect(reply.threadId).toBe(c.id)
    const list = (await (
      await req(u.guest, 'GET', `/comments?targetType=task&targetId=${taskId}`)
    ).json()) as { items: C[] }
    expect(list.items.map((x) => x.id)).toEqual([c.id, reply.id])
    expect(
      (await req(u.outsider, 'GET', `/comments?targetType=task&targetId=${taskId}`)).status,
    ).toBe(404)
  })

  it('REQ-COMMENT-005 新评论通知目标作者与线程参与者（除操作者）', async () => {
    const t = (
      (await (await req(u.author, 'POST', '/tasks', { title: '通知评论', spaceId })).json()) as {
        id: string
      }
    ).id
    await db().delete(taskWatchers).where(eq(taskWatchers.taskId, t)) // 只看作者 + 参与者规则
    const first = await post(u.other, {
      targetType: 'task',
      targetId: t,
      bodyPm: doc({ text: '第一条' }),
    })
    await fanEvents('task.commented', t)
    expect(await recipients('task.commented', t)).toEqual([u.author.id]) // 作者收到，操作者 other 不收
    await post(u.admin, {
      targetType: 'task',
      targetId: t,
      parentId: first.id,
      bodyPm: doc({ text: '参与' }),
    })
    const evs = await db()
      .select()
      .from(events)
      .where(
        and(
          eq(events.kind, 'task.commented'),
          eq(events.targetId, t),
          eq(events.actorId, u.admin.id),
        ),
      )
    expect(evs).toHaveLength(1)
    await fanoutEvent(deps(), evs[0]?.id ?? '')
    const got = (
      await db()
        .select({ u: notifications.userId })
        .from(notifications)
        // 同线程 5 分钟内合并（01 §4.1）：被并入旧通知的事件记在 meta.mergedEventIds
        .where(
          sql`${notifications.eventId} = ${evs[0]?.id ?? ''} or ${notifications.meta} -> 'mergedEventIds' ? ${evs[0]?.id ?? ''}`,
        )
    )
      .map((r) => r.u)
      .sort()
    // 目标作者 + 线程参与者（other），操作者 admin 不收
    expect(got).toEqual([u.author.id, u.other.id].sort())
  })

  it('REQ-COMMENT-006 提及写 mentions 并发 mention.created；无权读目标的用户有 mentions 行但无通知', async () => {
    const c = await post(u.author, {
      targetType: 'task',
      targetId: taskId,
      bodyPm: doc(
        { text: '请看 ' },
        { mention: u.other.id },
        { text: ' 和 ' },
        { mention: u.outsider.id },
      ),
    })
    const rows = await db().select().from(mentions).where(eq(mentions.commentId, c.id))
    expect(rows.map((m) => m.userId).sort()).toEqual([u.other.id, u.outsider.id].sort())
    for (const e of await db()
      .select()
      .from(events)
      .where(and(eq(events.kind, 'mention.created'), eq(events.targetId, c.id))))
      await fanoutEvent(deps(), e.id)
    expect(await recipients('mention.created', c.id)).toEqual([u.other.id])
    // 编辑时只对新增的提及发
    const before = (await db().select().from(events).where(eq(events.kind, 'mention.created')))
      .length
    const p = await req(u.author, 'PATCH', `/comments/${c.id}`, {
      bodyPm: doc({ mention: u.other.id }, { mention: u.admin.id }),
      ifUpdatedAt: c.updatedAt,
    })
    expect(p.status).toBe(200)
    expect(
      (await db().select().from(events).where(eq(events.kind, 'mention.created'))).length,
    ).toBe(before + 1)
  })

  it('REQ-COMMENT-003 解决限目标作者 / 评论作者（guest 除外）/ owner/admin：无关 member 403，guest 评论作者 403', async () => {
    const g = await post(u.guest, {
      targetType: 'entry',
      targetId: entryId,
      bodyPm: doc({ text: '访客开的线程' }),
    })
    expect((await req(u.guest, 'POST', `/comments/${g.id}/resolve`)).status).toBe(403)
    expect((await req(u.other, 'POST', `/comments/${g.id}/resolve`)).status).toBe(403)
    const byAuthor = await req(u.author, 'POST', `/comments/${g.id}/resolve`) // 目标（记录）作者
    expect(byAuthor.status).toBe(200)
    expect(
      ((await byAuthor.json()) as { items: C[] }).items.every((x) => x.resolvedAt !== null),
    ).toBe(true)
    expect((await req(u.admin, 'POST', `/comments/${g.id}/unresolve`)).status).toBe(200)
    const mine = await post(u.other, {
      targetType: 'entry',
      targetId: entryId,
      bodyPm: doc({ text: 'other 的线程' }),
    })
    expect((await req(u.other, 'POST', `/comments/${mine.id}/resolve`)).status).toBe(200) // 评论作者
  })

  it('REQ-COMMENT-007 软删有回复的评论：列表保留占位（无正文）与其回复；非作者 member 不能删', async () => {
    const root = await post(u.author, {
      targetType: 'task',
      targetId: taskId,
      bodyPm: doc({ text: '要删的' }),
    })
    const reply = await post(u.other, {
      targetType: 'task',
      targetId: taskId,
      parentId: root.id,
      bodyPm: doc({ text: '回复在' }),
    })
    expect((await req(u.other, 'DELETE', `/comments/${root.id}`)).status).toBe(403)
    expect((await req(u.author, 'DELETE', `/comments/${root.id}`)).status).toBe(204)
    const list = (await (
      await req(u.author, 'GET', `/comments?targetType=task&targetId=${taskId}&limit=200`)
    ).json()) as { items: C[] }
    const ph = list.items.find((x) => x.id === root.id)
    expect(ph).toMatchObject({ deleted: true, bodyPm: null })
    expect(list.items.find((x) => x.id === reply.id)?.deleted).toBe(false)
    expect(
      (
        await req(u.author, 'PATCH', `/comments/${root.id}`, {
          bodyPm: doc({ text: 'x' }),
          ifUpdatedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(403)
    const [row] = await db().select().from(comments).where(eq(comments.id, root.id))
    expect(row?.deletedAt).not.toBeNull()
  })

  it('REQ-NOTIF-012 01 §4 每种有默认通道的 kind 各触发一次：接收者的投递通道集合 = 默认通道去掉 sse', async () => {
    const R = u.admin // 工作区 admin：可读一切，能收到「给 admin」类事件
    const O = u.owner
    await db().insert(taskWatchers).values({ taskId, userId: R.id }).onConflictDoNothing()
    const rEntry = (
      (await (
        await req(R, 'POST', '/entries', {
          kind: 'note',
          title: 'R 的记录',
          spaceId,
          visibility: 'space',
        })
      ).json()) as { id: string }
    ).id
    const [cyc] = await db()
      .insert(cycles)
      .values({
        workspaceId,
        ownerId: R.id,
        kind: 'week',
        startDate: '2026-09-21',
        endDate: '2026-09-27',
        title: '第 1 周',
      })
      .returning({ id: cycles.id })
    const base = { workspaceId, actorId: O.id }
    const evs: Record<string, Parameters<typeof emit>[1]> = {
      'task.assigned': {
        ...base,
        kind: 'task.assigned',
        targetType: 'task',
        targetId: taskId,
        payload: {
          taskId,
          title: 't',
          actorId: O.id,
          actorName: 'O',
          assigneeId: R.id,
          spaceSlug: 'cmt',
        },
      },
      'task.unassigned': {
        ...base,
        kind: 'task.unassigned',
        targetType: 'task',
        targetId: taskId,
        visibilityScope: { spaceId: 'x' as never },
        payload: {
          taskId,
          title: 't',
          prevAssigneeId: u.other.id,
          prevAssigneeName: 'o',
          reason: 'member_removed',
          spaceSlug: 'cmt',
        },
      },
      'task.due_soon': {
        workspaceId,
        actorId: null,
        kind: 'task.due_soon',
        targetType: 'task',
        targetId: taskId,
        payload: {
          taskId,
          title: 't',
          assigneeId: R.id,
          spaceSlug: 'cmt',
          dueAt: new Date().toISOString(),
          hoursLeft: 3,
        },
      },
      'task.completed': {
        ...base,
        kind: 'task.completed',
        targetType: 'task',
        targetId: taskId,
        payload: {
          taskId,
          title: 't',
          actorId: O.id,
          actorName: 'O',
          spaceSlug: 'cmt',
          completedAt: new Date().toISOString(),
        },
      },
      'task.commented': {
        ...base,
        kind: 'task.commented',
        targetType: 'task',
        targetId: taskId,
        payload: {
          taskId,
          title: 't',
          commentId: taskId,
          threadId: taskId,
          actorId: O.id,
          actorName: 'O',
          spaceSlug: 'cmt',
          summary: 's',
        },
      },
      'entry.commented': {
        ...base,
        kind: 'entry.commented',
        targetType: 'entry',
        targetId: rEntry,
        payload: {
          entryId: rEntry,
          title: 'e',
          commentId: rEntry,
          threadId: rEntry,
          actorId: O.id,
          actorName: 'O',
          summary: 's',
        },
      },
      'mention.created': {
        ...base,
        kind: 'mention.created',
        targetType: 'entry',
        targetId: rEntry,
        visibilityScope: { userIds: [R.id] },
        payload: {
          targetType: 'entry',
          targetId: rEntry,
          title: 'e',
          actorId: O.id,
          actorName: 'O',
          summary: 's',
          url: `/entries/${rEntry}`,
        },
      },
      'space.invited': {
        ...base,
        kind: 'space.invited',
        targetType: 'space',
        targetId: spaceId,
        visibilityScope: { userIds: [R.id] },
        payload: {
          spaceId,
          spaceName: 'C',
          spaceSlug: 'cmt',
          actorId: O.id,
          actorName: 'O',
          role: 'member',
        },
      },
      'member.joined': {
        ...base,
        kind: 'member.joined',
        targetType: 'member',
        targetId: null,
        payload: {
          userId: u.other.id,
          displayName: 'o',
          email: 'co@xz.local',
          role: 'member',
          inviterId: O.id,
          inviterName: 'O',
        },
      },
      'workspace.owner_transferred': {
        ...base,
        kind: 'workspace.owner_transferred',
        targetType: 'member',
        targetId: null,
        payload: { fromUserId: O.id, fromName: 'O', toUserId: R.id, toName: 'R' },
      },
      'cycle.review_due': {
        workspaceId,
        actorId: null,
        kind: 'cycle.review_due',
        targetType: 'cycle',
        targetId: cyc?.id,
        payload: {
          cycleId: cyc?.id as string,
          kind: 'week',
          title: '第 1 周',
          ownerId: R.id,
          startDate: '2026-09-21',
          endDate: '2026-09-27',
          doneCount: 1,
          totalCount: 2,
        },
      },
      'system.export_done': {
        workspaceId,
        actorId: null,
        kind: 'system.export_done',
        targetType: 'job',
        targetId: null,
        visibilityScope: { userIds: [R.id] },
        payload: {
          jobId: 'j',
          scope: 'workspace',
          format: 'md',
          fileName: 'x.zip',
          sizeBytes: 1,
          expiresAt: new Date().toISOString(),
        },
      },
      'system.backup_failed': {
        workspaceId,
        actorId: null,
        kind: 'system.backup_failed',
        targetType: 'system',
        targetId: null,
        payload: { jobId: 'j', backupDate: '2026-09-24', errorCode: 'E', errorSummary: 'boom' },
      },
      'system.outbox_stalled': {
        workspaceId,
        actorId: null,
        kind: 'system.outbox_stalled',
        targetType: 'system',
        targetId: null,
        payload: {
          oldestEventId: taskId,
          oldestCreatedAt: new Date().toISOString(),
          pendingCount: 3,
        },
      },
    }
    // task.unassigned 的接收者是空间 admin：让 R 成为空间 admin
    await req(O, 'POST', `/spaces/${spaceId}/members`, { userId: R.id, role: 'admin' })
    evs['task.unassigned'] = {
      ...(evs['task.unassigned'] as object),
      visibilityScope: { spaceId },
    } as never
    const kinds = (Object.keys(DEFAULT_CHANNELS) as EventKind[]).filter(
      (k) => (DEFAULT_CHANNELS[k] ?? []).length > 0,
    )
    expect(kinds.sort()).toEqual(Object.keys(evs).sort())
    for (const k of kinds) {
      await db().delete(notifications).where(eq(notifications.userId, R.id))
      const ev = await emit(db(), evs[k] as Parameters<typeof emit>[1])
      await fanoutEvent(deps(), ev)
      const [n] = await db()
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, R.id), eq(notifications.eventId, ev)))
      expect(n, `${k} 应通知 R`).toBeDefined()
      const d = await db()
        .select({ ch: notificationDeliveries.channel })
        .from(notificationDeliveries)
        .where(inArray(notificationDeliveries.notificationId, [n?.id ?? '']))
      const expected = (DEFAULT_CHANNELS[k] ?? []).filter((c) => c !== 'sse').sort()
      expect(d.map((x) => x.ch).sort(), k).toEqual(expected)
    }
  })

  it('problem：不存在的评论 404', async () => {
    const r = await req(u.author, 'POST', `/comments/${crypto.randomUUID()}/resolve`)
    expect(r.status).toBe(404)
    expect((await problemOf(r)).code).toBe('NOT_FOUND')
  })
})

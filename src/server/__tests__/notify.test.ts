/** T0-024：事件出箱与扇出（REQ-NOTIF-001 · 002 · 011 · 014 · 016）。 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, isNotNull } from 'drizzle-orm'
import pino from 'pino'
import { v7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyYdoc } from '../../collab/derive.ts'
import { getDb, getPool } from '../db/index.ts'
import {
  entries,
  events,
  notificationDeliveries,
  notifications,
  spaces,
  tasks,
} from '../db/schema/business.ts'
import { startWorker } from '../jobs/index.ts'
import { checkStalled, drainOnce } from '../jobs/outbox.ts'
import { EventBus } from '../lib/event-bus.ts'
import { emit } from '../services/events.ts'
import { fanoutEvent, sendNotificationEmail } from '../services/notify.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, mailbox, OWNER, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
const APP = 'http://localhost:3010'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('outbox & fanout', () => {
  let ownerId = ''
  let workspaceId = ''
  let memberId = ''
  let spaceId = ''
  const bus = new EventBus()
  const frames: { userId: string; frame: { type: string; data: { title: string } } }[] = []

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    ownerId = r.userId
    workspaceId = r.workspaceId
    const app = buildApp().app
    const cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const inv = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ email: 'm@xz.local', role: 'member' }),
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'm@xz.local', name: 'M', password: 'member-password-1' }),
    })
    memberId = ((await acc.json()) as { userId: string }).userId
    spaceId = v7()
    await db().insert(spaces).values({
      id: spaceId,
      workspaceId,
      name: '公共',
      slug: 'pub',
      kind: 'work',
      visibility: 'workspace',
      sortKey: 'a1',
      createdBy: ownerId,
    })
    bus.subscribe('notify', (f) => frames.push(f as (typeof frames)[number]))
    // 清掉邀请产生的 member.joined 事件，避免干扰
    await db().update(events).set({ processedAt: new Date() })
  })

  const mkTask = async () => {
    const id = v7()
    await db().insert(tasks).values({
      id,
      workspaceId,
      spaceId,
      title: '写周报',
      creatorId: ownerId,
      assigneeId: memberId,
      sortKey: 'a0',
    })
    return id
  }
  const assign = (taskId: string) =>
    emit(db(), {
      kind: 'task.assigned',
      workspaceId,
      actorId: ownerId,
      targetType: 'task',
      targetId: taskId,
      payload: {
        taskId,
        title: '写周报',
        actorId: ownerId,
        actorName: 'Owner',
        assigneeId: memberId,
        spaceSlug: 'pub',
      },
    })

  it('REQ-NOTIF-001 业务事务回滚 → 无事件行', async () => {
    const before = (await db().select().from(events)).length
    await expect(
      db().transaction(async (tx) => {
        await emit(tx, {
          kind: 'member.joined',
          workspaceId,
          actorId: memberId,
          targetType: 'member',
          payload: {
            userId: memberId,
            displayName: 'M',
            email: 'm@xz.local',
            role: 'member',
            inviterId: ownerId,
            inviterName: 'Owner',
          },
        })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect((await db().select().from(events)).length).toBe(before)
    // payload 不符 schema → 在事务内抛错
    await expect(
      emit(db(), {
        kind: 'task.assigned',
        workspaceId,
        targetType: 'task',
        payload: { taskId: 'x' },
      } as never),
    ).rejects.toThrow()
  })

  it('REQ-NOTIF-016 同一事件 notify.fanout 重跑 3 次 → notifications 1 行、投递不重复；REQ-NOTIF-002 SSE 帧推给指派人', async () => {
    const taskId = await mkTask()
    const evId = await assign(taskId)
    const deps = { db: db(), bus, appUrl: APP }
    const r1 = await fanoutEvent(deps, evId)
    await fanoutEvent(deps, evId)
    await fanoutEvent(deps, evId)
    expect(r1).toMatchObject({ recipients: 1, inserted: 1 })
    const rows = await db().select().from(notifications).where(eq(notifications.eventId, evId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: memberId,
      kind: 'task.assigned',
      title: 'Owner 把任务 写周报 指派给你',
      url: `/spaces/pub/tasks/${taskId}`,
    })
    const del = await db()
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, rows[0]?.id ?? ''))
    expect(del.map((d) => `${d.channel}:${d.status}`).sort()).toEqual([
      'in_app:sent',
      'webpush:skipped',
    ])
    expect(
      frames.filter((f) => f.userId === memberId && f.frame.type === 'notification'),
    ).toHaveLength(1)
    expect(
      frames.filter((f) => f.userId === memberId && f.frame.type === 'invalidate'),
    ).toHaveLength(1)
  })

  it('REQ-NOTIF-011 提及无 entry.read 的用户 → 无 notification 行；操作者不收自己的', async () => {
    const entryId = v7()
    await db().insert(entries).values({
      id: entryId,
      workspaceId,
      spaceId,
      kind: 'note',
      title: '私密',
      visibility: 'private',
      authorId: ownerId,
      ydoc: emptyYdoc(),
    })
    const evId = await emit(db(), {
      kind: 'mention.created',
      workspaceId,
      actorId: ownerId,
      targetType: 'entry',
      targetId: entryId,
      visibilityScope: { userIds: [memberId, ownerId] },
      payload: {
        targetType: 'entry',
        targetId: entryId,
        title: '私密',
        actorId: ownerId,
        actorName: 'Owner',
        summary: '@M 看一下',
        url: `/entries/${entryId}`,
      },
    })
    const r = await fanoutEvent({ db: db(), bus, appUrl: APP }, evId)
    expect(r).toMatchObject({ recipients: 1, inserted: 0, skipped: 1 })
    expect(
      await db().select().from(notifications).where(eq(notifications.eventId, evId)),
    ).toHaveLength(0)
  })

  it('01 §4 合并：同一成员离开导致的多条 task.unassigned 合并为 1 条「n 个任务待重新指派」；邮件通道（owner_transferred）', async () => {
    const mk = async () => {
      const taskId = await mkTask()
      return emit(db(), {
        kind: 'task.unassigned',
        workspaceId,
        targetType: 'task',
        targetId: taskId,
        visibilityScope: { spaceId },
        payload: {
          taskId,
          title: 't',
          prevAssigneeId: memberId,
          prevAssigneeName: 'M',
          reason: 'member_removed',
          spaceSlug: 'pub',
        },
      })
    }
    const deps = { db: db(), bus, appUrl: APP }
    await fanoutEvent(deps, await mk())
    await fanoutEvent(deps, await mk())
    const rows = await db()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ownerId), eq(notifications.kind, 'task.unassigned')))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('M 离开，2 个任务待重新指派')
    mailbox.length = 0
    const ev = await emit(db(), {
      kind: 'workspace.owner_transferred',
      workspaceId,
      actorId: ownerId,
      targetType: 'member',
      payload: { fromUserId: ownerId, fromName: 'Owner', toUserId: memberId, toName: 'M' },
    })
    const fr = await fanoutEvent(deps, ev)
    expect(fr.emailNotificationIds).toHaveLength(1)
    for (const nid of fr.emailNotificationIds) await sendNotificationEmail(deps, nid)
    expect(mailbox.map((m) => m.to)).toEqual(['m@xz.local'])
    expect(mailbox[0]?.text).toContain(`${APP}/settings/workspace`)
    expect(mailbox[0]?.text).not.toMatch(/token=/)
    const [n] = await db().select().from(notifications).where(eq(notifications.eventId, ev))
    const d = await db()
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, n?.id ?? ''))
    expect(d.find((x) => x.channel === 'email')?.status).toBe('sent')
  })

  it('REQ-NOTIF-001 drainOnce：FOR UPDATE SKIP LOCKED 取批、标 processed_at；> 1 小时积压 → system.outbox_stalled 同日一条', async () => {
    await db().update(events).set({ processedAt: new Date() })
    const old = await emit(db(), {
      kind: 'member.joined',
      workspaceId,
      actorId: memberId,
      targetType: 'member',
      payload: {
        userId: memberId,
        displayName: 'M',
        email: 'm@xz.local',
        role: 'member',
        inviterId: ownerId,
        inviterName: 'Owner',
      },
    })
    await db()
      .update(events)
      .set({ createdAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(events.id, old))
    const ctx = { db: db(), dataDir: './data', databaseUrl: '', logger: pino({ level: 'silent' }) }
    expect(await checkStalled(ctx)).toBe(true)
    expect(await checkStalled(ctx)).toBe(true)
    expect(
      await db().select().from(events).where(eq(events.kind, 'system.outbox_stalled')),
    ).toHaveLength(1)
    const handled: string[] = []
    const n = await drainOnce(getPool(), undefined, async (id) => handled.push(id))
    expect(n).toBe(2)
    expect(handled).toContain(old)
    expect(await db().select().from(events).where(isNotNull(events.processedAt))).toHaveLength(
      (await db().select().from(events)).length,
    )
  })

  describe('with pg-boss worker', () => {
    let stop: (() => Promise<void>) | undefined
    beforeAll(async () => {
      const w = await startWorker(
        {
          db: db(),
          dataDir: './data',
          databaseUrl: process.env.DATABASE_URL as string,
          appUrl: APP,
          logger: pino({ level: process.env.XZ_JOB_LOG ?? 'silent' }),
          bus,
        },
        { schedule: false },
      )
      stop = w.stop
    })
    afterAll(async () => {
      await stop?.()
    })

    it('REQ-NOTIF-001 写入后 ≤ 6s processed_at 非空；REQ-NOTIF-002 指派人收到 notification 行与 SSE 帧', async () => {
      frames.length = 0
      const taskId = await mkTask()
      const t0 = Date.now()
      const evId = await assign(taskId)
      let processed = false
      let notified = false
      while (Date.now() - t0 < 6000 && !(processed && notified)) {
        const [e] = await db()
          .select({ p: events.processedAt })
          .from(events)
          .where(eq(events.id, evId))
        processed = !!e?.p
        notified =
          (await db().select().from(notifications).where(eq(notifications.eventId, evId)))
            .length === 1
        await sleep(100)
      }
      expect(processed).toBe(true)
      expect(notified).toBe(true)
      expect(Date.now() - t0).toBeLessThan(2000) // 提交后 NOTIFY xz_outbox 即时接力；5s 自循环只是兜底
      expect(frames.some((f) => f.userId === memberId)).toBe(true)
    }, 15_000)
  })

  it('REQ-NOTIF-014 routes 与 client 无 notifications 写入、无发信调用（静态扫描）', () => {
    const scan = (dir: string): string[] => {
      const out: string[] = []
      let names: string[] = []
      try {
        names = readdirSync(dir)
      } catch {
        return out
      }
      for (const n of names) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) out.push(...scan(p))
        else if (/\.tsx?$/.test(n)) out.push(p)
      }
      return out
    }
    const root = new URL('../../', import.meta.url).pathname
    const files = [...scan(join(root, 'server/routes')), ...scan(join(root, 'client'))]
    expect(files.length).toBeGreaterThan(3)
    const bad =
      /insert\(\s*notifications|update\(\s*notifications|notificationDeliveries|sendMail\(|sendWorkspaceInvitation\(|nodemailer|fanoutEvent\(/
    const hits = files.filter((f) => bad.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

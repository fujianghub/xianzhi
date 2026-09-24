/**
 * 事件出箱接力（01 §3.10、07 §2.8、REQ-NOTIF-001）：`outbox.drain` 是自循环作业（非 cron）。
 * 每次：pg 事务内 `FOR UPDATE SKIP LOCKED` 取 ≤ 200 条未处理事件 → 同一事务里 send('notify.fanout', singletonKey=event.id) → 标 processed_at；
 * 末尾 send 自身 startAfter 5s（批满则立即续跑）。另检测 > 1 小时未处理的事件，发 system.outbox_stalled（同日只一条）。
 */
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type pg from 'pg'
import type { PgBoss } from 'pg-boss'
import { getPool } from '../db/index.ts'
import { member } from '../db/schema/auth.ts'
import { events } from '../db/schema/business.ts'
import { emit } from '../services/events.ts'
import { fanoutEvent, sendNotificationEmail } from '../services/notify.ts'
import type { JobCtx, JobDef } from './types.ts'

export const OUTBOX_BATCH = 200
export const OUTBOX_CHANNEL = 'xz_outbox'

/**
 * LISTEN xz_outbox（触发器在 events 插入的事务提交后发出）→ 50ms 防抖后 drainOnce；与 5s 自循环并存，SKIP LOCKED 保证不重复。
 */
export async function listenOutbox(
  connectionString: string,
  drain: () => Promise<unknown>,
  onError: (e: unknown) => void,
): Promise<() => Promise<void>> {
  const pg = (await import('pg')).default
  const client = new pg.Client({ connectionString })
  await client.connect()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  const run = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        await drain()
      } while (again)
    } catch (e) {
      onError(e)
    } finally {
      running = false
    }
  }
  client.on('notification', (m) => {
    if (m.channel !== OUTBOX_CHANNEL) return
    clearTimeout(timer)
    timer = setTimeout(() => void run(), 50)
  })
  client.on('error', onError)
  await client.query(`listen ${OUTBOX_CHANNEL}`)
  return async () => {
    clearTimeout(timer)
    await client.end()
  }
}
export const DRAIN_INTERVAL_S = 5
export const STALL_MS = 60 * 60 * 1000

/** 单批接力；返回处理条数。boss 为空时（单元测试）直接同步扇出。 */
export async function drainOnce(
  pool: pg.Pool,
  boss: PgBoss | undefined,
  direct?: (eventId: string) => Promise<unknown>,
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const r = await client.query<{ id: string }>(
      `select id from events where processed_at is null order by created_at, id limit $1 for update skip locked`,
      [OUTBOX_BATCH],
    )
    const ids = r.rows.map((x) => x.id)
    if (boss) {
      const db = {
        executeSql: (text: string, values?: unknown[]) => client.query(text, values as unknown[]),
      }
      for (const id of ids)
        await boss.send('notify.fanout', { eventId: id }, { singletonKey: id, db })
    }
    if (ids.length)
      await client.query(`update events set processed_at = now() where id = any($1::uuid[])`, [ids])
    await client.query('commit')
    if (!boss && direct) for (const id of ids) await direct(id)
    return ids.length
  } catch (err) {
    await client.query('rollback').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/** > 1 小时未处理 → system.outbox_stalled 给所有 admin；同日已有则更新 pendingCount（01 §4.1）。 */
export async function checkStalled(ctx: JobCtx, now = new Date()): Promise<boolean> {
  const db = ctx.db
  const [agg] = await db
    .select({
      n: sql<number>`count(*)::int`,
      oldestId: sql<string>`(array_agg(${events.id} order by ${events.createdAt}))[1]`,
      oldestAt: sql<Date>`min(${events.createdAt})`,
      ws: sql<string>`min(${events.workspaceId})`,
    })
    .from(events)
    .where(
      and(
        isNull(events.processedAt),
        lt(events.createdAt, new Date(now.getTime() - STALL_MS)),
        sql`${events.kind} <> 'system.outbox_stalled'`,
      ),
    )
  if (!agg?.n) return false
  const payload = {
    oldestEventId: agg.oldestId,
    oldestCreatedAt: new Date(agg.oldestAt).toISOString(),
    pendingCount: agg.n,
  }
  const dayStart = new Date(now.toISOString().slice(0, 10))
  const updated = await db
    .update(events)
    .set({ payload })
    .where(and(eq(events.kind, 'system.outbox_stalled'), gte(events.createdAt, dayStart)))
    .returning({ id: events.id })
  if (updated.length) return true
  const adminIds = (
    await db
      .select({ id: member.userId })
      .from(member)
      .where(inArray(member.role, ['owner', 'admin']))
  ).map((r) => r.id)
  await emit(db, {
    kind: 'system.outbox_stalled',
    workspaceId: agg.ws,
    actorId: null,
    targetType: 'system',
    targetId: null,
    visibilityScope: { userIds: adminIds },
    payload,
  })
  return true
}

export const OUTBOX_JOBS: JobDef[] = [
  {
    name: 'outbox.drain',
    policy: 'stately',
    retryLimit: 0,
    handler: async (ctx) => {
      const pool = ctx.pool ?? getPool()
      const n = await drainOnce(
        pool,
        ctx.boss,
        ctx.boss
          ? undefined
          : (id) => fanoutEvent({ db: ctx.db, bus: ctx.bus, appUrl: ctx.appUrl ?? '' }, id),
      )
      await checkStalled(ctx)
      if (ctx.boss)
        await ctx.boss.send(
          'outbox.drain',
          {},
          { singletonKey: 'outbox.drain', startAfter: n >= OUTBOX_BATCH ? 0 : DRAIN_INTERVAL_S },
        )
      return { drained: n }
    },
  },
  {
    name: 'notify.fanout',
    policy: 'standard',
    retryLimit: 3,
    handler: async (ctx, data) => {
      const r = await fanoutEvent(
        { db: ctx.db, bus: ctx.bus, appUrl: ctx.appUrl ?? '' },
        String(data.eventId ?? ''),
      )
      for (const id of r.emailNotificationIds) {
        if (ctx.boss)
          await ctx.boss.send(
            'notify.email',
            { notificationId: id },
            { singletonKey: `email:${id}` },
          )
        else await sendNotificationEmail({ db: ctx.db, appUrl: ctx.appUrl ?? '' }, id)
      }
      return r
    },
  },
  {
    name: 'notify.email',
    policy: 'standard',
    retryLimit: 3,
    handler: async (ctx, data) =>
      sendNotificationEmail(
        { db: ctx.db, appUrl: ctx.appUrl ?? '' },
        String(data.notificationId ?? ''),
      ),
  },
]

/** T0-026 作业清单（REQ-OPS-007）与 T0-027 备份恢复（REQ-EXPORT-005）。 */
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { generateX25519Identity, identityToRecipient } from 'age-encryption'
import { count, eq, sql } from 'drizzle-orm'
import pino from 'pino'
import { v7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyYdoc } from '../../collab/derive.ts'
import { getDb } from '../db/index.ts'
import { user } from '../db/schema/auth.ts'
import {
  attachments,
  auditLog,
  entries,
  events,
  idempotencyKeys,
  notificationDeliveries,
  notifications,
  spaces,
} from '../db/schema/business.ts'
import { BOSS_SCHEMA, JOBS, type JobCtx, runJob, startWorker } from '../jobs/index.ts'
import { runBackup, runRestore, tableCounts } from '../services/backup.ts'
import { truncateAll } from './db.ts'
import { seedOwner } from './helpers.ts'

const db = () => getDb()
const DAY = 86_400_000
const DATA = './data/test-jobs'
const URL_ = process.env.DATABASE_URL as string
const ctx = (): JobCtx => ({
  db: db(),
  dataDir: DATA,
  databaseUrl: URL_,
  logger: pino({ level: 'silent' }),
})
const EXPECTED = [
  'gc.soft-deleted',
  'gc.idempotency',
  'gc.attachments',
  'gc.snapshots',
  'gc.events',
  'gc.notifications',
  'gc.deliveries',
  'gc.exports',
  'derive.retry',
  'backup.daily',
]

describe('jobs', () => {
  let workspaceId = ''
  let userId = ''
  let spaceId = ''
  beforeAll(async () => {
    await truncateAll()
    await rm(DATA, { recursive: true, force: true })
    const r = await seedOwner()
    workspaceId = r.workspaceId
    userId = r.userId
    const [ps] = await db().select().from(spaces).where(eq(spaces.isPersonal, true))
    spaceId = ps?.id ?? ''
  })
  afterAll(async () => {
    await rm(DATA, { recursive: true, force: true })
  })

  it('REQ-OPS-007 每个作业名注册（07 §3 名称）并有队列；worker 可启停', async () => {
    expect(JOBS.map((j) => j.name)).toEqual(expect.arrayContaining(EXPECTED))
    const w = await startWorker(
      { db: db(), dataDir: DATA, databaseUrl: URL_, logger: pino({ level: 'silent' }) },
      { schedule: true },
    )
    const queues = await w.boss.getQueues()
    expect(queues.map((q) => q.name)).toEqual(expect.arrayContaining(EXPECTED))
    const sched = await db().execute<{ name: string }>(
      sql.raw(`select name from ${BOSS_SCHEMA}.schedule`),
    )
    expect(sched.rows.map((r) => r.name)).toEqual(expect.arrayContaining(EXPECTED))
    await w.stop()
  })

  it('REQ-OPS-007 构造过期 / 未过期数据：各 gc 作业只删过期的，连跑两次幂等', async () => {
    const now = Date.now()
    // 软删记录：31 天前（删）/ 29 天前（留）
    const oldE = v7()
    const newE = v7()
    for (const [id, days] of [
      [oldE, 31],
      [newE, 29],
    ] as const) {
      await db()
        .insert(entries)
        .values({
          id,
          workspaceId,
          spaceId,
          kind: 'note',
          title: id,
          visibility: 'space',
          authorId: userId,
          ydoc: emptyYdoc(),
          deletedAt: new Date(now - days * DAY),
        })
    }
    // 幂等键：25h（删）/ 23h（留）
    await db()
      .insert(idempotencyKeys)
      .values([
        {
          key: v7(),
          userId,
          responseStatus: 201,
          responseBody: {},
          createdAt: new Date(now - 25 * 3600_000),
        },
        {
          key: v7(),
          userId,
          responseStatus: 201,
          responseBody: {},
          createdAt: new Date(now - 23 * 3600_000),
        },
      ])
    // 孤儿附件：8 天（删，含文件）/ 6 天（留）
    mkdirSync(join(DATA, 'uploads'), { recursive: true })
    const oldKey = 'uploads/old.png'
    writeFileSync(join(DATA, oldKey), 'x')
    await db()
      .insert(attachments)
      .values([
        {
          workspaceId,
          ownerId: userId,
          filename: 'old.png',
          mime: 'image/png',
          size: 1,
          sha256: 'a',
          storageKey: oldKey,
          createdAt: new Date(now - 8 * DAY),
        },
        {
          workspaceId,
          ownerId: userId,
          filename: 'new.png',
          mime: 'image/png',
          size: 1,
          sha256: 'b',
          storageKey: 'uploads/new.png',
          createdAt: new Date(now - 6 * DAY),
        },
      ])
    // 事件：181 天已处理且无通知（删）/ 181 天但被通知引用（留）/ 10 天（留）
    const mkEvent = async (daysAgo: number) => {
      const id = v7()
      await db()
        .insert(events)
        .values({
          id,
          workspaceId,
          kind: 'entry.updated',
          targetType: 'entry',
          payload: {},
          createdAt: new Date(now - daysAgo * DAY),
          processedAt: new Date(now - daysAgo * DAY),
        })
      return id
    }
    await mkEvent(181)
    const referenced = await mkEvent(181)
    await mkEvent(10)
    // 通知：已读 91 天（归档）/ 被引用事件上的未读（永久）
    const [n] = await db()
      .insert(notifications)
      .values({
        userId,
        eventId: referenced,
        kind: 'entry.updated',
        title: 't',
        url: '/',
        readAt: new Date(now - 91 * DAY),
      })
      .returning({ id: notifications.id })
    await db()
      .insert(notificationDeliveries)
      .values([
        {
          notificationId: n?.id ?? '',
          channel: 'in_app',
          status: 'sent',
          createdAt: new Date(now - 31 * DAY),
        },
        {
          notificationId: n?.id ?? '',
          channel: 'in_app',
          status: 'sent',
          createdAt: new Date(now - 1 * DAY),
        },
      ])
    // 导出文件：8 天前（删）/ 刚刚（留）
    mkdirSync(join(DATA, 'exports'), { recursive: true })
    writeFileSync(join(DATA, 'exports', 'old.zip'), 'x')
    writeFileSync(join(DATA, 'exports', 'new.zip'), 'x')
    const eightDays = (now - 8 * DAY) / 1000
    utimesSync(join(DATA, 'exports', 'old.zip'), eightDays, eightDays)

    const first: Record<string, unknown> = {}
    for (const name of EXPECTED.filter((n) => n !== 'backup.daily'))
      first[name] = await runJob(name, ctx())
    expect(first['gc.soft-deleted']).toMatchObject({ entries: 1 })
    expect(first['gc.idempotency']).toBe(1)
    expect(first['gc.attachments']).toBe(1)
    expect(first['gc.events']).toBe(1)
    expect(first['gc.notifications']).toEqual({ archived: 1, deleted: 0 })
    expect(first['gc.deliveries']).toBe(1)
    expect(first['gc.exports']).toBe(1)
    expect(existsSync(join(DATA, oldKey))).toBe(false)
    expect((await db().select({ id: entries.id }).from(entries)).map((r) => r.id)).toEqual([newE])
    expect((await db().select({ n: count() }).from(idempotencyKeys))[0]?.n).toBe(1)
    expect((await db().select({ n: count() }).from(events))[0]?.n).toBe(2)
    expect(existsSync(join(DATA, 'exports', 'new.zip'))).toBe(true)

    // 第二次：全部 0（幂等）
    for (const name of EXPECTED.filter((n) => n.startsWith('gc.') || n === 'derive.retry')) {
      const r = await runJob(name, ctx())
      const zero =
        typeof r === 'number'
          ? r === 0
          : Object.values(r as Record<string, number>).every((v) => v === 0)
      expect(zero, `${name} second run ${JSON.stringify(r)}`).toBe(true)
    }
    await expect(runJob('gc.nope', ctx())).rejects.toThrow(/未知作业/)
  })

  it('REQ-EXPORT-005 xz backup 产出 .dump.age，可用私钥恢复到 xz_verify 且行数一致；session 被清空', async () => {
    const identity = await generateX25519Identity()
    const recipient = await identityToRecipient(identity)
    const r = await runBackup({
      db: db(),
      databaseUrl: URL_,
      dataDir: DATA,
      ageRecipient: recipient,
    })
    expect(r.file).toMatch(/xz-\d{8}\.dump\.age$/)
    expect((await stat(r.file)).size).toBeGreaterThan(1000)
    const head = (await readFile(r.file)).subarray(0, 21).toString()
    expect(head).toBe('age-encryption.org/v1') // 不是明文 dump
    const source = await tableCounts(URL_)
    const restored = await runRestore({
      file: r.file,
      identity,
      sourceUrl: URL_,
      targetDb: 'xz_verify',
    })
    expect(restored.counts).toEqual(source)
    const verifyUrl = new URL(URL_)
    verifyUrl.pathname = '/xz_verify'
    const pg = (await import('pg')).default
    const c = new pg.Client({ connectionString: verifyUrl.toString() })
    await c.connect()
    expect((await c.query('select count(*)::int n from "session"')).rows[0].n).toBe(0)
    await c.end()
    await expect(
      runRestore({ file: r.file, identity, sourceUrl: URL_, targetDb: 'xz_test' }),
    ).rejects.toThrow(/拒绝恢复/)
  })

  it('REQ-EXPORT-005 备份失败（缺 AGE_RECIPIENT）→ audit backup.failed + events system.backup_failed 发给 admin', async () => {
    await expect(runJob('backup.daily', ctx(), {}, 'job-1')).rejects.toThrow(/AGE_RECIPIENT/)
    const a = await db().select().from(auditLog).where(eq(auditLog.action, 'backup.failed'))
    expect(a).toHaveLength(1)
    const [ev] = await db().select().from(events).where(eq(events.kind, 'system.backup_failed'))
    expect(ev?.payload).toMatchObject({ jobId: 'job-1' })
    expect((ev?.visibilityScope as { userIds?: string[] } | undefined)?.userIds).toEqual([userId])
    const [u] = await db().select().from(user)
    expect(u).toBeDefined()
  })
})

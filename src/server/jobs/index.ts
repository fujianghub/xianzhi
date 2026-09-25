/**
 * pg-boss 作业清单（07 §3、T0-026、REQ-OPS-007）：名称 = 队列名；每个作业可手动触发（runJob / `pnpm xz job <name>`）、连跑两次幂等。
 * worker 与 API 同进程（05 §3 `pnpm start`）；时区 Asia/Shanghai。gc.* 失败写 audit(gc.failed)；backup 失败由 backup service 自报。
 */
import { PgBoss } from 'pg-boss'
import { audit } from '../services/audit.ts'
import { runBackup } from '../services/backup.ts'
import {
  deriveRetry,
  gcAttachments,
  gcDeliveries,
  gcEvents,
  gcExports,
  gcIdempotency,
  gcNotifications,
  gcSnapshotsJob,
  gcSoftDeleted,
} from './gc.ts'
import { OUTBOX_JOBS } from './outbox.ts'

export type { JobCtx, JobDef } from './types.ts'

import { runCalendarReminders } from './calendarReminders.ts'
import { runDueSoon } from './dueSoon.ts'
import { EXPORT_JOBS } from './export.ts'

import type { JobCtx, JobDef } from './types.ts'

const gc = (name: string, cron: string, fn: (ctx: JobCtx) => Promise<unknown>): JobDef => ({
  name,
  cron,
  policy: 'singleton',
  retryLimit: 2,
  handler: async (ctx) => fn(ctx),
})

export const JOBS: JobDef[] = [
  gc('gc.soft-deleted', '30 3 * * *', (c) =>
    gcSoftDeleted({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  gc('gc.idempotency', '0 * * * *', (c) =>
    gcIdempotency({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  gc('gc.attachments', '0 4 * * *', (c) =>
    gcAttachments({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  gc('gc.snapshots', '15 4 * * *', (c) =>
    gcSnapshotsJob({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  gc('gc.events', '0 5 * * 0', (c) => gcEvents({ db: c.db, dataDir: c.dataDir, now: c.now })),
  gc('gc.notifications', '30 4 * * *', (c) =>
    gcNotifications({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  gc('gc.deliveries', '45 4 * * *', (c) =>
    gcDeliveries({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  gc('gc.exports', '0 5 * * *', (c) => gcExports({ db: c.db, dataDir: c.dataDir, now: c.now })),
  gc('derive.retry', '*/10 * * * *', (c) =>
    deriveRetry({ db: c.db, dataDir: c.dataDir, now: c.now }),
  ),
  {
    name: 'backup.daily',
    cron: '0 3 * * *',
    policy: 'singleton',
    retryLimit: 1,
    handler: (c, _d, jobId) =>
      runBackup(
        {
          db: c.db,
          databaseUrl: c.databaseUrl,
          dataDir: c.dataDir,
          ageRecipient: c.ageRecipient,
          now: c.now,
        },
        jobId,
      ),
  },
  {
    name: 'task.due-soon',
    cron: '*/15 * * * *',
    policy: 'singleton',
    retryLimit: 1,
    handler: (c) => runDueSoon(c.db, c.now),
  },
  {
    name: 'calendar.reminders',
    cron: '* * * * *',
    policy: 'singleton',
    retryLimit: 0, // 下一分钟会再扫，失败不重试
    handler: (c) => runCalendarReminders(c.db, c.now),
  },
  ...OUTBOX_JOBS,
  ...EXPORT_JOBS,
]

/** T0-024 等模块追加的作业（outbox.drain / notify.fanout）。 */
export function registerJob(def: JobDef): void {
  const i = JOBS.findIndex((j) => j.name === def.name)
  if (i >= 0) JOBS[i] = def
  else JOBS.push(def)
}

export const jobByName = (name: string) => JOBS.find((j) => j.name === name)

/** 同步执行一个作业（手动触发 / 测试 / worker 共用）；gc.* 失败写 audit(gc.failed)。 */
export async function runJob(
  name: string,
  ctx: JobCtx,
  data: Record<string, unknown> = {},
  jobId = 'manual',
): Promise<unknown> {
  const def = jobByName(name)
  if (!def) throw new Error(`未知作业：${name}（可选：${JOBS.map((j) => j.name).join(', ')}）`)
  try {
    return await def.handler(ctx, data, jobId)
  } catch (err) {
    if (name.startsWith('gc.') || name === 'derive.retry') {
      await audit(ctx.db, {
        action: 'gc.failed',
        targetType: 'job',
        targetId: name,
        meta: { jobId, error: String(err instanceof Error ? err.message : err).slice(0, 300) },
      }).catch(() => undefined)
    }
    throw err
  }
}

export const BOSS_SCHEMA = 'pgboss'

export async function startWorker(
  ctx: Omit<JobCtx, 'boss'>,
  opts: { schedule?: boolean } = {},
): Promise<{ boss: PgBoss; stop: () => Promise<void> }> {
  const boss = new PgBoss({
    connectionString: ctx.databaseUrl,
    schema: BOSS_SCHEMA,
    schedule: opts.schedule ?? true,
  })
  boss.on('error', (err) => ctx.logger.error({ err }, 'pg-boss error'))
  await boss.start()
  const full: JobCtx = { ...ctx, boss }
  for (const def of JOBS) {
    await boss.createQueue(def.name, {
      policy: def.policy ?? 'standard',
      retryLimit: def.retryLimit ?? 3,
      retryBackoff: true,
    })
    // 出箱链路轮询 1s：5s 接力 + 1s 轮询 ≤ 6s（REQ-NOTIF-001）；其余默认 2s
    const polling = def.name === 'outbox.drain' || def.name === 'notify.fanout' ? 0.5 : 2
    await boss.work<Record<string, unknown>>(
      def.name,
      { pollingIntervalSeconds: polling, localConcurrency: def.name === 'notify.fanout' ? 4 : 1 }, // 扇出并发 4：慢事件不阻塞后续
      async (jobs) => {
        let last: unknown
        for (const job of jobs) {
          const t = performance.now()
          try {
            const result = await runJob(def.name, full, job.data ?? {}, job.id)
            last = result
            ctx.logger.info(
              { job: def.name, jobId: job.id, ms: Math.round(performance.now() - t), result },
              'job done',
            )
          } catch (err) {
            ctx.logger.error({ err, job: def.name, jobId: job.id }, 'job failed')
            throw err
          }
        }
        // 单条批次时把结果交给 pg-boss 存为 job.output（GET /jobs/:id 读取导出产物位置，02 §8）
        return jobs.length === 1 ? (last as object | undefined) : undefined
      },
    )
    if (def.cron && (opts.schedule ?? true))
      await boss.schedule(def.name, def.cron, {}, { tz: 'Asia/Shanghai' })
  }
  // 出箱自循环的首次启动（01 §3.10）；已在队列时被 singletonKey 合并
  await boss.send('outbox.drain', {}, { singletonKey: 'outbox.drain' })
  // 提交后即时接力：LISTEN xz_outbox → drainOnce（入队 notify.fanout）
  const { drainOnce, listenOutbox } = await import('./outbox.ts')
  const { getPool } = await import('../db/index.ts')
  const stopListen = await listenOutbox(
    ctx.databaseUrl,
    () => drainOnce(ctx.pool ?? getPool(), boss),
    (err) => ctx.logger.error({ err }, 'outbox listen error'),
  )
  return {
    boss,
    stop: async () => {
      await stopListen()
      await boss.stop({ graceful: true, timeout: 10_000 })
    },
  }
}

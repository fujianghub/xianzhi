/**
 * T1-011 列表性能（REQ-TASK-023）与慢查询日志（REQ-OPS-010）。
 * 1 万任务本机：listTasks 服务查询数 ≤ 3、50 次采样 P95 ≤ 100ms；结果写 debug/perf/tasks-list.json。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listTasksQuery } from '../../shared/schemas/tasks.ts'
import type { Actor } from '../authz.ts'
import { createDb, getDb } from '../db/index.ts'
import { spaces, tasks } from '../db/schema/business.ts'
import { getEnv } from '../env.ts'
import { listTasks, type TaskCtx } from '../services/tasks.ts'
import { truncateAll } from './db.ts'
import { seedOwner } from './helpers.ts'

describe('T1-011 perf', () => {
  let ctx: TaskCtx
  let spaceId = ''
  const counted: string[] = []
  const measured = createDb(getEnv().DATABASE_URL, { onQuery: (q) => counted.push(q) })

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    const actor: Actor = { id: r.userId, workspaceRole: 'owner' }
    ctx = { actor, workspaceId: r.workspaceId, timezone: 'Asia/Shanghai', weekStartsOn: 1 }
    const [s] = await getDb()
      .insert(spaces)
      .values({
        workspaceId: r.workspaceId,
        name: 'Perf',
        slug: 'perf',
        kind: 'project',
        visibility: 'members',
        sortKey: 'a0',
        createdBy: r.userId,
      })
      .returning({ id: spaces.id })
    spaceId = s?.id ?? ''
    const statuses = ['inbox', 'todo', 'doing', 'blocked', 'done', 'cancelled']
    const now = Date.now()
    for (let b = 0; b < 10; b++) {
      await getDb()
        .insert(tasks)
        .values(
          Array.from({ length: 1000 }, (_, i) => {
            const n = b * 1000 + i
            return {
              workspaceId: r.workspaceId,
              spaceId,
              title: `任务 ${n}`,
              status: statuses[n % 6] as string,
              priority: n % 5,
              dueAt: n % 4 ? new Date(now + (n % 90) * 86_400_000) : null,
              creatorId: r.userId,
              assigneeId: n % 3 ? r.userId : null,
              sortKey: `a${String(n).padStart(5, '0')}`,
              updatedAt: new Date(now - n * 1000),
            }
          }),
        )
    }
    await getDb().execute(sql`analyze tasks`)
  }, 120_000)
  afterAll(async () => {
    await measured.pool.end()
  })

  it('REQ-TASK-023 列表接口查询数 ≤ 3 且 1 万任务 P95 ≤ 100ms', async () => {
    const queries = [
      `spaceId=${spaceId}&limit=50`,
      `spaceId=${spaceId}&status=todo,doing&sort=-priority&limit=50`,
      'view=today&limit=50',
      'view=inbox&limit=50',
      `spaceId=${spaceId}&sort=dueAt&limit=200`,
    ]
    const report: Record<string, { queries: number; p95: number; p50: number }> = {}
    for (const qs of queries) {
      const q = listTasksQuery.parse(Object.fromEntries(new URLSearchParams(qs)))
      counted.length = 0
      await listTasks(measured.db, ctx, q)
      const n = counted.length
      expect(n, `${qs} 查询数`).toBeLessThanOrEqual(3)
      const samples: number[] = []
      for (let i = 0; i < 50; i++) {
        const t = performance.now()
        await listTasks(measured.db, ctx, q)
        samples.push(performance.now() - t)
      }
      samples.sort((a, b) => a - b)
      const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? 0
      report[qs] = {
        queries: n,
        p95: Math.round(p95 * 10) / 10,
        p50: Math.round((samples[24] ?? 0) * 10) / 10,
      }
      expect(p95, `${qs} P95`).toBeLessThanOrEqual(100)
    }
    mkdirSync('debug/perf', { recursive: true })
    writeFileSync(
      'debug/perf/tasks-list.json',
      `${JSON.stringify({ rows: 10_000, at: new Date().toISOString(), report }, null, 2)}\n`,
    )
  }, 120_000)

  it('REQ-OPS-010 慢查询日志含 SQL 与耗时（事务内借出的连接同样计时）', async () => {
    const lines: string[] = []
    const d = createDb(getEnv().DATABASE_URL, { log: (m) => lines.push(m), slowMs: 50 })
    await d.db.execute(sql`select pg_sleep(0.06) as slow_pool`)
    await d.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(0.06) as slow_tx`)
    })
    await d.db.execute(sql`select 1 as fast`)
    await d.pool.end()
    expect(lines.some((l) => /slow query \d+\.\dms: .*slow_pool/.test(l))).toBe(true)
    expect(lines.some((l) => /slow query \d+\.\dms: .*slow_tx/.test(l))).toBe(true)
    expect(lines.some((l) => l.includes('fast'))).toBe(false)
  })
})

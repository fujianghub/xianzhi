/**
 * Drizzle 实例（05 §10）。列名映射 casing: snake_case（01 §1）。
 * - 慢查询（REQ-OPS-010）：dev 下 > 50ms 的 SQL 打印 SQL 与耗时；在 pg 层计时，覆盖 pool.query 与事务里借出的连接。
 * - onQuery：每条经 Drizzle 发出的 SQL 回调一次（REQ-TASK-023 统计列表接口查询数）。
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getEnv } from '../env.ts'
import * as schema from './schema/index.ts'

export type Db = ReturnType<typeof createDb>['db']
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export const SLOW_MS = 50

type QueryFn = (...args: unknown[]) => Promise<unknown>

/** 给 pg 的 query 方法套计时；超过阈值调用 log（SQL 截 500 字，不带参数值——参数可能含正文 / 令牌）。 */
function timed(orig: QueryFn, log: (msg: string) => void, slowMs: number): QueryFn {
  return async (...args) => {
    const t = performance.now()
    try {
      return await orig(...args)
    } finally {
      const ms = performance.now() - t
      if (ms > slowMs) {
        const q = args[0] as string | { text?: string } | undefined
        const text = typeof q === 'string' ? q : (q?.text ?? '')
        log(`slow query ${ms.toFixed(1)}ms: ${text.replace(/\s+/g, ' ').slice(0, 500)}`)
      }
    }
  }
}

/** 慢查询计时：pool.query 与每个借出的 client.query（事务走后者）。 */
export function instrumentPool(pool: pg.Pool, log: (msg: string) => void, slowMs = SLOW_MS): void {
  // biome-ignore lint/suspicious/noExplicitAny: 包装 pg 的重载方法
  const p = pool as any
  p.query = timed(p.query.bind(pool), log, slowMs)
  pool.on('connect', (client) => {
    // biome-ignore lint/suspicious/noExplicitAny: 同上
    const c = client as any
    if (c.__giTimed) return
    c.__giTimed = true
    c.query = timed(c.query.bind(client), log, slowMs)
  })
}

export function createDb(
  connectionString: string,
  opts: { log?: (msg: string) => void; slowMs?: number; onQuery?: (sql: string) => void } = {},
) {
  const pool = new pg.Pool({ connectionString, max: 10 })
  const onQuery = opts.onQuery
  const db = drizzle({
    client: pool,
    schema,
    casing: 'snake_case',
    logger: onQuery ? { logQuery: (query) => onQuery(query) } : false,
  })
  if (opts.log) instrumentPool(pool, opts.log, opts.slowMs ?? SLOW_MS)
  return { db, pool }
}

let singleton: ReturnType<typeof createDb> | undefined

/** 进程级单例；测试用 createDb() 自建。 */
export function getDb(): Db {
  if (!singleton) {
    const env = getEnv()
    singleton = createDb(env.DATABASE_URL, {
      log: env.NODE_ENV === 'development' ? (m) => console.warn(`[db] ${m}`) : undefined,
    })
  }
  return singleton.db
}

/** 原始 pg.Pool（NOTIFY 等 Drizzle 不覆盖的用途）。 */
export function getPool(): pg.Pool {
  getDb()
  if (!singleton) throw new Error('db not initialised')
  return singleton.pool
}

export async function closeDb(): Promise<void> {
  await singleton?.pool.end()
  singleton = undefined
}

export { schema }

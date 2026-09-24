/**
 * Idempotency-Key（02 §5、01 §3.13、REQ-TASK-001 · REQ-OPS-013）：挂在创建端点（POST）上。
 * - 头缺省：照常处理。头不是 UUID：422。
 * - 先占位（response_status = 0）再执行：并发的同 key 第二个请求得到 409 CONFLICT_IN_FLIGHT，不会重复创建。
 * - 执行成功（2xx）：写入状态码与响应体；之后 24h 内同用户同 key 原样回放（头 `Idempotent-Replayed: true`）。
 * - 执行失败（非 2xx 或抛错）：删除占位，允许用同一 key 重试。
 * - key 已被**其他用户**占用：照常处理但不回放、不记录（不泄露他人响应）。表主键只有 key（01 §3.13），见 02 §5 注。
 * - 超过 24h 的旧行视为不存在（gc.idempotency 每小时清理，这里不依赖它）。
 */
import { and, eq, lt } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { Db } from '../db/index.ts'
import { idempotencyKeys } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import type { AppEnv } from '../types.ts'

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000
const IN_FLIGHT = 0
const keySchema = z.uuid()

export function idempotency(db: Db, now: () => number = Date.now): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.header('idempotency-key')
    const user = c.var.user
    if (raw === undefined || !user) return next()
    const parsed = keySchema.safeParse(raw.trim())
    if (!parsed.success)
      throw AppError.validation([{ path: 'Idempotency-Key', message: '须为 UUID' }])
    const key = parsed.data
    // 过期行先清掉，视为新请求
    await db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          lt(idempotencyKeys.createdAt, new Date(now() - IDEMPOTENCY_TTL_MS)),
        ),
      )
    const claimed = await db
      .insert(idempotencyKeys)
      .values({ key, userId: user.id, responseStatus: IN_FLIGHT, responseBody: {} })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key })
    if (!claimed.length) {
      const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key))
      if (row && row.userId === user.id) {
        if (row.responseStatus === IN_FLIGHT)
          throw new AppError(409, 'CONFLICT_IN_FLIGHT', '同一 Idempotency-Key 的请求仍在处理中')
        c.header('Idempotent-Replayed', 'true')
        if (row.responseStatus === 204) return c.body(null, 204)
        return c.json(row.responseBody as object, row.responseStatus as 200)
      }
      return next() // 他人的 key 或刚被清理：照常处理，不记录
    }
    const release = () => db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key))
    try {
      await next()
    } catch (err) {
      await release()
      throw err
    }
    const res = c.res
    if (res.status < 200 || res.status >= 300 || c.error) {
      await release()
      return
    }
    const body =
      res.status === 204
        ? {}
        : ((await res
            .clone()
            .json()
            .catch(() => ({}))) as object)
    await db
      .update(idempotencyKeys)
      .set({ responseStatus: res.status, responseBody: body })
      .where(eq(idempotencyKeys.key, key))
  }
}

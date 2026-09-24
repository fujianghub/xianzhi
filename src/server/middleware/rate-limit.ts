/**
 * 内存固定窗口限流（02 §2、07 §5）：按 userId 或 IP；返回 RateLimit-Limit/Remaining/Reset；超限 429。
 * 单实例够用（ADR §9.4）；多实例时换 PG/Redis。
 */
import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/errors.ts'
import type { AppEnv } from '../types.ts'
import { clientIp } from './request-context.ts'

interface Bucket {
  count: number
  resetAt: number
}

export class FixedWindowLimiter {
  private buckets = new Map<string, Bucket>()
  readonly limit: number
  readonly windowMs: number
  private readonly now: () => number
  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  /** 计数并返回状态；超限时 allowed=false。 */
  hit(key: string): { allowed: boolean; remaining: number; resetAt: number; resetInSec: number } {
    const t = this.now()
    let b = this.buckets.get(key)
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.windowMs }
      this.buckets.set(key, b)
      if (this.buckets.size > 50_000) this.sweep(t)
    }
    b.count++
    return {
      allowed: b.count <= this.limit,
      remaining: Math.max(0, this.limit - b.count),
      resetAt: b.resetAt,
      resetInSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)),
    }
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k)
  }
}

export function rateLimit(
  limiter: FixedWindowLimiter,
  keyOf: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string = (c) =>
    c.var.user ? `u:${c.var.user.id}` : `ip:${clientIp(c.req.raw.headers)}`,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const r = limiter.hit(keyOf(c))
    c.header('RateLimit-Limit', String(limiter.limit))
    c.header('RateLimit-Remaining', String(r.remaining))
    c.header('RateLimit-Reset', String(r.resetInSec))
    if (!r.allowed) throw AppError.rateLimited('请求过于频繁')
    await next()
  }
}

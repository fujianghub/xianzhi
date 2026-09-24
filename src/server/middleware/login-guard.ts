/**
 * 登录保护（02 §2、07 §5、REQ-AUTH-012）：包在 Better Auth `/sign-in/email` 外层。
 * - 邮箱维度 10/min（IP 维度由 Better Auth rateLimit customRules）
 * - 同账号连续失败 10 次锁定 15 分钟 → 403 ACCOUNT_LOCKED（正确密码也拒绝），写 audit(auth.locked)
 * - 成功 → 清零并写 audit(auth.login)；失败 → audit(auth.login_failed)
 */
import type { MiddlewareHandler } from 'hono'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from '../services/audit.ts'
import type { AppEnv } from '../types.ts'
import { FixedWindowLimiter } from './rate-limit.ts'
import { clientIp } from './request-context.ts'

export const LOCK_THRESHOLD = 10
export const LOCK_MS = 15 * 60 * 1000

interface FailState {
  failures: number
  lockedUntil: number
}

export class LoginGuard {
  private state = new Map<string, FailState>()
  readonly limiter: FixedWindowLimiter
  private readonly now: () => number
  constructor(now: () => number = Date.now) {
    this.now = now
    this.limiter = new FixedWindowLimiter(10, 60_000, now)
  }
  isLocked(email: string): boolean {
    const s = this.state.get(email)
    return !!s && s.lockedUntil > this.now()
  }
  /** 返回是否刚触发锁定 */
  recordFailure(email: string): boolean {
    const s = this.state.get(email) ?? { failures: 0, lockedUntil: 0 }
    s.failures++
    let justLocked = false
    if (s.failures >= LOCK_THRESHOLD) {
      s.lockedUntil = this.now() + LOCK_MS
      s.failures = 0
      justLocked = true
    }
    this.state.set(email, s)
    return justLocked
  }
  recordSuccess(email: string): void {
    this.state.delete(email)
  }
  reset(): void {
    this.state.clear()
  }
}

export function loginGuard(guard: LoginGuard, db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let email = ''
    try {
      const body = (await c.req.raw.clone().json()) as { email?: unknown }
      if (typeof body.email === 'string') email = body.email.trim().toLowerCase()
    } catch {
      /* 非 JSON 交给 Better Auth 处理 */
    }
    if (!email) return next()
    const ip = clientIp(c.req.raw.headers)
    const ua = c.req.header('user-agent') ?? null

    // 锁定优先于限流：锁定期内一律 403（正确密码也拒绝）
    if (guard.isLocked(email)) throw new AppError(403, 'ACCOUNT_LOCKED', '账号已锁定 15 分钟')
    const r = guard.limiter.hit(email)
    c.header('RateLimit-Limit', String(guard.limiter.limit))
    c.header('RateLimit-Remaining', String(r.remaining))
    c.header('RateLimit-Reset', String(r.resetInSec))
    if (!r.allowed) throw AppError.rateLimited('登录尝试过于频繁')

    await next()

    const status = c.res.status
    if (status === 200) {
      guard.recordSuccess(email)
      await audit(db, {
        action: 'auth.login',
        targetType: 'user',
        targetId: email,
        ip,
        userAgent: ua,
      })
    } else if (status === 401 || status === 400 || status === 403) {
      const locked = guard.recordFailure(email)
      await audit(db, {
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: email,
        ip,
        userAgent: ua,
        meta: { status },
      })
      if (locked)
        await audit(db, {
          action: 'auth.locked',
          targetType: 'user',
          targetId: email,
          ip,
          userAgent: ua,
        })
    }
  }
}

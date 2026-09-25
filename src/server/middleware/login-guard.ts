/**
 * 登录保护（02 §2、07 §5、REQ-AUTH-012）：包在 Better Auth `/sign-in/email` 外层。
 * - 邮箱维度 10/min（IP 维度由 Better Auth rateLimit customRules）
 * - 同账号连续失败 10 次锁定 15 分钟 → 403 ACCOUNT_LOCKED（正确密码也拒绝），写 audit(auth.locked)
 * - 成功 → 清零并写 audit(auth.login)；失败 → audit(auth.login_failed)
 * - 拼图滑块（ADR-0006、REQ-AUTH-016）：锁定与限流之后、交给 Better Auth 之前校验 `x-captcha`；
 *   失败 400 CAPTCHA_INVALID，**不计入失败次数**（拿不到滑块就无法把别人的账号刷到锁定）
 * - 同时包 `/sign-in/username`（ADR-0008）：用户名先解析成邮箱，锁定 / 限流 / 审计仍按邮箱计
 * - 待审批账号（ADR-0008）：密码正确后撤销刚建的会话、不下发 Cookie，返回 403 REGISTRATION_PENDING
 */
import { and, eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import type { Db } from '../db/index.ts'
import { member, session, user } from '../db/schema/auth.ts'
import { AppError, PROBLEM_CONTENT_TYPE, toProblem } from '../lib/errors.ts'
import { audit } from '../services/audit.ts'
import { type CaptchaOptions, verifyCaptcha } from '../services/captcha.ts'
import { isPending } from '../services/join-requests.ts'
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

export function loginGuard(
  guard: LoginGuard,
  db: Db,
  captcha: CaptchaOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let email = ''
    try {
      const body = (await c.req.raw.clone().json()) as { email?: unknown; username?: unknown }
      if (typeof body.email === 'string') email = body.email.trim().toLowerCase()
      else if (typeof body.username === 'string' && body.username.trim()) {
        const uname = body.username.trim().toLowerCase()
        const [u] = await db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.username, uname))
          .limit(1)
        // 不存在的用户名也按固定键计数，避免据响应差异探测用户名
        email = u?.email ?? `@${uname}`
      }
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
    if (!(await verifyCaptcha(db, c.req.header('x-captcha'), captcha)))
      throw new AppError(400, 'CAPTCHA_INVALID', '滑块验证未通过，请重试')

    await next()

    const status = c.res.status
    if (status === 200) {
      guard.recordSuccess(email)
      const pendingUserId = await pendingUser(db, email)
      if (pendingUserId) {
        // 密码正确但尚未审批：撤销刚建的会话，丢弃 Better Auth 响应（含 Set-Cookie）
        await db.delete(session).where(eq(session.userId, pendingUserId))
        const err = new AppError(403, 'REGISTRATION_PENDING', '注册申请正在等待管理员审批')
        c.res = undefined
        c.res = new Response(JSON.stringify(toProblem(err, c.var.requestId ?? '')), {
          status: 403,
          headers: { 'Content-Type': PROBLEM_CONTENT_TYPE, 'Cache-Control': 'no-store' },
        })
        return
      }
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

/** 邮箱对应的用户若无 member 行且有待审批申请，返回其 id。 */
async function pendingUser(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id, memberId: member.id })
    .from(user)
    .leftJoin(member, and(eq(member.userId, user.id)))
    .where(eq(user.email, email))
    .limit(1)
  if (!row || row.memberId) return null
  return (await isPending(db, row.id)) ? row.id : null
}

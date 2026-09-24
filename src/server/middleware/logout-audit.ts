/** 包在 Better Auth `/sign-out` 外：成功登出写 audit(auth.logout)（REQ-WS-006）。 */
import type { MiddlewareHandler } from 'hono'
import type { Auth } from '../auth.ts'
import type { Db } from '../db/index.ts'
import { audit } from '../services/audit.ts'
import type { AppEnv } from '../types.ts'
import { clientIp } from './request-context.ts'

export function logoutAudit(auth: Auth, db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
    await next()
    if (s?.user && c.res.status === 200) {
      await audit(db, {
        actorId: s.user.id,
        action: 'auth.logout',
        targetType: 'user',
        targetId: s.user.id,
        ip: clientIp(c.req.raw.headers),
        userAgent: c.req.header('user-agent') ?? null,
      })
    }
  }
}

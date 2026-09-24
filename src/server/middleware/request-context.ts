/**
 * requestId + pino 子 logger + 请求日志（05 §10：reqId / userId / 耗时，不记 body）。
 */
import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type { Logger } from 'pino'
import type { AppEnv } from '../types.ts'

export function requestContext(root: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id')?.slice(0, 64) || randomUUID()
    const log = root.child({ reqId: requestId })
    c.set('requestId', requestId)
    c.set('log', log)
    c.set('user', null)
    c.set('workspaceId', null)
    c.set('workspaceRole', null)
    c.set('actor', null)
    c.set('authKind', null)
    c.set('apiKeyScope', null)
    c.header('X-Request-Id', requestId)
    const t = performance.now()
    await next()
    const ms = Math.round(performance.now() - t)
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms,
        userId: c.var.user?.id ?? null,
        ip: clientIp(c.req.raw.headers),
      },
      'request',
    )
  }
}

export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() || 'unknown'
  return headers.get('x-real-ip') || 'unknown'
}

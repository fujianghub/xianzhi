/**
 * CSRF（02 §2、REQ-AUTH-011）：非 GET/HEAD/OPTIONS 必须同站（Sec-Fetch-Site 或 Origin = APP_URL）；
 * API Key 请求豁免（Bearer 头本身不可被跨站自动携带）。
 */
import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/errors.ts'
import type { AppEnv } from '../types.ts'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrf(appOrigin: string): MiddlewareHandler<AppEnv> {
  const allowed = new URL(appOrigin).origin
  return async (c, next) => {
    if (SAFE.has(c.req.method) || c.req.header('authorization')?.startsWith('Bearer '))
      return next()
    const site = c.req.header('sec-fetch-site')
    const origin = c.req.header('origin')
    const ok =
      (site && (site === 'same-origin' || site === 'same-site' || site === 'none')) ||
      (!site && origin && origin === allowed) ||
      (!site && !origin) // 非浏览器客户端（curl / 测试）且无 Cookie 跨站风险
    if (site === 'cross-site' || (origin && origin !== allowed) || !ok) {
      throw new AppError(403, 'CSRF', '跨站请求被拒绝')
    }
    await next()
  }
}

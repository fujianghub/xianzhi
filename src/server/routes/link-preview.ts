/**
 * GET /api/v1/link-preview?url=（ADR-0054 §D、REQ-LINK-007）：外链标题 / 描述 / 站点名 / 图标（data URI）。
 * 只给登录用户；每人 30 次 / 分钟（同 URL 命中进程内缓存也计数，挡住滥用）；私网 / 非 http(s) → 422，抓取失败 → 502。
 * 浏览器侧缓存 1 小时（私有）。
 */
import { Hono } from 'hono'
import { linkPreviewQuery } from '../../shared/schemas/links.ts'
import { validate } from '../lib/validate.ts'
import { FixedWindowLimiter, rateLimit } from '../middleware/rate-limit.ts'
import { requireAuth } from '../middleware/session.ts'
import { type FetchDeps, getLinkPreview } from '../services/link-preview.ts'
import type { AppEnv } from '../types.ts'

export function linkPreviewRoutes(deps: { limiter?: FixedWindowLimiter; fetch?: FetchDeps } = {}) {
  const limiter = deps.limiter ?? new FixedWindowLimiter(30, 60_000)
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', rateLimit(limiter), validate('query', linkPreviewQuery), async (c) => {
      const out = await getLinkPreview(c.req.valid('query').url, deps.fetch)
      c.header('Cache-Control', 'private, max-age=3600')
      return c.json(out)
    })
}

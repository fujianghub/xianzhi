/** GET /api/v1/search（02 §4.1、REQ-SEARCH-001 ~ 005）：每用户 60 次 / 分钟。 */
import { Hono } from 'hono'
import { searchQuery } from '../../shared/schemas/search.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { FixedWindowLimiter, rateLimit } from '../middleware/rate-limit.ts'
import { requireAuth } from '../middleware/session.ts'
import { search } from '../services/search.ts'
import type { AppEnv } from '../types.ts'

export function searchRoutes(deps: { db: Db; limiter?: FixedWindowLimiter }) {
  const limiter = deps.limiter ?? new FixedWindowLimiter(60, 60_000)
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', rateLimit(limiter), validate('query', searchQuery), async (c) => {
      if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
      return c.json(
        await search(
          deps.db,
          { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId },
          c.req.valid('query'),
        ),
      )
    })
}

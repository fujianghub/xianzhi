/** /api/v1/links（02 §9、REQ-LINK-003 · 004 · 005）：只做校验 → service → 序列化。 */
import { Hono } from 'hono'
import { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import { createLinkSchema, listLinksQuery } from '../../shared/schemas/links.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/links.ts'
import type { AppEnv } from '../types.ts'

export function linkRoutes(deps: { db: Db }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): svc.LinkCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', listLinksQuery), async (c) =>
      c.json({ items: await svc.listLinks(deps.db, ctxOf(c), c.req.valid('query')) }),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createLinkSchema),
      async (c) => c.json(await svc.createLink(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .delete(
      '/:id',
      requireScope('write'),
      validate('param', z.object({ id: uuidSchema })),
      async (c) => {
        await svc.deleteLink(deps.db, ctxOf(c), c.req.valid('param').id)
        return c.body(null, 204)
      },
    )
}

/** /api/v1/tags（02 §9、REQ-TAG-001）。 */
import { Hono } from 'hono'
import { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import { createTagSchema, mergeTagSchema, patchTagSchema } from '../../shared/schemas/tags.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/tags.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: uuidSchema })

export function tagRoutes(deps: { db: Db }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): svc.TagCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) =>
      c.json({
        items: await svc.listTags(deps.db, ctxOf(c)),
        nextCursor: null,
        canCreate: svc.canCreateTag(ctxOf(c)),
      }),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createTagSchema),
      async (c) => c.json(await svc.createTag(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchTagSchema),
      async (c) =>
        c.json(await svc.patchTag(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json'))),
    )
    .post(
      '/:id/merge',
      requireScope('write'),
      validate('param', idParam),
      validate('json', mergeTagSchema),
      async (c) =>
        c.json(
          await svc.mergeTag(
            deps.db,
            ctxOf(c),
            c.req.valid('param').id,
            c.req.valid('json').intoId,
          ),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      await svc.deleteTag(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

/** /api/v1/entry-views（02 §9；ADR-0033 保存视图，REQ-BUG-009）。 */
import { Hono } from 'hono'
import { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import { createEntryViewSchema, patchEntryViewSchema } from '../../shared/schemas/entry-views.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import type { EntryCtx } from '../services/entries.ts'
import * as svc from '../services/entry-views.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: uuidSchema })

export function entryViewRoutes(deps: { db: Db }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): EntryCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) =>
      c.json({ items: await svc.listEntryViews(deps.db, ctxOf(c)), nextCursor: null }),
    )
    .post('/', requireScope('write'), validate('json', createEntryViewSchema), async (c) =>
      c.json(await svc.createEntryView(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchEntryViewSchema),
      async (c) =>
        c.json(
          await svc.patchEntryView(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      await svc.deleteEntryView(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

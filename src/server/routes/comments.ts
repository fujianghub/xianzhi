/** /api/v1/comments（02 §9、REQ-COMMENT-001 · 003 · 005 · 006 · 007）。 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createCommentSchema,
  listCommentsQuery,
  patchCommentSchema,
} from '../../shared/schemas/comments.ts'
import { uuidSchema } from '../../shared/schemas/common.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/comments.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: uuidSchema })

export function commentRoutes(deps: { db: Db }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): svc.CommentCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', listCommentsQuery), async (c) =>
      c.json(await svc.listComments(deps.db, ctxOf(c), c.req.valid('query'))),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createCommentSchema),
      async (c) => c.json(await svc.createComment(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchCommentSchema),
      async (c) =>
        c.json(
          await svc.patchComment(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      await svc.deleteComment(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
    .post('/:id/resolve', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(await svc.setResolved(deps.db, ctxOf(c), c.req.valid('param').id, true)),
    )
    .post('/:id/unresolve', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(await svc.setResolved(deps.db, ctxOf(c), c.req.valid('param').id, false)),
    )
}

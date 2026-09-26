/** /api/v1/entry-types（02 §9、ADR-0016、REQ-ENTRY-018 · 019）：记录类型管理。 */
import { Hono } from 'hono'
import { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import {
  builtinKindParam,
  createEntryTypeSchema,
  patchEntryTypeSchema,
  setBuiltinHiddenSchema,
} from '../../shared/schemas/entryTypes.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/entry-types.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: uuidSchema })

export function entryTypeRoutes(deps: { db: Db }) {
  const ctxOf = (c: {
    var: AppEnv['Variables']
    req: { raw: Request; header: (n: string) => string | undefined }
  }): svc.EntryTypeCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return {
      actor: c.var.actor as Actor,
      workspaceId: c.var.workspaceId,
      ip: clientIp(c.req.raw.headers),
      userAgent: c.req.header('user-agent') ?? null,
    }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) => c.json(await svc.listEntryTypes(deps.db, ctxOf(c))))
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createEntryTypeSchema),
      async (c) => c.json(await svc.createEntryType(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .put(
      '/builtin/:kind',
      requireScope('write'),
      validate('param', builtinKindParam),
      validate('json', setBuiltinHiddenSchema),
      async (c) =>
        c.json(
          await svc.setBuiltinHidden(
            deps.db,
            ctxOf(c),
            c.req.valid('param').kind,
            c.req.valid('json').hidden,
          ),
        ),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchEntryTypeSchema),
      async (c) =>
        c.json(
          await svc.patchEntryType(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      await svc.deleteEntryType(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

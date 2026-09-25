/** /api/v1/templates（ADR-0011 §2、02 §9）：内置 + 个人 + 工作区模板；路由只做校验 → service → 序列化。 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createTemplateSchema,
  listTemplatesQuery,
  patchTemplateSchema,
  templateIdSchema,
} from '../../shared/schemas/templates.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import type { EntryCtx } from '../services/entries.ts'
import * as svc from '../services/templates.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: templateIdSchema })

export function templateRoutes(deps: { db: Db }) {
  const ctxOf = (c: {
    var: AppEnv['Variables']
    req: { raw: Request; header: (n: string) => string | undefined }
  }): EntryCtx => {
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
    .get('/', validate('query', listTemplatesQuery), async (c) =>
      c.json({
        items: await svc.listTemplates(deps.db, ctxOf(c), c.req.valid('query')),
        nextCursor: null,
      }),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createTemplateSchema),
      async (c) => c.json(await svc.createTemplate(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .get('/:id', validate('param', idParam), async (c) =>
      c.json(await svc.getTemplate(deps.db, ctxOf(c), c.req.valid('param').id)),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchTemplateSchema),
      async (c) =>
        c.json(
          await svc.patchTemplate(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      await svc.deleteTemplate(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

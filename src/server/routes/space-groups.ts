/** /api/v1/space-groups（ADR-0012、02 §9）：大类；只做校验 → service → 序列化。 */
import { Hono } from 'hono'
import {
  createSpaceGroupSchema,
  patchSpaceGroupSchema,
  reorderSpaceGroupSchema,
  spaceGroupParam,
} from '../../shared/schemas/space-groups.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/space-groups.ts'
import type { SpaceCtx } from '../services/spaces.ts'
import type { AppEnv } from '../types.ts'

export function spaceGroupRoutes(deps: { db: Db }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): SpaceCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
  }
  return (
    new Hono<AppEnv>()
      .use(requireAuth)
      .get('/', async (c) =>
        c.json({ items: await svc.listSpaceGroups(deps.db, ctxOf(c)), nextCursor: null }),
      )
      .post('/', requireScope('write'), validate('json', createSpaceGroupSchema), async (c) =>
        c.json(await svc.createSpaceGroup(deps.db, ctxOf(c), c.req.valid('json')), 201),
      )
      // 字面路径须在 /:id 之前注册
      .patch(
        '/reorder',
        requireScope('write'),
        validate('json', reorderSpaceGroupSchema),
        async (c) => c.json(await svc.reorderSpaceGroup(deps.db, ctxOf(c), c.req.valid('json'))),
      )
      .patch(
        '/:id',
        requireScope('write'),
        validate('param', spaceGroupParam),
        validate('json', patchSpaceGroupSchema),
        async (c) =>
          c.json(
            await svc.patchSpaceGroup(
              deps.db,
              ctxOf(c),
              c.req.valid('param').id,
              c.req.valid('json'),
            ),
          ),
      )
      .delete('/:id', requireScope('write'), validate('param', spaceGroupParam), async (c) => {
        await svc.deleteSpaceGroup(deps.db, ctxOf(c), c.req.valid('param').id)
        return c.body(null, 204)
      })
  )
}

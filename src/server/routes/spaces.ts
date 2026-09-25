/** /api/v1/spaces（02 §9、REQ-SPACE-001 ~ 009）：只做校验 → service → 序列化。`:id` 接受 UUID 或 slug。 */
import { Hono } from 'hono'
import {
  addSpaceMemberSchema,
  createSpaceSchema,
  listSpacesQuery,
  patchSpaceMemberSchema,
  patchSpaceSchema,
  reorderSpaceSchema,
  spaceKeyParam,
  spaceMemberParam,
} from '../../shared/schemas/spaces.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import { getSpaceTree } from '../services/entry-tree.ts'
import * as svc from '../services/spaces.ts'
import type { AppEnv } from '../types.ts'

export function spaceRoutes(deps: { db: Db; dataDir: string }) {
  const ctxOf = (c: {
    var: AppEnv['Variables']
    req: { raw: Request; header: (n: string) => string | undefined }
  }): svc.SpaceCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return {
      actor: c.var.actor as Actor,
      workspaceId: c.var.workspaceId,
      dataDir: deps.dataDir,
      ip: clientIp(c.req.raw.headers),
      userAgent: c.req.header('user-agent') ?? null,
    }
  }
  return (
    new Hono<AppEnv>()
      .use(requireAuth)
      .get('/', validate('query', listSpacesQuery), async (c) =>
        c.json(await svc.listSpaces(deps.db, ctxOf(c), c.req.valid('query'))),
      )
      .post(
        '/',
        requireScope('write'),
        idempotency(deps.db),
        validate('json', createSpaceSchema),
        async (c) => c.json(await svc.createSpace(deps.db, ctxOf(c), c.req.valid('json')), 201),
      )
      // 字面路径须在 /:id 之前注册
      .patch('/reorder', requireScope('write'), validate('json', reorderSpaceSchema), async (c) =>
        c.json(await svc.reorderSpace(deps.db, ctxOf(c), c.req.valid('json'))),
      )
      .get('/:id', validate('param', spaceKeyParam), async (c) =>
        c.json(await svc.getSpace(deps.db, ctxOf(c), c.req.valid('param').id)),
      )
      // 目录树（ADR-0012、REQ-KB-005）：只含标题等元数据
      .get('/:id/tree', validate('param', spaceKeyParam), async (c) =>
        c.json({ items: await getSpaceTree(deps.db, ctxOf(c), c.req.valid('param').id) }),
      )
      .patch(
        '/:id',
        requireScope('write'),
        validate('param', spaceKeyParam),
        validate('json', patchSpaceSchema),
        async (c) =>
          c.json(
            await svc.patchSpace(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
          ),
      )
      .delete('/:id', requireScope('write'), validate('param', spaceKeyParam), async (c) => {
        const id = c.req.valid('param').id
        if (c.req.query('permanent') === '1')
          await svc.permanentlyDeleteSpace(deps.db, ctxOf(c), id)
        else await svc.softDeleteSpace(deps.db, ctxOf(c), id)
        return c.body(null, 204)
      })
      .post('/:id/archive', requireScope('write'), validate('param', spaceKeyParam), async (c) =>
        c.json(await svc.setSpaceArchived(deps.db, ctxOf(c), c.req.valid('param').id, true)),
      )
      .post('/:id/unarchive', requireScope('write'), validate('param', spaceKeyParam), async (c) =>
        c.json(await svc.setSpaceArchived(deps.db, ctxOf(c), c.req.valid('param').id, false)),
      )
      .post('/:id/restore', requireScope('write'), validate('param', spaceKeyParam), async (c) =>
        c.json(await svc.restoreSpace(deps.db, ctxOf(c), c.req.valid('param').id)),
      )
      .get('/:id/members', validate('param', spaceKeyParam), async (c) =>
        c.json({
          items: await svc.listSpaceMembers(deps.db, ctxOf(c), c.req.valid('param').id),
          nextCursor: null,
        }),
      )
      .post(
        '/:id/members',
        requireScope('write'),
        validate('param', spaceKeyParam),
        validate('json', addSpaceMemberSchema),
        async (c) =>
          c.json(
            await svc.addSpaceMember(
              deps.db,
              ctxOf(c),
              c.req.valid('param').id,
              c.req.valid('json'),
            ),
            201,
          ),
      )
      .patch(
        '/:id/members/:userId',
        requireScope('write'),
        validate('param', spaceMemberParam),
        validate('json', patchSpaceMemberSchema),
        async (c) => {
          const { id, userId } = c.req.valid('param')
          return c.json(
            await svc.patchSpaceMember(deps.db, ctxOf(c), id, userId, c.req.valid('json').role),
          )
        },
      )
      .delete(
        '/:id/members/:userId',
        requireScope('write'),
        validate('param', spaceMemberParam),
        async (c) => {
          const { id, userId } = c.req.valid('param')
          await svc.removeSpaceMember(deps.db, ctxOf(c), id, userId)
          return c.body(null, 204)
        },
      )
  )
}

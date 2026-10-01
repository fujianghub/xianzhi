/** /api/v1/task-lists（02 §9、ADR-0044、REQ-TASK-029）：本人的清单与文件夹。 */
import { Hono } from 'hono'
import {
  createTaskListSchema,
  patchTaskListSchema,
  taskListIdParam,
} from '../../shared/schemas/taskLists.ts'
import { type Actor, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/task-lists.ts'
import type { AppEnv } from '../types.ts'

export function taskListRoutes(deps: { db: Db }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): svc.TaskListCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) =>
      c.json({
        items: await svc.listTaskLists(deps.db, ctxOf(c)),
        nextCursor: null,
        canCreate: can(ctxOf(c).actor, 'task_list.create', null),
      }),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createTaskListSchema),
      async (c) => c.json(await svc.createTaskList(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', taskListIdParam),
      validate('json', patchTaskListSchema),
      async (c) =>
        c.json(
          await svc.patchTaskList(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', taskListIdParam), async (c) => {
      await svc.deleteTaskList(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

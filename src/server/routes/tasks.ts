/** /api/v1/tasks（02 §9；T1-003 读路径 + CRUD、T1-037 幂等 / 回收站）：校验 → service → 序列化。complete / batch / watchers 在后续任务。 */
import { Hono } from 'hono'
import {
  addWatcherSchema,
  batchTasksSchema,
  createTaskSchema,
  taskIdParam as idParam,
  listTasksQuery,
  patchTaskSchema,
  taskTransitionSchema,
  taskWatcherParam,
} from '../../shared/schemas/tasks.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/tasks.ts'
import type { AppEnv } from '../types.ts'

/** complete / uncomplete 允许空体；有体时按 taskTransitionSchema 校验。 */
async function transition(req: Request): Promise<{ ifUpdatedAt?: string }> {
  const text = await req.clone().text()
  if (!text.trim()) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw AppError.validation([{ path: '', message: '请求体不是 JSON' }])
  }
  const r = taskTransitionSchema.safeParse(raw)
  if (!r.success)
    throw AppError.validation(
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  return r.data
}

export function taskRoutes(deps: { db: Db; dataDir: string }) {
  const ctxOf = (c: {
    var: AppEnv['Variables']
    req: { raw: Request; header: (n: string) => string | undefined }
  }): svc.TaskCtx => {
    if (!c.var.actor || !c.var.workspaceId || !c.var.user) throw AppError.unauthenticated()
    return {
      actor: c.var.actor as Actor,
      workspaceId: c.var.workspaceId,
      timezone: c.var.user.timezone,
      weekStartsOn: c.var.user.weekStartsOn,
      dataDir: deps.dataDir,
      ip: clientIp(c.req.raw.headers),
      userAgent: c.req.header('user-agent') ?? null,
    }
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', listTasksQuery), async (c) =>
      c.json(await svc.listTasks(deps.db, ctxOf(c), c.req.valid('query'))),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createTaskSchema),
      async (c) => c.json(await svc.createTask(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .post('/batch', requireScope('write'), validate('json', batchTasksSchema), async (c) =>
      c.json(await svc.batchTasks(deps.db, ctxOf(c), c.req.valid('json').ops)),
    )
    .get('/:id', validate('param', idParam), async (c) =>
      c.json(await svc.getTask(deps.db, ctxOf(c), c.req.valid('param').id)),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchTaskSchema),
      async (c) =>
        c.json(
          await svc.patchTask(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      const id = c.req.valid('param').id
      if (c.req.query('permanent') === '1') await svc.permanentlyDeleteTask(deps.db, ctxOf(c), id)
      else await svc.softDeleteTask(deps.db, ctxOf(c), id)
      return c.body(null, 204)
    })
    .post('/:id/complete', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(
        await svc.completeTask(
          deps.db,
          ctxOf(c),
          c.req.valid('param').id,
          (await transition(c.req.raw)).ifUpdatedAt,
        ),
      ),
    )
    .post('/:id/uncomplete', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(
        await svc.uncompleteTask(
          deps.db,
          ctxOf(c),
          c.req.valid('param').id,
          (await transition(c.req.raw)).ifUpdatedAt,
        ),
      ),
    )
    .post('/:id/restore', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(await svc.restoreTask(deps.db, ctxOf(c), c.req.valid('param').id)),
    )
    .get('/:id/watchers', validate('param', idParam), async (c) =>
      c.json({
        items: await svc.listWatchers(deps.db, ctxOf(c), c.req.valid('param').id),
        nextCursor: null,
      }),
    )
    .post(
      '/:id/watchers',
      requireScope('write'),
      validate('param', idParam),
      validate('json', addWatcherSchema),
      async (c) =>
        c.json(
          {
            items: await svc.addWatcher(
              deps.db,
              ctxOf(c),
              c.req.valid('param').id,
              c.req.valid('json').userId,
            ),
            nextCursor: null,
          },
          201,
        ),
    )
    .delete(
      '/:id/watchers/:userId',
      requireScope('write'),
      validate('param', taskWatcherParam),
      async (c) => {
        const { id, userId } = c.req.valid('param')
        await svc.removeWatcher(deps.db, ctxOf(c), id, userId)
        return c.body(null, 204)
      },
    )
}

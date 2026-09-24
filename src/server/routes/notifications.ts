/** /api/v1/notifications*（02 §9）：本人通知的读取与标记、偏好（REQ-NOTIF-006）。push 订阅在 Phase 2。 */
import { Hono } from 'hono'
import { listNotificationsQuery, putPreferencesSchema } from '../../shared/schemas/notifications.ts'
import { idParam } from '../../shared/schemas/workspace.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { requireAuth } from '../middleware/session.ts'
import * as svc from '../services/notifications.ts'
import type { AppEnv } from '../types.ts'

export function notificationRoutes(deps: { db: Db }) {
  const uid = (c: { var: AppEnv['Variables'] }) => {
    if (!c.var.user) throw AppError.unauthenticated()
    return c.var.user.id
  }
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', listNotificationsQuery), async (c) =>
      c.json(await svc.listNotifications(deps.db, uid(c), c.req.valid('query'))),
    )
    .get('/preferences', async (c) => c.json(await svc.getPreferences(deps.db, uid(c))))
    .put('/preferences', validate('json', putPreferencesSchema), async (c) =>
      c.json(await svc.putPreferences(deps.db, uid(c), c.req.valid('json'))),
    )
    .post('/read-all', async (c) => c.json({ updated: await svc.markAllRead(deps.db, uid(c)) }))
    .post('/:id/read', validate('param', idParam), async (c) => {
      await svc.markRead(deps.db, uid(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
    .post('/:id/archive', validate('param', idParam), async (c) => {
      await svc.archive(deps.db, uid(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

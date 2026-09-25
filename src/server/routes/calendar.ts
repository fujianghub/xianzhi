/** /api/v1/calendars · /api/v1/calendar-events（ADR-0009、02 §9、REQ-CAL-001 ~ 007）。 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  calendarEventsQuery,
  createCalendarEventSchema,
  createCalendarSchema,
  deleteCalendarEventQuery,
  patchCalendarEventSchema,
  patchCalendarSchema,
} from '../../shared/schemas/calendar.ts'
import { uuidSchema } from '../../shared/schemas/common.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/calendar.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: uuidSchema })

const ctxOf = (c: { var: AppEnv['Variables'] }): svc.CalCtx => {
  if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
  return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId }
}

export function calendarRoutes(deps: { db: Db }) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) =>
      c.json({ items: await svc.listCalendars(deps.db, ctxOf(c)), nextCursor: null }),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createCalendarSchema),
      async (c) => c.json(await svc.createCalendar(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchCalendarSchema),
      async (c) =>
        c.json(
          await svc.patchCalendar(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      await svc.deleteCalendar(deps.db, ctxOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    })
}

export function calendarEventRoutes(deps: { db: Db }) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', calendarEventsQuery), async (c) => {
      const q = c.req.valid('query')
      const items = await svc.listOccurrences(deps.db, ctxOf(c), new Date(q.from), new Date(q.to))
      return c.json({ items, nextCursor: null })
    })
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createCalendarEventSchema),
      async (c) => c.json(await svc.createEvent(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchCalendarEventSchema),
      async (c) =>
        c.json(
          await svc.patchEvent(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('query', deleteCalendarEventQuery),
      async (c) => {
        const q = c.req.valid('query')
        await svc.deleteEvent(
          deps.db,
          ctxOf(c),
          c.req.valid('param').id,
          q.scope,
          q.occurrenceStart,
        )
        return c.body(null, 204)
      },
    )
}

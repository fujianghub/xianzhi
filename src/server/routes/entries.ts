/** /api/v1/entries（02 §9；T0-013 最小 CRUD + T0-015 快照）。导出 / 反链 / 预览在 Phase 1。 */
import { Hono } from 'hono'
import { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import {
  createEntrySchema,
  createSnapshotSchema,
  entryDetailQuery,
  listEntriesQuery,
  moveEntrySchema,
  patchEntrySchema,
} from '../../shared/schemas/entries.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/entries.ts'
import * as tree from '../services/entry-tree.ts'
import { listBacklinks } from '../services/links.ts'
import * as snap from '../services/snapshots.ts'
import type { AppEnv } from '../types.ts'

/** 记录 id 必须是 UUID：非法 id 422，而不是让 PG 类型转换报 500。 */
const idParam = z.object({ id: uuidSchema })
const snapParam = z.object({ id: uuidSchema, sid: uuidSchema })

export function entryRoutes(deps: { db: Db }) {
  const ctxOf = (c: {
    var: AppEnv['Variables']
    req: { raw: Request; header: (n: string) => string | undefined }
  }): svc.EntryCtx => {
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
    .get('/', validate('query', listEntriesQuery), async (c) =>
      c.json(await svc.listEntries(deps.db, ctxOf(c), c.req.valid('query'))),
    )
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createEntrySchema),
      async (c) => c.json(await svc.createEntry(deps.db, ctxOf(c), c.req.valid('json')), 201),
    )
    .get('/:id', validate('param', idParam), validate('query', entryDetailQuery), async (c) =>
      c.json(
        await svc.getEntry(deps.db, ctxOf(c), c.req.valid('param').id, {
          withBody: c.req.valid('query').withBody,
        }),
      ),
    )
    .patch(
      '/:id',
      requireScope('write'),
      validate('param', idParam),
      validate('json', patchEntrySchema),
      async (c) =>
        c.json(
          await svc.patchEntry(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/:id', requireScope('write'), validate('param', idParam), async (c) => {
      const id = c.req.valid('param').id
      if (c.req.query('permanent') === '1') await svc.permanentlyDeleteEntry(deps.db, ctxOf(c), id)
      else await svc.softDeleteEntry(deps.db, ctxOf(c), id)
      return c.body(null, 204)
    })
    .post('/:id/restore', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(await svc.restoreEntry(deps.db, ctxOf(c), c.req.valid('param').id)),
    )
    .post('/:id/archive', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(await svc.archiveEntry(deps.db, ctxOf(c), c.req.valid('param').id, true)),
    )
    .post('/:id/unarchive', requireScope('write'), validate('param', idParam), async (c) =>
      c.json(await svc.archiveEntry(deps.db, ctxOf(c), c.req.valid('param').id, false)),
    )
    .patch(
      '/:id/move',
      requireScope('write'),
      validate('param', idParam),
      validate('json', moveEntrySchema),
      async (c) =>
        c.json(
          await tree.moveEntry(deps.db, ctxOf(c), c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .get('/:id/backlinks', validate('param', idParam), async (c) =>
      c.json({ items: await listBacklinks(deps.db, ctxOf(c), c.req.valid('param').id) }),
    )
    .get('/:id/preview', validate('param', idParam), async (c) =>
      c.json(await svc.previewEntry(deps.db, ctxOf(c), c.req.valid('param').id)),
    )
    .get('/:id/snapshots', validate('param', idParam), async (c) =>
      c.json({
        items: await snap.listSnapshots(deps.db, ctxOf(c), c.req.valid('param').id),
        nextCursor: null,
      }),
    )
    .post(
      '/:id/snapshots',
      requireScope('write'),
      validate('param', idParam),
      validate('json', createSnapshotSchema),
      async (c) =>
        c.json(
          await snap.markSnapshot(
            deps.db,
            ctxOf(c),
            c.req.valid('param').id,
            c.req.valid('json').label,
          ),
          201,
        ),
    )
    .get('/:id/snapshots/:sid/content', validate('param', snapParam), async (c) => {
      const { id, sid } = c.req.valid('param')
      return c.json(await snap.getSnapshotContent(deps.db, ctxOf(c), id, sid))
    })
    .post(
      '/:id/snapshots/:sid/restore',
      requireScope('write'),
      validate('param', snapParam),
      async (c) => {
        const { id, sid } = c.req.valid('param')
        return c.json(await snap.restoreSnapshot(deps.db, ctxOf(c), id, sid), 202)
      },
    )
    .get('/:id/snapshots/:sid', validate('param', snapParam), async (c) => {
      const { id, sid } = c.req.valid('param')
      const bin = await snap.getSnapshotBinary(deps.db, ctxOf(c), id, sid)
      return c.body(new Uint8Array(bin), 200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400',
      })
    })
}

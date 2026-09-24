/** /api/v1/exports · /api/v1/jobs（02 §8 · §9、REQ-EXPORT-001 · 008）。 */
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import { createExportSchema } from '../../shared/schemas/exports.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import type { JobQueue } from '../lib/job-queue.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/exports.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: z.string().min(1).max(64) })
const disposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`

export function exportRoutes(deps: { db: Db; dataDir: string; queue: () => JobQueue }) {
  const ctxOf = (c: { var: AppEnv['Variables'] }): svc.ExportCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return {
      actor: c.var.actor as Actor,
      workspaceId: c.var.workspaceId,
      dataDir: deps.dataDir,
      queue: deps.queue(),
    }
  }
  const exportsApp = new Hono<AppEnv>()
    .use(requireAuth)
    .post(
      '/',
      requireScope('write'),
      idempotency(deps.db),
      validate('json', createExportSchema),
      async (c) => c.json(await svc.requestExport(deps.db, ctxOf(c), c.req.valid('json')), 202),
    )
  const jobsApp = new Hono<AppEnv>()
    .use(requireAuth)
    .get('/:id', validate('param', idParam), async (c) =>
      c.json(await svc.getJob(ctxOf(c), c.req.valid('param').id)),
    )
    .get('/:id/download', validate('param', idParam), async (c) => {
      const f = await svc.jobDownload(ctxOf(c), c.req.valid('param').id)
      return c.body(Readable.toWeb(createReadStream(f.path)) as ReadableStream, 200, {
        'Content-Type': f.mime,
        'Content-Length': String(f.size),
        'Content-Disposition': disposition(f.fileName),
        'Cache-Control': 'private, no-store',
      })
    })
  return { exportsApp, jobsApp }
}

/** POST /entries/:id/export?format=md|html：单篇同步导出，与 entries 路由同前缀独立挂载。 */
export function entryExportRoutes(deps: { db: Db; dataDir: string }) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .post(
      '/:id/export',
      validate('param', z.object({ id: uuidSchema })),
      validate('query', z.object({ format: z.enum(['md', 'html']).default('md') })),
      async (c) => {
        if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
        const f = await svc.exportEntryNow(
          deps.db,
          { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId, dataDir: deps.dataDir },
          c.req.valid('param').id,
          c.req.valid('query').format,
        )
        return c.body(f.bytes as unknown as ArrayBuffer, 200, {
          'Content-Type': f.mime,
          'Content-Disposition': disposition(f.name),
        })
      },
    )
}

/**
 * 健康检查（02 §1、05 §10、REQ-OPS-001）：
 * GET /api/health 公开 { ok, version }；GET /api/health/details 需 admin 或 API Key scope admin。
 */
import { statfs } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import type { AppEnv } from '../types.ts'

export function healthRoutes(deps: { db: Db; version: string; dataDir: string }) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json({ ok: true, version: deps.version }))
    .get('/details', async (c) => {
      if (!c.var.user) throw AppError.unauthenticated()
      if (c.var.authKind === 'apikey' && c.var.apiKeyScope !== 'admin')
        throw new AppError(403, 'SCOPE', '需要 admin scope')
      if (!can(c.var.actor, 'workspace.manage', null)) throw AppError.forbidden()
      const t = performance.now()
      await deps.db.execute(sql`select 1`)
      const dbLatencyMs = Math.round((performance.now() - t) * 10) / 10
      let diskFreeBytes: number | null = null
      try {
        const s = await statfs(deps.dataDir)
        diskFreeBytes = Number(s.bavail) * Number(s.bsize)
      } catch {
        diskFreeBytes = null
      }
      return c.json({
        ok: true,
        version: deps.version,
        dbLatencyMs,
        queueBacklog: 0, // T0-026 接 pg-boss
        collabConnections: null, // T0-014 接 collab
        diskFreeBytes,
      })
    })
}

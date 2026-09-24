/** POST /api/v1/collab/token（02 §9、REQ-COLLAB-002）：无 entry.read → 404（不泄露存在性）。 */
import { Hono } from 'hono'
import { collabTokenRequestSchema } from '../../shared/schemas/collab.ts'
import { can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { signCollabToken } from '../lib/collab-token.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { requireAuth } from '../middleware/session.ts'
import { loadEntry } from '../services/entries.ts'
import type { AppEnv } from '../types.ts'

export function collabRoutes(deps: { db: Db; secret: string }) {
  return new Hono<AppEnv>().post(
    '/token',
    requireAuth,
    validate('json', collabTokenRequestSchema),
    async (c) => {
      const actor = c.var.actor
      if (!actor) throw AppError.unauthenticated()
      const { entryId } = c.req.valid('json')
      const loaded = await loadEntry(deps.db, actor, entryId)
      if (!loaded || !can(actor, 'entry.read', loaded.ref)) throw AppError.notFound('记录不存在')
      const t = signCollabToken(deps.secret, actor.id, entryId)
      return c.json({ token: t.token, expiresAt: t.expiresAt })
    },
  )
}

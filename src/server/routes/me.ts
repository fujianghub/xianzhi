/** /api/v1/me*（02 §9；REQ-WS-010、REQ-AUTH-009 · 010、REQ-READ-001 偏好）。Key 与会话管理只对 Cookie 会话开放（API Key 请求 403 SCOPE）。 */
import { Hono, type MiddlewareHandler } from 'hono'
import { patchPreferencesSchema } from '../../shared/schemas/preferences.ts'
import {
  createKeySchema,
  idParam,
  meAccountPatchSchema,
  mePasswordSchema,
  mePatchSchema,
} from '../../shared/schemas/workspace.ts'
import type { Auth } from '../auth.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as me from '../services/me.ts'
import * as prefs from '../services/preferences.ts'
import * as users from '../services/users.ts'
import type { AppEnv } from '../types.ts'

export function meRoutes(deps: { db: Db; auth: Auth }) {
  const ctxOf = (c: {
    var: AppEnv['Variables']
    req: { raw: Request; header: (n: string) => string | undefined }
  }): me.MeCtx => {
    if (!c.var.actor || !c.var.user || !c.var.workspaceId || !c.var.workspaceRole)
      throw AppError.unauthenticated()
    return {
      actor: c.var.actor as Actor,
      user: c.var.user,
      workspaceId: c.var.workspaceId,
      workspaceRole: c.var.workspaceRole,
      headers: c.req.raw.headers,
      ip: clientIp(c.req.raw.headers),
      userAgent: c.req.header('user-agent') ?? null,
    }
  }
  const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.var.authKind === 'apikey') throw new AppError(403, 'SCOPE', '会话与 Key 管理仅限登录会话')
    await next()
  }

  return (
    new Hono<AppEnv>()
      .use(requireAuth)
      .get('/', (c) => c.json(me.meView(ctxOf(c))))
      .patch('/', validate('json', mePatchSchema), async (c) =>
        c.json(await me.updateMe(deps.db, ctxOf(c), c.req.valid('json'))),
      )
      // 阅读与写作偏好（ADR-0024）：按键合并
      .get('/preferences', async (c) =>
        c.json(await prefs.getPreferences(deps.db, ctxOf(c).actor.id)),
      )
      .patch(
        '/preferences',
        requireScope('write'),
        validate('json', patchPreferencesSchema),
        async (c) =>
          c.json(await prefs.patchPreferences(deps.db, ctxOf(c).actor.id, c.req.valid('json'))),
      )
      // 改用户名 / 邮箱（REQ-WS-022）、改密码（REQ-AUTH-021）：仅登录会话
      .patch('/account', sessionOnly, validate('json', meAccountPatchSchema), async (c) => {
        const ctx = ctxOf(c)
        await users.updateMyAccount(deps.db, deps.auth, ctx, c.req.valid('json'))
        return c.json(await me.loadMe(deps.db, ctx))
      })
      .post('/password', sessionOnly, validate('json', mePasswordSchema), async (c) => {
        const ctx = ctxOf(c)
        const cur = await deps.auth.api.getSession({ headers: ctx.headers })
        return c.json(
          await users.changeMyPassword(
            deps.db,
            deps.auth,
            { ...ctx, currentSessionId: cur?.session.id ?? null },
            c.req.valid('json'),
          ),
        )
      })
      .get('/sessions', sessionOnly, async (c) =>
        c.json({ items: await me.listSessions(deps.db, deps.auth, ctxOf(c)), nextCursor: null }),
      )
      .delete('/sessions/:id', sessionOnly, validate('param', idParam), async (c) => {
        await me.deleteSession(deps.db, ctxOf(c), c.req.valid('param').id)
        return c.body(null, 204)
      })
      .get('/keys', async (c) =>
        c.json({ items: await me.listKeys(deps.db, ctxOf(c)), nextCursor: null }),
      )
      .post('/keys', sessionOnly, validate('json', createKeySchema), async (c) =>
        c.json(await me.createKey(deps.db, deps.auth, ctxOf(c), c.req.valid('json')), 201),
      )
      .delete('/keys/:id', sessionOnly, validate('param', idParam), async (c) => {
        await me.revokeKey(deps.db, ctxOf(c), c.req.valid('param').id)
        return c.body(null, 204)
      })
  )
}

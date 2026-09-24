/**
 * /api/v1/workspace/*（02 §9）：校验 → service → 序列化。
 * T0-010 邀请五端点；T0-011 工作区信息、成员管理、owner 转让、审计日志。
 * 未实现（Phase 1/2）：`DELETE /members/:userId?purge=1`（REQ-WS-015）、`transfer-content`（REQ-WS-016）。
 */
import { Hono } from 'hono'
import {
  acceptInvitationSchema,
  auditLogQuerySchema,
  createInvitationSchema,
  invitationIdParam,
  memberRolePatchSchema,
  ownerTransferSchema,
  userIdParam,
  workspacePatchSchema,
} from '../../shared/schemas/workspace.ts'
import type { Auth } from '../auth.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { clientIp } from '../middleware/request-context.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import { listAuditLog } from '../services/audit.ts'
import { issueCaptchaPass } from '../services/captcha.ts'
import * as inv from '../services/invitations.ts'
import * as members from '../services/members.ts'
import { getWorkspace, updateWorkspace } from '../services/workspace.ts'
import type { AppEnv } from '../types.ts'

type Ctx = {
  var: AppEnv['Variables']
  req: { raw: Request; header: (n: string) => string | undefined }
}

export function workspaceRoutes(deps: { db: Db; auth: Auth; appUrl: string }) {
  const base = (c: Ctx) => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return {
      actor: c.var.actor as Actor,
      workspaceId: c.var.workspaceId,
      ip: clientIp(c.req.raw.headers),
      userAgent: c.req.header('user-agent') ?? null,
    }
  }
  const inviteCtx = (c: Ctx): inv.InviteCtx => ({ ...base(c), appUrl: deps.appUrl })

  return (
    new Hono<AppEnv>()
      // ---- 工作区信息（REQ-WS-001） ----
      .get('/', requireAuth, async (c) => c.json(await getWorkspace(deps.db, base(c).workspaceId)))
      .patch(
        '/',
        requireAuth,
        requireScope('admin'),
        validate('json', workspacePatchSchema),
        async (c) => c.json(await updateWorkspace(deps.db, base(c), c.req.valid('json'))),
      )
      // ---- 公开：邀请页读取与接受（受邀者尚无账号） ----
      .get('/invitations/:id', validate('param', invitationIdParam), async (c) =>
        c.json(await inv.getInvitationPublic(deps.db, c.req.valid('param').id)),
      )
      .post(
        '/invitations/:id/accept',
        validate('param', invitationIdParam),
        validate('json', acceptInvitationSchema),
        async (c) => {
          const r = await inv.acceptInvitation(
            deps.db,
            deps.auth,
            c.req.valid('param').id,
            c.req.valid('json'),
            {
              ip: clientIp(c.req.raw.headers),
              userAgent: c.req.header('user-agent') ?? null,
            },
          )
          // 紧随其后的自动登录免一次拼图（ADR-0006）：60 s 一次性通行证
          return c.json(
            { userId: r.userId, role: r.role, captchaPass: await issueCaptchaPass(deps.db) },
            201,
          )
        },
      )
      // ---- 邀请（admin） ----
      .get('/invitations', requireAuth, async (c) =>
        c.json({ items: await inv.listInvitations(deps.db, inviteCtx(c)), nextCursor: null }),
      )
      .post(
        '/invitations',
        requireAuth,
        requireScope('admin'),
        idempotency(deps.db),
        validate('json', createInvitationSchema),
        async (c) =>
          c.json(await inv.createInvitation(deps.db, inviteCtx(c), c.req.valid('json')), 201),
      )
      .delete(
        '/invitations/:id',
        requireAuth,
        requireScope('admin'),
        validate('param', invitationIdParam),
        async (c) => {
          await inv.cancelInvitation(deps.db, inviteCtx(c), c.req.valid('param').id)
          return c.body(null, 204)
        },
      )
      // ---- 成员（REQ-WS-002 · 003 · 004 · 013 · 014、REQ-AUTH-009） ----
      .get('/members', requireAuth, async (c) =>
        c.json({ items: await members.listMembers(deps.db, base(c)), nextCursor: null }),
      )
      .delete('/members/me', requireAuth, requireScope('admin'), async (c) => {
        const ctx = base(c)
        await members.removeMember(deps.db, ctx, ctx.actor.id)
        return c.body(null, 204)
      })
      .patch(
        '/members/:userId',
        requireAuth,
        requireScope('admin'),
        validate('param', userIdParam),
        validate('json', memberRolePatchSchema),
        async (c) =>
          c.json(
            await members.changeRole(
              deps.db,
              base(c),
              c.req.valid('param').userId,
              c.req.valid('json').role,
            ),
          ),
      )
      .delete(
        '/members/:userId',
        requireAuth,
        requireScope('admin'),
        validate('param', userIdParam),
        async (c) => {
          if (c.req.query('purge') === '1')
            throw AppError.validation([
              { path: 'purge', message: '注销账号（REQ-WS-015）在 Phase 2 实现' },
            ])
          await members.removeMember(deps.db, base(c), c.req.valid('param').userId)
          return c.body(null, 204)
        },
      )
      .post(
        '/members/:userId/suspend',
        requireAuth,
        requireScope('admin'),
        validate('param', userIdParam),
        async (c) => {
          await members.suspendMember(deps.db, base(c), c.req.valid('param').userId)
          return c.body(null, 204)
        },
      )
      .post(
        '/members/:userId/unsuspend',
        requireAuth,
        requireScope('admin'),
        validate('param', userIdParam),
        async (c) => {
          await members.unsuspendMember(deps.db, base(c), c.req.valid('param').userId)
          return c.body(null, 204)
        },
      )
      .post(
        '/members/:userId/revoke-sessions',
        requireAuth,
        requireScope('admin'),
        validate('param', userIdParam),
        async (c) =>
          c.json(await members.revokeSessions(deps.db, base(c), c.req.valid('param').userId)),
      )
      .post(
        '/owner-transfer',
        requireAuth,
        requireScope('admin'),
        validate('json', ownerTransferSchema),
        async (c) => {
          await members.transferOwner(deps.db, base(c), c.req.valid('json').toUserId)
          return c.body(null, 204)
        },
      )
      // ---- 审计（REQ-WS-005） ----
      .get('/audit-log', requireAuth, validate('query', auditLogQuerySchema), async (c) => {
        const ctx = base(c)
        return c.json(await listAuditLog(deps.db, ctx.actor, ctx.workspaceId, c.req.valid('query')))
      })
  )
}

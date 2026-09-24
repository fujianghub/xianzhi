/**
 * session()（02 §2）：解析 Better Auth Cookie 会话或 `Authorization: Bearer xz_<key>`，
 * 写入 c.var.user / workspaceRole / actor / apiKeyScope。未登录不在此拒绝（由 requireAuth 决定）。
 * 被移除的成员（无 member 行）视为未登录（REQ-AUTH-014）；停用（banned）→ actor.suspended。
 */
import { and, eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '../../shared/schemas/enums.ts'
import type { Auth } from '../auth.ts'
import type { Db } from '../db/index.ts'
import { member, user as userTable } from '../db/schema/auth.ts'
import { AppError } from '../lib/errors.ts'
import type { AppEnv, SessionUser } from '../types.ts'

const SCOPE_RANK: Record<ApiKeyScope, number> = { read: 1, write: 2, admin: 3 }
const ROLE_AS_SCOPE: Record<WorkspaceRole, ApiKeyScope> = {
  owner: 'admin',
  admin: 'admin',
  member: 'write',
  guest: 'read',
}

/** 有效 scope = min(scope, 角色)（02 §2）。 */
export function effectiveScope(scope: ApiKeyScope, role: WorkspaceRole): ApiKeyScope {
  const byRole = ROLE_AS_SCOPE[role]
  return SCOPE_RANK[scope] <= SCOPE_RANK[byRole] ? scope : byRole
}

async function loadMembership(db: Db, userId: string) {
  const rows = await db
    .select({
      u: userTable,
      role: member.role,
      workspaceId: member.organizationId,
    })
    .from(userTable)
    .leftJoin(member, and(eq(member.userId, userTable.id)))
    .where(eq(userTable.id, userId))
    .limit(1)
  return rows[0] ?? null
}

function toSessionUser(u: typeof userTable.$inferSelect): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName ?? null,
    locale: u.locale ?? 'zh-CN',
    timezone: u.timezone ?? 'Asia/Shanghai',
    weekStartsOn: u.weekStartsOn ?? 1,
    banned: u.banned ?? false,
  }
}

export function session(auth: Auth, db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authz = c.req.header('authorization')
    let userId: string | null = null
    let apiKeyScope: ApiKeyScope | null = null

    if (authz?.startsWith('Bearer ')) {
      const key = authz.slice(7).trim()
      if (!key.startsWith('xz_')) throw AppError.unauthenticated('API Key 格式错误')
      const r = await auth.api.verifyApiKey({ body: { key } })
      if (!r.valid || !r.key) {
        if (r.error?.code === 'RATE_LIMITED') throw AppError.rateLimited('API Key 超出限流')
        throw AppError.unauthenticated('API Key 无效或已过期')
      }
      userId = r.key.referenceId
      const meta = (r.key.metadata ?? {}) as { scope?: string }
      apiKeyScope = API_KEY_SCOPES.includes(meta.scope as ApiKeyScope)
        ? (meta.scope as ApiKeyScope)
        : 'read'
      c.set('authKind', 'apikey')
    } else {
      const s = await auth.api.getSession({ headers: c.req.raw.headers })
      if (s?.user) {
        userId = s.user.id
        c.set('authKind', 'session')
      }
    }

    if (userId) {
      const row = await loadMembership(db, userId)
      if (row?.role && WORKSPACE_ROLES.includes(row.role as WorkspaceRole)) {
        const role = row.role as WorkspaceRole
        const su = toSessionUser(row.u)
        c.set('user', su)
        c.set('workspaceId', row.workspaceId)
        c.set('workspaceRole', role)
        c.set('actor', { id: su.id, workspaceRole: role, suspended: su.banned })
        if (apiKeyScope) c.set('apiKeyScope', effectiveScope(apiKeyScope, role))
      } else {
        // 已被移除的成员：视为未登录（REQ-AUTH-014）
        c.set('authKind', null)
      }
    }
    await next()
  }
}

/** 路由级：必须登录且未停用。 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) throw AppError.unauthenticated()
  if (c.var.user.banned) throw AppError.unauthenticated('账号已停用')
  await next()
}

/** API Key 的 scope 门槛（02 §3 `SCOPE`）；Cookie 会话不受此限。 */
export function requireScope(min: ApiKeyScope): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.var.authKind === 'apikey') {
      const s = c.var.apiKeyScope ?? 'read'
      if (SCOPE_RANK[s] < SCOPE_RANK[min]) throw new AppError(403, 'SCOPE', `需要 ${min} scope`)
    }
    await next()
  }
}

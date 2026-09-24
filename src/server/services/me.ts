/**
 * 本人资料 / 会话 / API Key（02 §9 `/me*`；REQ-WS-010、REQ-AUTH-009 · 010）。
 * Key 的创建 / 吊销经 Better Auth api-key 插件，这里补 audit（api_key.created / revoked）与 scope 写入 metadata。
 */
import { and, desc, eq } from 'drizzle-orm'
import type { ApiKeyScope, WorkspaceRole } from '../../shared/schemas/enums.ts'
import type { Auth } from '../auth.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { apikey, session, user } from '../db/schema/auth.ts'
import { AppError } from '../lib/errors.ts'
import type { SessionUser } from '../types.ts'
import { audit } from './audit.ts'

export interface MeCtx {
  actor: Actor
  user: SessionUser
  workspaceId: string
  workspaceRole: WorkspaceRole
  headers: Headers
  ip?: string | null
  userAgent?: string | null
}

export function meView(ctx: MeCtx) {
  const u = ctx.user
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName,
    locale: u.locale,
    timezone: u.timezone,
    weekStartsOn: u.weekStartsOn,
    workspaceId: ctx.workspaceId,
    workspaceRole: ctx.workspaceRole,
  }
}

export async function updateMe(
  db: Db,
  ctx: MeCtx,
  patch: { displayName?: string | null; locale?: string; timezone?: string; weekStartsOn?: number },
) {
  await db
    .update(user)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(user.id, ctx.actor.id))
  const [u] = await db.select().from(user).where(eq(user.id, ctx.actor.id)).limit(1)
  if (!u) throw AppError.notFound()
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName ?? null,
    locale: u.locale ?? 'zh-CN',
    timezone: u.timezone ?? 'Asia/Shanghai',
    weekStartsOn: u.weekStartsOn ?? 1,
    workspaceId: ctx.workspaceId,
    workspaceRole: ctx.workspaceRole,
  }
}

export async function listSessions(db: Db, auth: Auth, ctx: MeCtx) {
  const current = await auth.api.getSession({ headers: ctx.headers })
  const rows = await db
    .select()
    .from(session)
    .where(eq(session.userId, ctx.actor.id))
    .orderBy(desc(session.createdAt))
  return rows.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: current?.session.id === s.id,
  }))
}

export async function deleteSession(db: Db, ctx: MeCtx, id: string): Promise<void> {
  const r = await db
    .delete(session)
    .where(and(eq(session.id, id), eq(session.userId, ctx.actor.id)))
    .returning({ id: session.id })
  if (!r[0]) throw AppError.notFound()
}

const parseMeta = (m: string | Record<string, unknown> | null): Record<string, unknown> => {
  if (!m) return {}
  if (typeof m === 'object') return m
  try {
    return JSON.parse(m) as Record<string, unknown>
  } catch {
    return {}
  }
}

export interface KeyView {
  id: string
  name: string | null
  start: string | null
  scope: ApiKeyScope
  enabled: boolean
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

const keyView = (k: typeof apikey.$inferSelect): KeyView => ({
  id: k.id,
  name: k.name,
  start: k.start,
  scope: (parseMeta(k.metadata).scope as ApiKeyScope) ?? 'read',
  enabled: k.enabled ?? true,
  expiresAt: k.expiresAt?.toISOString() ?? null,
  lastUsedAt: k.lastRequest?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(),
})

export async function listKeys(db: Db, ctx: MeCtx): Promise<KeyView[]> {
  const rows = await db
    .select()
    .from(apikey)
    .where(eq(apikey.referenceId, ctx.actor.id))
    .orderBy(desc(apikey.createdAt))
  return rows.map(keyView)
}

export async function createKey(
  db: Db,
  auth: Auth,
  ctx: MeCtx,
  input: { name: string; scope: ApiKeyScope; expiresAt?: string },
): Promise<KeyView & { key: string }> {
  const expiresIn = input.expiresAt
    ? Math.max(60, Math.floor((new Date(input.expiresAt).getTime() - Date.now()) / 1000))
    : undefined
  const created = await auth.api.createApiKey({
    body: {
      name: input.name,
      metadata: { scope: input.scope },
      ...(expiresIn ? { expiresIn } : {}),
    },
    headers: ctx.headers,
  })
  const [row] = await db.select().from(apikey).where(eq(apikey.id, created.id)).limit(1)
  if (!row) throw new Error('api key row missing after create')
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: row.id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta: { name: input.name, scope: input.scope, expiresAt: input.expiresAt ?? null },
  })
  return { ...keyView(row), key: created.key }
}

export async function revokeKey(db: Db, ctx: MeCtx, id: string): Promise<void> {
  const r = await db
    .delete(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.referenceId, ctx.actor.id)))
    .returning({ id: apikey.id, name: apikey.name })
  if (!r[0]) throw AppError.notFound()
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta: { name: r[0].name },
  })
}

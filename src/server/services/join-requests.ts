/**
 * 开放注册 + 待审批（ADR-0008；REQ-AUTH-017 · 018 · 019）。
 * - 注册：建 user（credential 账号，含 username）+ join_requests(pending)；**不建 member 行**，
 *   故会话中间件视其为未登录（REQ-AUTH-014 同一机制），登录由 loginGuard 返回 403 REGISTRATION_PENDING
 * - 审批（owner/admin，can('member.approve')）：member(role) → 个人空间 → status=approved → audit + emit(member.joined)
 * - 驳回：删除该 user（account / session / join_requests 经 FK 级联），audit(member.rejected)
 * - 防刷：拼图（路由层）+ IP 限流（路由层）+ 待审批总量上限 PENDING_LIMIT
 */
import { and, asc, count, eq, or } from 'drizzle-orm'
import { v7 } from 'uuid'
import type { RegisterInput } from '../../shared/schemas/workspace.ts'
import type { Auth } from '../auth.ts'
import { type Actor, assertCan } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { member, user } from '../db/schema/auth.ts'
import { joinRequests } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { emit } from './events.ts'
import { MEMBER_LIMIT } from './invitations.ts'
import { ensurePersonalSpace } from './spaces.ts'
import { findWorkspace } from './workspace.ts'

/** 同时待审批的申请上限（07 §5）：超出 429，防止批量注册撑爆审批列表。 */
export const PENDING_LIMIT = 200

export interface JoinRequestView {
  id: string
  userId: string
  email: string
  username: string | null
  name: string
  createdAt: string
}

export interface JoinCtx {
  actor: Actor
  workspaceId: string
  ip?: string | null
  userAgent?: string | null
}

const uniqueErr = (path: 'email' | 'username', message: string) =>
  new AppError(409, 'CONFLICT_UNIQUE', message, { errors: [{ path, message }] })

export async function register(
  db: Db,
  auth: Auth,
  input: RegisterInput,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ status: 'pending' }> {
  const ws = await findWorkspace(db)
  if (!ws) throw AppError.badRequest('工作区尚未初始化，请联系管理员')

  const email = input.email.trim().toLowerCase()
  const username = input.username.trim().toLowerCase()
  const taken = await db
    .select({ email: user.email, username: user.username })
    .from(user)
    .where(or(eq(user.email, email), eq(user.username, username)))
    .limit(2)
  if (taken.some((u) => u.email === email)) throw uniqueErr('email', '该邮箱已注册')
  if (taken.some((u) => u.username === username)) throw uniqueErr('username', '该用户名已被使用')

  const [p] = await db
    .select({ n: count() })
    .from(joinRequests)
    .where(eq(joinRequests.status, 'pending'))
  if ((p?.n ?? 0) >= PENDING_LIMIT)
    throw AppError.rateLimited('待审批的注册申请过多，请稍后再试或联系管理员')

  const ctx = await auth.$context
  const hash = await ctx.password.hash(input.password)
  let userId: string
  try {
    const u = await ctx.internalAdapter.createUser(
      {
        email,
        name: input.name,
        displayName: input.name,
        username,
        displayUsername: input.username.trim(),
        emailVerified: false,
      },
      { method: 'email-password' },
    )
    userId = u.id
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } }
    if (e?.code === '23505' || e?.cause?.code === '23505')
      throw uniqueErr('username', '该邮箱或用户名已被使用')
    throw err
  }
  await ctx.internalAdapter.linkAccount({
    userId,
    providerId: 'credential',
    accountId: userId,
    password: hash,
  })

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(joinRequests)
      .values({ workspaceId: ws.id, userId, ip: meta.ip ?? null })
      .returning({ id: joinRequests.id })
    if (!row) throw new Error('join_requests insert failed')
    // actorId 留空：注册者尚非成员，且驳回会删号（audit_log / events 对 user 无级联）
    await audit(tx, {
      workspaceId: ws.id,
      actorId: null,
      action: 'member.registered',
      targetType: 'user',
      targetId: userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      meta: { username },
    })
    await emit(tx, {
      kind: 'member.requested',
      workspaceId: ws.id,
      actorId: null,
      targetType: 'member',
      targetId: null,
      payload: { requestId: row.id, userId, displayName: input.name, username, email },
    })
  })
  return { status: 'pending' }
}

/** 某用户是否处于待审批（loginGuard 用来给出明确提示）。 */
export async function isPending(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .where(and(eq(joinRequests.userId, userId), eq(joinRequests.status, 'pending')))
    .limit(1)
  return !!rows[0]
}

export async function listJoinRequests(db: Db, ctx: JoinCtx): Promise<JoinRequestView[]> {
  assertCan(ctx.actor, 'member.approve', null)
  const rows = await db
    .select({
      id: joinRequests.id,
      userId: user.id,
      email: user.email,
      username: user.displayUsername,
      name: user.name,
      createdAt: joinRequests.createdAt,
    })
    .from(joinRequests)
    .innerJoin(user, eq(user.id, joinRequests.userId))
    .where(and(eq(joinRequests.workspaceId, ctx.workspaceId), eq(joinRequests.status, 'pending')))
    .orderBy(asc(joinRequests.createdAt))
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

async function loadPending(db: Db, ctx: JoinCtx, id: string) {
  const [row] = await db
    .select({ r: joinRequests, u: user })
    .from(joinRequests)
    .innerJoin(user, eq(user.id, joinRequests.userId))
    .where(and(eq(joinRequests.id, id), eq(joinRequests.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!row) throw AppError.notFound('注册申请不存在')
  if (row.r.status !== 'pending') throw new AppError(409, 'CONFLICT_STALE', '该申请已处理')
  return row
}

export async function approveJoinRequest(
  db: Db,
  ctx: JoinCtx,
  id: string,
  role: 'admin' | 'member' | 'guest',
): Promise<{ userId: string; role: string }> {
  assertCan(ctx.actor, 'member.approve', null)
  const { r, u } = await loadPending(db, ctx, id)
  const [m] = await db
    .select({ n: count() })
    .from(member)
    .where(eq(member.organizationId, ctx.workspaceId))
  if ((m?.n ?? 0) >= MEMBER_LIMIT)
    throw AppError.validation([{ path: 'role', message: `成员数已达上限 ${MEMBER_LIMIT}` }])

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(joinRequests)
      .set({ status: 'approved', decidedBy: ctx.actor.id, decidedAt: new Date() })
      .where(and(eq(joinRequests.id, id), eq(joinRequests.status, 'pending')))
      .returning({ id: joinRequests.id })
    if (!updated[0]) throw new AppError(409, 'CONFLICT_STALE', '该申请已处理')
    await tx.insert(member).values({
      id: v7(),
      organizationId: ctx.workspaceId,
      userId: u.id,
      role,
      createdAt: new Date(),
    })
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, u.id))
    await ensurePersonalSpace(tx, ctx.workspaceId, u.id)
    const [approver] = await tx
      .select({ name: user.name, displayName: user.displayName })
      .from(user)
      .where(eq(user.id, ctx.actor.id))
      .limit(1)
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.approved',
      targetType: 'user',
      targetId: u.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { role, requestId: r.id },
    })
    await emit(tx, {
      kind: 'member.joined',
      workspaceId: ctx.workspaceId,
      actorId: u.id,
      targetType: 'member',
      targetId: null,
      payload: {
        userId: u.id,
        displayName: u.displayName || u.name,
        email: u.email,
        role,
        inviterId: ctx.actor.id,
        inviterName: approver?.displayName || approver?.name || '',
      },
    })
  })
  return { userId: u.id, role }
}

export async function rejectJoinRequest(db: Db, ctx: JoinCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'member.approve', null)
  const { u } = await loadPending(db, ctx, id)
  await db.transaction(async (tx) => {
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.rejected',
      targetType: 'user',
      targetId: u.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { email: u.email, username: u.username },
    })
    // 级联删除 account / session / join_requests（驳回不留账号，可重新注册）
    await tx.delete(user).where(eq(user.id, u.id))
  })
}

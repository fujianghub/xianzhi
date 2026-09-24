/**
 * 成员生命周期（T0-011；07 §4；01 §5；REQ-WS-002 · 003 · 004 · 012 · 013 · 014、REQ-AUTH-009 · 014）。
 * 所有写操作：同事务写 audit + 吊销（删 session 行、禁用 API Key），提交后经 EventBus 广播 `user.revoked`。
 * 最后一名 owner 不可降级 / 移除 / 停用（409 CONFLICT_LAST_OWNER）。
 */
import { and, count, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm'
import type { WorkspaceRole } from '../../shared/schemas/enums.ts'
import { type Actor, assertCan } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { apikey, member, session, user } from '../db/schema/auth.ts'
import { spaces, tasks } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { type EventBus, getEventBus } from '../lib/event-bus.ts'
import { audit } from './audit.ts'
import { emit } from './events.ts'

export interface MemberCtx {
  actor: Actor
  workspaceId: string
  ip?: string | null
  userAgent?: string | null
  bus?: EventBus
}

export interface MemberView {
  userId: string
  email: string
  name: string
  displayName: string | null
  role: WorkspaceRole
  status: 'active' | 'suspended'
  joinedAt: string
}

const meta = (ctx: MemberCtx) => ({ ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null })

export async function listMembers(db: Db, ctx: MemberCtx): Promise<MemberView[]> {
  // 所有成员可见成员列表（REQ-WS-002 列表本身不设 admin 门槛；settings 页用）
  const rows = await db
    .select({ m: member, u: user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.workspaceId))
    .orderBy(member.createdAt)
  return rows.map(({ m, u }) => ({
    userId: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName ?? null,
    role: m.role as WorkspaceRole,
    status: u.banned ? 'suspended' : 'active',
    joinedAt: m.createdAt.toISOString(),
  }))
}

async function loadMember(db: DbOrTx, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ m: member, u: user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
    .limit(1)
  if (!row) throw AppError.notFound('成员不存在')
  return row
}

async function ownerCount(db: DbOrTx, workspaceId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.role, 'owner')))
  return r?.n ?? 0
}

/** 目标是 owner 且是最后一名 → 409（REQ-WS-003）。 */
async function assertNotLastOwner(db: DbOrTx, workspaceId: string, role: string): Promise<void> {
  if (role === 'owner' && (await ownerCount(db, workspaceId)) <= 1) {
    throw new AppError(409, 'CONFLICT_LAST_OWNER', '至少保留一名 owner，请先转让')
  }
}

/** 对 owner 的操作只有 owner 能做。 */
function assertMayTouch(ctx: MemberCtx, targetRole: string): void {
  if (targetRole === 'owner' && ctx.actor.workspaceRole !== 'owner')
    throw AppError.forbidden('只有 owner 能操作 owner')
}

/** 同事务吊销：删全部 session 行、禁用全部 API Key（07 §4）。 */
export async function revokeAccess(
  tx: DbOrTx,
  userId: string,
): Promise<{ sessions: number; keys: number }> {
  const s = await tx.delete(session).where(eq(session.userId, userId)).returning({ id: session.id })
  const k = await tx
    .update(apikey)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(apikey.referenceId, userId), eq(apikey.enabled, true)))
    .returning({ id: apikey.id })
  return { sessions: s.length, keys: k.length }
}

const publishRevoked = (ctx: MemberCtx, userId: string) =>
  (ctx.bus ?? getEventBus()).publish('user.revoked', { userId })

export async function changeRole(
  db: Db,
  ctx: MemberCtx,
  userId: string,
  role: 'admin' | 'member' | 'guest',
): Promise<MemberView> {
  assertCan(ctx.actor, 'workspace.manage', null)
  const target = await loadMember(db, ctx.workspaceId, userId)
  assertMayTouch(ctx, target.m.role)
  await db.transaction(async (tx) => {
    await assertNotLastOwner(tx, ctx.workspaceId, target.m.role)
    await tx.update(member).set({ role }).where(eq(member.id, target.m.id))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.role_changed',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { from: target.m.role, to: role },
    })
  })
  // 角色收窄时复核 collab / SSE（01 §5：成员角色变更 → entry.access_changed）
  ;(ctx.bus ?? getEventBus()).publish('entry.access_changed', { userIds: [userId] })
  const fresh = await loadMember(db, ctx.workspaceId, userId)
  return {
    userId,
    email: fresh.u.email,
    name: fresh.u.name,
    displayName: fresh.u.displayName ?? null,
    role: fresh.m.role as WorkspaceRole,
    status: fresh.u.banned ? 'suspended' : 'active',
    joinedAt: fresh.m.createdAt.toISOString(),
  }
}

/** 未完成任务指派置空并发 task.unassigned（REQ-WS-013）。 */
async function unassignTasks(
  tx: DbOrTx,
  workspaceId: string,
  u: typeof user.$inferSelect,
  reason: 'member_removed' | 'member_suspended',
): Promise<number> {
  const rows = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      spaceId: tasks.spaceId,
      spaceSlug: spaces.slug,
    })
    .from(tasks)
    .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.assigneeId, u.id),
        isNull(tasks.deletedAt),
        notInArray(tasks.status, ['done', 'cancelled']),
      ),
    )
  if (rows.length === 0) return 0
  await tx
    .update(tasks)
    .set({ assigneeId: null, updatedAt: new Date() })
    .where(
      inArray(
        tasks.id,
        rows.map((r) => r.id),
      ),
    )
  for (const r of rows) {
    await emit(tx, {
      kind: 'task.unassigned',
      workspaceId,
      actorId: null,
      targetType: 'task',
      targetId: r.id,
      visibilityScope: { spaceId: r.spaceId },
      payload: {
        taskId: r.id,
        title: r.title,
        prevAssigneeId: u.id,
        prevAssigneeName: u.displayName || u.name,
        reason,
        spaceSlug: r.spaceSlug,
        dueAt: r.dueAt?.toISOString(),
      },
    })
  }
  return rows.length
}

/** 移除成员（admin）或本人退出：内容保留，作者不变（REQ-WS-012）。 */
export async function removeMember(db: Db, ctx: MemberCtx, userId: string): Promise<void> {
  const self = ctx.actor.id === userId
  if (!self) assertCan(ctx.actor, 'workspace.manage', null)
  const target = await loadMember(db, ctx.workspaceId, userId)
  if (!self) assertMayTouch(ctx, target.m.role)
  await db.transaction(async (tx) => {
    await assertNotLastOwner(tx, ctx.workspaceId, target.m.role)
    await tx.delete(member).where(eq(member.id, target.m.id))
    // 空间成员行、通知偏好、push 订阅一并清理（07 §4）
    await tx.execute(sql`delete from space_members where user_id = ${userId}`)
    await tx.execute(sql`delete from notification_preferences where user_id = ${userId}`)
    await tx.execute(sql`delete from push_subscriptions where user_id = ${userId}`)
    const unassigned = await unassignTasks(tx, ctx.workspaceId, target.u, 'member_removed')
    const revoked = await revokeAccess(tx, userId)
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.removed',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { role: target.m.role, self, unassigned, ...revoked },
    })
  })
  publishRevoked(ctx, userId)
}

export async function suspendMember(
  db: Db,
  ctx: MemberCtx,
  userId: string,
  reason?: string,
): Promise<void> {
  assertCan(ctx.actor, 'member.suspend', { id: userId })
  if (ctx.actor.id === userId) throw AppError.forbidden('不能停用自己')
  const target = await loadMember(db, ctx.workspaceId, userId)
  assertMayTouch(ctx, target.m.role)
  await db.transaction(async (tx) => {
    await assertNotLastOwner(tx, ctx.workspaceId, target.m.role)
    await tx
      .update(user)
      .set({ banned: true, banReason: reason ?? null, updatedAt: new Date() })
      .where(eq(user.id, userId))
    const unassigned = await unassignTasks(tx, ctx.workspaceId, target.u, 'member_suspended')
    const revoked = await revokeAccess(tx, userId)
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.suspended',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { reason: reason ?? null, unassigned, ...revoked },
    })
  })
  publishRevoked(ctx, userId)
}

export async function unsuspendMember(db: Db, ctx: MemberCtx, userId: string): Promise<void> {
  assertCan(ctx.actor, 'member.unsuspend', { id: userId })
  await loadMember(db, ctx.workspaceId, userId)
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() })
      .where(eq(user.id, userId))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.unsuspended',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
    })
  })
}

/** admin 吊销某成员全部会话（REQ-AUTH-009）；API Key 不动。 */
export async function revokeSessions(
  db: Db,
  ctx: MemberCtx,
  userId: string,
): Promise<{ sessions: number }> {
  assertCan(ctx.actor, 'member.revoke_sessions', { id: userId })
  await loadMember(db, ctx.workspaceId, userId)
  const n = await db.transaction(async (tx) => {
    const s = await tx
      .delete(session)
      .where(eq(session.userId, userId))
      .returning({ id: session.id })
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'auth.logout',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { byAdmin: true, sessions: s.length },
    })
    return s.length
  })
  publishRevoked(ctx, userId)
  return { sessions: n }
}

/** owner 转让（REQ-WS-003）：双方角色互换，发 workspace.owner_transferred。 */
export async function transferOwner(db: Db, ctx: MemberCtx, toUserId: string): Promise<void> {
  assertCan(ctx.actor, 'workspace.owner_transfer', null)
  if (toUserId === ctx.actor.id)
    throw AppError.validation([{ path: 'toUserId', message: '不能转让给自己' }])
  const from = await loadMember(db, ctx.workspaceId, ctx.actor.id)
  const to = await loadMember(db, ctx.workspaceId, toUserId)
  if (to.u.banned) throw AppError.validation([{ path: 'toUserId', message: '目标成员已停用' }])
  await db.transaction(async (tx) => {
    await tx.update(member).set({ role: 'owner' }).where(eq(member.id, to.m.id))
    await tx
      .update(member)
      .set({ role: 'admin' })
      .where(and(eq(member.id, from.m.id), ne(member.id, to.m.id)))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'workspace.owner_transferred',
      targetType: 'user',
      targetId: toUserId,
      ...meta(ctx),
      meta: { fromUserId: ctx.actor.id, toRolePrev: to.m.role },
    })
    await emit(tx, {
      kind: 'workspace.owner_transferred',
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      targetType: 'member',
      targetId: null,
      visibilityScope: { userIds: [ctx.actor.id, toUserId] },
      payload: {
        fromUserId: ctx.actor.id,
        fromName: from.u.displayName || from.u.name,
        toUserId,
        toName: to.u.displayName || to.u.name,
      },
    })
  })
}

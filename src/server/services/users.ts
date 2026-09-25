/**
 * 账号层管理（ADR-0010；07 §4）：
 * - owner 用户管理（can('user.manage')，REQ-WS-018 ~ 021）：用户列表、直建用户、改资料、重置密码、删号（匿名化）
 * - 本人账号（REQ-WS-022、REQ-AUTH-021）：改用户名 / 邮箱（改邮箱须当前密码）、改密码
 * 与 members.ts 分工：members = 工作区角色 / 停用 / 移除（owner+admin）；这里 = 账号本身（仅 owner / 本人）。
 * 吊销规则同 07 §4：重置密码 / 删号同事务删 session 行，提交后广播 `user.revoked`。
 */
import { and, count, desc, eq, max, ne, or, sql } from 'drizzle-orm'
import { v7 } from 'uuid'
import type { WorkspaceRole } from '../../shared/schemas/enums.ts'
import type {
  AdminCreateUserInput,
  AdminUserPatch,
  MeAccountPatch,
} from '../../shared/schemas/workspace.ts'
import type { Auth } from '../auth.ts'
import { type Actor, assertCan } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { account, apikey, member, passkey, session, twoFactor, user } from '../db/schema/auth.ts'
import { AppError } from '../lib/errors.ts'
import { type EventBus, getEventBus } from '../lib/event-bus.ts'
import { audit } from './audit.ts'
import { emit } from './events.ts'
import { MEMBER_LIMIT } from './invitations.ts'
import { revokeAccess, unassignTasks } from './members.ts'
import { ensurePersonalSpace } from './spaces.ts'

export interface UsersCtx {
  actor: Actor
  workspaceId: string
  ip?: string | null
  userAgent?: string | null
  bus?: EventBus
}

export interface UserAdminView {
  userId: string
  email: string
  username: string | null
  name: string
  displayName: string | null
  image: string | null
  role: WorkspaceRole
  status: 'active' | 'suspended'
  twoFactorEnabled: boolean
  joinedAt: string
  lastActiveAt: string | null
  sessions: number
}

const meta = (ctx: UsersCtx) => ({ ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null })

const uniqueErr = (path: 'email' | 'username', message: string) =>
  new AppError(409, 'CONFLICT_UNIQUE', message, { errors: [{ path, message }] })

/** 邮箱 / 用户名唯一（排除本人）；统一小写。 */
async function assertUnique(
  db: DbOrTx,
  v: { email?: string; username?: string },
  exceptUserId?: string,
): Promise<void> {
  const conds = []
  if (v.email) conds.push(eq(user.email, v.email))
  if (v.username) conds.push(eq(user.username, v.username))
  if (conds.length === 0) return
  const rows = await db
    .select({ email: user.email, username: user.username })
    .from(user)
    .where(exceptUserId ? and(or(...conds), ne(user.id, exceptUserId)) : or(...conds))
    .limit(2)
  if (v.email && rows.some((r) => r.email === v.email)) throw uniqueErr('email', '该邮箱已被使用')
  if (v.username && rows.some((r) => r.username === v.username))
    throw uniqueErr('username', '该用户名已被使用')
}

const norm = (v: { email?: string; username?: string }) => ({
  email: v.email?.trim().toLowerCase(),
  username: v.username?.trim().toLowerCase(),
  displayUsername: v.username?.trim(),
})

/** 写 credential 账号密码（没有则补建，如仅 magic link 登录过的账号）。 */
async function writePassword(tx: DbOrTx, auth: Auth, userId: string, password: string) {
  const ctx = await auth.$context
  const hash = await ctx.password.hash(password)
  const r = await tx
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .returning({ id: account.id })
  if (!r[0])
    await tx.insert(account).values({
      id: v7(),
      userId,
      providerId: 'credential',
      accountId: userId,
      password: hash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
}

async function verifyPassword(db: DbOrTx, auth: Auth, userId: string, password: string) {
  const [row] = await db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1)
  const ok = row?.hash
    ? await (await auth.$context).password.verify({ hash: row.hash, password })
    : false
  if (!ok)
    throw AppError.validation([{ path: 'currentPassword', message: '当前密码不正确' }], '密码错误')
}

async function loadTarget(db: DbOrTx, ctx: UsersCtx, userId: string) {
  assertCan(ctx.actor, 'user.manage', { id: userId })
  const [row] = await db
    .select({ m: member, u: user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, userId)))
    .limit(1)
  if (!row) throw AppError.notFound('用户不存在')
  return row
}

// ---------- owner：用户管理 ----------

export async function listUsers(db: Db, ctx: UsersCtx): Promise<UserAdminView[]> {
  assertCan(ctx.actor, 'user.manage', null)
  const act = db
    .select({
      userId: session.userId,
      last: max(session.updatedAt).as('last'),
      n: count().as('n'),
    })
    .from(session)
    .groupBy(session.userId)
    .as('act')
  const rows = await db
    .select({ m: member, u: user, last: act.last, n: act.n })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(act, eq(act.userId, user.id))
    .where(eq(member.organizationId, ctx.workspaceId))
    .orderBy(desc(sql`${member.role} = 'owner'`), member.createdAt)
  return rows.map(({ m, u, last, n }) => ({
    userId: u.id,
    email: u.email,
    username: u.displayUsername ?? u.username ?? null,
    name: u.name,
    displayName: u.displayName ?? null,
    image: u.image ?? null,
    role: m.role as WorkspaceRole,
    status: u.banned ? 'suspended' : 'active',
    twoFactorEnabled: u.twoFactorEnabled ?? false,
    joinedAt: m.createdAt.toISOString(),
    lastActiveAt: last ? new Date(last).toISOString() : null,
    sessions: Number(n ?? 0),
  }))
}

/** 直建用户（REQ-WS-018）：user + credential + member(role) + 个人空间，立即可登录。 */
export async function createUser(
  db: Db,
  auth: Auth,
  ctx: UsersCtx,
  input: AdminCreateUserInput,
): Promise<{ userId: string }> {
  assertCan(ctx.actor, 'user.manage', null)
  const { email, username, displayUsername } = norm(input)
  await assertUnique(db, { email, username })
  const [m] = await db
    .select({ n: count() })
    .from(member)
    .where(eq(member.organizationId, ctx.workspaceId))
  if ((m?.n ?? 0) >= MEMBER_LIMIT)
    throw AppError.validation([{ path: 'email', message: `成员数已达上限 ${MEMBER_LIMIT}` }])

  const [inviter] = await db
    .select({ name: user.name, displayName: user.displayName })
    .from(user)
    .where(eq(user.id, ctx.actor.id))
    .limit(1)
  const actx = await auth.$context
  let userId: string
  try {
    const u = await actx.internalAdapter.createUser(
      {
        email: email as string,
        name: input.name,
        displayName: input.name,
        username,
        displayUsername,
        emailVerified: true,
      },
      { method: 'admin' },
    )
    userId = u.id
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } }
    if (e?.code === '23505' || e?.cause?.code === '23505')
      throw uniqueErr('username', '该邮箱或用户名已被使用')
    throw err
  }
  await db.transaction(async (tx) => {
    await writePassword(tx, auth, userId, input.password)
    await tx.insert(member).values({
      id: v7(),
      organizationId: ctx.workspaceId,
      userId,
      role: input.role,
      createdAt: new Date(),
    })
    await ensurePersonalSpace(tx, ctx.workspaceId, userId)
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'user.created',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { role: input.role, username },
    })
    await emit(tx, {
      kind: 'member.joined',
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      targetType: 'member',
      targetId: null,
      payload: {
        userId,
        displayName: input.name,
        email: email as string,
        role: input.role,
        inviterId: ctx.actor.id,
        inviterName: inviter?.displayName || inviter?.name || '',
      },
    })
  })
  return { userId }
}

/** 改他人资料（REQ-WS-019）：显示名 / 用户名 / 邮箱。 */
export async function updateUser(
  db: Db,
  ctx: UsersCtx,
  userId: string,
  patch: AdminUserPatch,
): Promise<void> {
  const target = await loadTarget(db, ctx, userId)
  const { email, username, displayUsername } = norm(patch)
  await assertUnique(db, { email, username }, userId)
  const set = {
    ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
    ...(email ? { email } : {}),
    ...(username ? { username, displayUsername } : {}),
  }
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(user.id, userId))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'user.updated',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: {
        byAdmin: true,
        fields: Object.keys(set).filter((k) => k !== 'displayUsername'),
        ...(email ? { emailFrom: target.u.email, emailTo: email } : {}),
        ...(username ? { usernameFrom: target.u.username, usernameTo: username } : {}),
      },
    })
  })
}

/** 重置他人密码（REQ-WS-020）：写新哈希 + 删其全部会话，广播 user.revoked。 */
export async function resetUserPassword(
  db: Db,
  auth: Auth,
  ctx: UsersCtx,
  userId: string,
  password: string,
): Promise<{ sessions: number }> {
  await loadTarget(db, ctx, userId)
  const n = await db.transaction(async (tx) => {
    await writePassword(tx, auth, userId, password)
    const s = await tx
      .delete(session)
      .where(eq(session.userId, userId))
      .returning({ id: session.id })
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { byAdmin: true, sessions: s.length },
    })
    return s.length
  })
  ;(ctx.bus ?? getEventBus()).publish('user.revoked', { userId })
  return { sessions: n }
}

/**
 * 删号（REQ-WS-021；07 §4 `DELETE /workspace/members/:userId?purge=1`）：移除成员 + 吊销 +
 * 匿名化 user 行（email / name / 头像 / 用户名 → deleted-<id>），删凭据 / 2FA / Passkey / API Key。
 * 内容保留，作者显示「已删除的用户」。最后一名 owner 不可删。
 */
export async function purgeUser(db: Db, ctx: UsersCtx, userId: string): Promise<void> {
  const target = await loadTarget(db, ctx, userId)
  if (target.m.role === 'owner')
    throw new AppError(409, 'CONFLICT_LAST_OWNER', 'owner 不能被删除，请先转让')
  await db.transaction(async (tx) => {
    await tx.delete(member).where(eq(member.id, target.m.id))
    await tx.execute(sql`delete from space_members where user_id = ${userId}`)
    await tx.execute(sql`delete from notification_preferences where user_id = ${userId}`)
    await tx.execute(sql`delete from push_subscriptions where user_id = ${userId}`)
    const unassigned = await unassignTasks(tx, ctx.workspaceId, target.u, 'member_removed')
    const revoked = await revokeAccess(tx, userId)
    await tx.delete(apikey).where(eq(apikey.referenceId, userId))
    await tx.delete(account).where(eq(account.userId, userId))
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
    await tx.delete(passkey).where(eq(passkey.userId, userId))
    const anon = `deleted-${userId}`
    await tx
      .update(user)
      .set({
        email: `${anon}@deleted.invalid`,
        name: '已删除的用户',
        displayName: null,
        username: null,
        displayUsername: null,
        image: null,
        avatarAttachmentId: null,
        banned: true,
        banReason: 'deleted',
        twoFactorEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'user.deleted',
      targetType: 'user',
      targetId: userId,
      ...meta(ctx),
      meta: { byAdmin: true, role: target.m.role, unassigned, ...revoked },
    })
  })
  ;(ctx.bus ?? getEventBus()).publish('user.revoked', { userId })
}

// ---------- 本人：账号 ----------

/** 改用户名 / 邮箱（REQ-WS-022）：改邮箱须当前密码；不吊销会话。 */
export async function updateMyAccount(
  db: Db,
  auth: Auth,
  ctx: UsersCtx,
  patch: MeAccountPatch,
): Promise<void> {
  const { email, username, displayUsername } = norm(patch)
  if (email) await verifyPassword(db, auth, ctx.actor.id, patch.currentPassword ?? '')
  await assertUnique(db, { email, username }, ctx.actor.id)
  const [before] = await db.select().from(user).where(eq(user.id, ctx.actor.id)).limit(1)
  if (!before) throw AppError.notFound()
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        ...(email ? { email } : {}),
        ...(username ? { username, displayUsername } : {}),
        updatedAt: new Date(),
      })
      .where(eq(user.id, ctx.actor.id))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'user.updated',
      targetType: 'user',
      targetId: ctx.actor.id,
      ...meta(ctx),
      meta: {
        byAdmin: false,
        ...(email ? { emailFrom: before.email, emailTo: email } : {}),
        ...(username ? { usernameFrom: before.username, usernameTo: username } : {}),
      },
    })
  })
}

/**
 * 改密码（REQ-AUTH-021）：校验当前密码 → 写新哈希 → 删除本人其他会话（保留当前会话，
 * 故不广播 user.revoked，否则当前页的 SSE / 协作连接也会被踢）。
 */
export async function changeMyPassword(
  db: Db,
  auth: Auth,
  ctx: UsersCtx & { currentSessionId: string | null },
  input: { currentPassword: string; newPassword: string },
): Promise<{ sessions: number }> {
  await verifyPassword(db, auth, ctx.actor.id, input.currentPassword)
  if (input.currentPassword === input.newPassword)
    throw AppError.validation([{ path: 'newPassword', message: '新密码不能与当前密码相同' }])
  return db.transaction(async (tx) => {
    await writePassword(tx, auth, ctx.actor.id, input.newPassword)
    const s = await tx
      .delete(session)
      .where(
        ctx.currentSessionId
          ? and(eq(session.userId, ctx.actor.id), ne(session.id, ctx.currentSessionId))
          : eq(session.userId, ctx.actor.id),
      )
      .returning({ id: session.id })
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: ctx.actor.id,
      ...meta(ctx),
      meta: { otherSessionsRevoked: s.length },
    })
    return { sessions: s.length }
  })
}

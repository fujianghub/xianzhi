/**
 * 邀请流程（T0-010；REQ-AUTH-003 · 004 · 005；07 §2.1 §4 §5）。
 * 存储用 Better Auth 的 `invitation` 表，但创建 / 接受由本 service 完成：
 * 受邀者尚无账号且注册已关闭，Better Auth 的 accept-invitation 需要会话，走不通。
 * - 7 天一次性；接受时邮箱必须匹配（否则 403）；已用 / 过期 / 撤回 → 410 INVITATION_EXPIRED
 * - 接受：建 user（credential 账号）→ member(role) → 个人空间 → status=accepted → audit + emit(member.joined)
 * - 成员数（含待接受邀请）达 50 → 422
 */
import { and, count, eq, gt } from 'drizzle-orm'
import { v7 } from 'uuid'
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
} from '../../shared/schemas/workspace.ts'
import type { Auth } from '../auth.ts'
import { type Actor, assertCan } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { invitation, member, organization, user } from '../db/schema/auth.ts'
import { AppError } from '../lib/errors.ts'
import { sendWorkspaceInvitation } from '../mail/invitation.ts'
import { audit } from './audit.ts'
import { emit } from './events.ts'
import { ensurePersonalSpace } from './spaces.ts'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const MEMBER_LIMIT = 50

export interface InvitationView {
  id: string
  email: string
  role: string
  status: string
  expiresAt: string
  createdAt: string
  inviterId: string | null
}

const toView = (r: typeof invitation.$inferSelect): InvitationView => ({
  id: r.id,
  email: r.email,
  role: r.role ?? 'member',
  status: r.status,
  expiresAt: r.expiresAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  inviterId: r.inviterId ?? null,
})

export interface InviteCtx {
  actor: Actor
  workspaceId: string
  appUrl: string
  ip?: string | null
  userAgent?: string | null
}

export async function listInvitations(db: Db, ctx: InviteCtx): Promise<InvitationView[]> {
  assertCan(ctx.actor, 'workspace.manage', null)
  const rows = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, ctx.workspaceId),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(invitation.createdAt)
  return rows.map(toView)
}

export async function createInvitation(
  db: Db,
  ctx: InviteCtx,
  input: CreateInvitationInput,
): Promise<InvitationView> {
  assertCan(ctx.actor, 'workspace.manage', null)
  const email = input.email.trim().toLowerCase()

  const [ws] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, ctx.workspaceId))
    .limit(1)
  if (!ws) throw AppError.notFound('工作区不存在')
  const [inviter] = await db.select().from(user).where(eq(user.id, ctx.actor.id)).limit(1)
  if (!inviter) throw AppError.unauthenticated()

  // 已是成员 → 409
  const existing = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.workspaceId), eq(user.email, email)))
    .limit(1)
  if (existing[0]) throw new AppError(409, 'CONFLICT_UNIQUE', '该邮箱已是工作区成员')

  // 成员上限 50（07 §5）：现有成员 + 待接受邀请
  const [m] = await db
    .select({ n: count() })
    .from(member)
    .where(eq(member.organizationId, ctx.workspaceId))
  const [p] = await db
    .select({ n: count() })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, ctx.workspaceId),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date()),
      ),
    )
  if ((m?.n ?? 0) + (p?.n ?? 0) >= MEMBER_LIMIT) {
    throw AppError.validation(
      [{ path: 'email', message: `工作区成员上限 ${MEMBER_LIMIT}，需架构重估` }],
      '成员数已达上限',
    )
  }

  const row = await db.transaction(async (tx) => {
    // 同邮箱旧的待接受邀请作废（Better Auth cancelPendingInvitationsOnReInvite 同义）
    await tx
      .update(invitation)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(invitation.organizationId, ctx.workspaceId),
          eq(invitation.email, email),
          eq(invitation.status, 'pending'),
        ),
      )
    const [inserted] = await tx
      .insert(invitation)
      .values({
        id: v7(),
        organizationId: ctx.workspaceId,
        email,
        role: input.role,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        createdAt: new Date(),
        inviterId: ctx.actor.id,
      })
      .returning()
    if (!inserted) throw new Error('insert invitation failed')
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'member.invited',
      targetType: 'invitation',
      targetId: inserted.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { email, role: input.role },
    })
    return inserted
  })

  await sendWorkspaceInvitation(email, {
    inviterName: inviter.displayName || inviter.name || inviter.email,
    workspaceName: ws.name,
    role: input.role,
    url: `${ctx.appUrl.replace(/\/$/, '')}/invite/${row.id}`,
    expiresDays: 7,
  })
  return toView(row)
}

export async function cancelInvitation(db: Db, ctx: InviteCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'workspace.manage', null)
  const [row] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, id), eq(invitation.organizationId, ctx.workspaceId)))
    .limit(1)
  if (!row) throw AppError.notFound()
  if (row.status !== 'pending') throw new AppError(410, 'INVITATION_EXPIRED', '邀请已处理')
  await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, id))
}

/** 公开查看（邀请页）：不可用一律 410，不区分原因以外的细节。 */
export async function getInvitationPublic(db: Db, id: string) {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1)
  if (!row) throw AppError.notFound()
  assertUsable(row)
  const [ws] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, row.organizationId))
    .limit(1)
  const inviter = row.inviterId
    ? (
        await db
          .select({ name: user.name, displayName: user.displayName })
          .from(user)
          .where(eq(user.id, row.inviterId))
          .limit(1)
      )[0]
    : undefined
  return {
    id: row.id,
    email: maskEmail(row.email),
    role: row.role ?? 'member',
    workspaceName: ws?.name ?? '',
    inviterName: inviter?.displayName || inviter?.name || '',
    expiresAt: row.expiresAt.toISOString(),
  }
}

function assertUsable(row: typeof invitation.$inferSelect): void {
  if (row.status === 'accepted')
    throw new AppError(410, 'INVITATION_EXPIRED', '邀请已使用', { reason: 'used' })
  if (row.status !== 'pending')
    throw new AppError(410, 'INVITATION_EXPIRED', '邀请已撤回', { reason: 'canceled' })
  if (row.expiresAt.getTime() <= Date.now())
    throw new AppError(410, 'INVITATION_EXPIRED', '邀请已过期', { reason: 'expired' })
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`
}

export async function acceptInvitation(
  db: Db,
  auth: Auth,
  id: string,
  input: AcceptInvitationInput,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ userId: string; workspaceId: string; role: string; created: boolean }> {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1)
  if (!row) throw AppError.notFound()
  assertUsable(row)
  const email = input.email.trim().toLowerCase()
  if (email !== row.email.toLowerCase()) throw AppError.forbidden('邮箱与邀请不匹配')
  const role = row.role ?? 'member'

  // 已有账号（曾被移除的成员再邀请）：只补成员行，不动密码
  let [existingUser] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  let created = false
  if (!existingUser) {
    const ctx = await auth.$context
    const hash = await ctx.password.hash(input.password)
    const u = await ctx.internalAdapter.createUser(
      { email, name: input.name, emailVerified: true, displayName: input.name },
      { method: 'email-password' },
    )
    await ctx.internalAdapter.linkAccount({
      userId: u.id,
      providerId: 'credential',
      accountId: u.id,
      password: hash,
    })
    existingUser = (await db.select().from(user).where(eq(user.id, u.id)).limit(1))[0]
    created = true
  }
  if (!existingUser) throw new Error('user creation failed')
  const userId = existingUser.id

  await db.transaction(async (tx) => {
    // 一次性：只有仍为 pending 的行才能被本次接受（并发双击只成功一次）
    const updated = await tx
      .update(invitation)
      .set({ status: 'accepted' })
      .where(and(eq(invitation.id, id), eq(invitation.status, 'pending')))
      .returning({ id: invitation.id })
    if (!updated[0]) throw new AppError(410, 'INVITATION_EXPIRED', '邀请已使用', { reason: 'used' })

    const already = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, userId)))
      .limit(1)
    if (already[0]) throw new AppError(409, 'CONFLICT_UNIQUE', '已是工作区成员')

    await tx
      .insert(member)
      .values({ id: v7(), organizationId: row.organizationId, userId, role, createdAt: new Date() })
    await ensurePersonalSpace(tx, row.organizationId, userId)

    const inviter = row.inviterId
      ? (
          await tx
            .select({ name: user.name, displayName: user.displayName })
            .from(user)
            .where(eq(user.id, row.inviterId))
            .limit(1)
        )[0]
      : undefined
    await audit(tx, {
      workspaceId: row.organizationId,
      actorId: userId,
      action: 'member.joined',
      targetType: 'user',
      targetId: userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      meta: { role, invitationId: id, inviterId: row.inviterId },
    })
    await emit(tx, {
      kind: 'member.joined',
      workspaceId: row.organizationId,
      actorId: userId,
      targetType: 'member',
      targetId: null,
      payload: {
        userId,
        displayName: existingUser.displayName || existingUser.name,
        email,
        role,
        inviterId: row.inviterId ?? userId,
        inviterName: inviter?.displayName || inviter?.name || '',
      },
    })
  })

  return { userId, workspaceId: row.organizationId, role, created }
}

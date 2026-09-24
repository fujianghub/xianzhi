/**
 * 工作区 service（一期唯一 Workspace）。createOwner（REQ-AUTH-013）：首个 owner + 默认 Workspace + 个人空间；
 * 已存在 owner 则拒绝。
 */
import { count, eq } from 'drizzle-orm'
import { v7 } from 'uuid'
import type { Auth } from '../auth.ts'
import { type Actor, assertCan } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { member, organization } from '../db/schema/auth.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { ensurePersonalSpace } from './spaces.ts'

export const DEFAULT_WORKSPACE = { name: '衔枝', slug: 'xz' } as const

export class OwnerExistsError extends Error {
  constructor() {
    super('owner 已存在：工作区只能有一个初始 owner；如需更多 owner 请转让或改角色')
    this.name = 'OwnerExistsError'
  }
}

export interface CreateOwnerInput {
  email: string
  password: string
  name: string
  workspaceName?: string
}

export async function findWorkspace(db: Db) {
  const rows = await db.select().from(organization).limit(1)
  return rows[0] ?? null
}

export async function createOwner(db: Db, auth: Auth, input: CreateOwnerInput) {
  const existingOwner = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.role, 'owner'))
    .limit(1)
  if (existingOwner[0]) throw new OwnerExistsError()

  const ctx = await auth.$context
  const hash = await ctx.password.hash(input.password)
  const user = await ctx.internalAdapter.createUser(
    {
      email: input.email.trim().toLowerCase(),
      name: input.name,
      emailVerified: true,
      role: 'admin', // Better Auth admin 插件角色（后台）；业务角色以 member.role 为准
    },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  })

  const workspaceId = await db.transaction(async (tx) => {
    let ws = (await tx.select().from(organization).limit(1))[0]
    if (!ws) {
      const inserted = await tx
        .insert(organization)
        .values({
          id: v7(),
          name: input.workspaceName ?? DEFAULT_WORKSPACE.name,
          slug: DEFAULT_WORKSPACE.slug,
          createdAt: new Date(),
        })
        .returning()
      ws = inserted[0]
    }
    if (!ws) throw new Error('organization insert failed')
    await tx.insert(member).values({
      id: v7(),
      organizationId: ws.id,
      userId: user.id,
      role: 'owner',
      createdAt: new Date(),
    })
    await ensurePersonalSpace(tx, ws.id, user.id)
    await audit(tx, {
      workspaceId: ws.id,
      actorId: user.id,
      action: 'member.joined',
      targetType: 'user',
      targetId: user.id,
      meta: { role: 'owner', via: 'create-owner' },
    })
    return ws.id
  })

  return { userId: user.id, workspaceId }
}

// ---------- 工作区信息（REQ-WS-001） ----------

export interface WorkspaceView {
  id: string
  name: string
  slug: string
  settings: Record<string, unknown>
  createdAt: string
  memberCount: number
}

function parseSettings(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const v = JSON.parse(metadata)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function getWorkspace(db: Db, workspaceId: string): Promise<WorkspaceView> {
  const [ws] = await db.select().from(organization).where(eq(organization.id, workspaceId)).limit(1)
  if (!ws) throw AppError.notFound('工作区不存在')
  const [c] = await db
    .select({ n: count() })
    .from(member)
    .where(eq(member.organizationId, workspaceId))
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    settings: parseSettings(ws.metadata),
    createdAt: ws.createdAt.toISOString(),
    memberCount: c?.n ?? 0,
  }
}

export async function updateWorkspace(
  db: Db,
  ctx: { actor: Actor; workspaceId: string; ip?: string | null; userAgent?: string | null },
  patch: { name?: string; settings?: Record<string, unknown> },
): Promise<WorkspaceView> {
  assertCan(ctx.actor, 'workspace.manage', null)
  const before = await getWorkspace(db, ctx.workspaceId)
  await db.transaction(async (tx) => {
    const set: Partial<typeof organization.$inferInsert> = {}
    if (patch.name !== undefined) set.name = patch.name
    if (patch.settings !== undefined)
      set.metadata = JSON.stringify({ ...before.settings, ...patch.settings })
    await tx.update(organization).set(set).where(eq(organization.id, ctx.workspaceId))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'workspace.settings_changed',
      targetType: 'workspace',
      targetId: ctx.workspaceId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { before: { name: before.name, settings: before.settings }, patch },
    })
  })
  return getWorkspace(db, ctx.workspaceId)
}

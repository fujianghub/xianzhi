/**
 * 空间 service（01 §3.1、02 §9、REQ-SPACE-001 ~ 009）。
 * - 可见性与权限全部经 authz：列表用 visibleSpacesWhere，单个对象用 can()；不可见一律 404（02 §2）。
 * - 归档 = 只读（其任务 / 记录写操作由 authz 的 spaceWritable 拒绝）；软删 = 连同其下内容对所有人不可见，30 天后由 gc 清除。
 * - 排序：工作区内一列 fractional-indexing `sort_key`；reorder 只改被拖项一行（REQ-SPACE-005）。
 * - 大类（ADR-0012）：`group_id` 可空；移入大类需 space.manage；个人空间不入大类。
 * - 访问变化（成员增删改、可见性、归档、软删、恢复、永久删）提交后广播 `entry.access_changed`，collab 重新 can()（01 §5）。
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import type { SpaceRole, WorkspaceRole } from '../../shared/schemas/enums.ts'
import {
  type batchSpacesSchema,
  type createSpaceSchema,
  type listSpacesQuery,
  type patchSpaceSchema,
  resolveEnabledKinds,
} from '../../shared/schemas/spaces.ts'
import {
  type Actor,
  assertCan,
  can,
  effectiveSpaceRole,
  type SpaceRef,
  spaceRoleCap,
  spaceRoleWithin,
  visibleSpacesWhere,
} from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { member as memberTable, user as userTable } from '../db/schema/auth.ts'
import {
  entries,
  entryKindOverrides,
  entryTypes,
  spaceMembers,
  spaces,
  tasks,
} from '../db/schema/business.ts'
import { purgeSpace } from '../jobs/gc.ts'
import { type BatchFailure, batchFailure } from '../lib/batch.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'
import { type EventBus, getEventBus } from '../lib/event-bus.ts'
import { audit } from './audit.ts'
import { loadEntryType } from './entry-types.ts'
import { emit } from './events.ts'
import { requireGroupId } from './space-groups.ts'
import { assertSharedTemplate } from './templates.ts'

export const PERSONAL_SPACE_NAME = '个人'
/** 软删保留天数（01 §1、07 §3 gc.soft_deleted）。 */
export const SOFT_DELETE_DAYS = 30
const DAY_MS = 86_400_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SpaceRow = typeof spaces.$inferSelect

export interface SpaceCtx {
  actor: Actor
  workspaceId: string
  bus?: EventBus
  /** 永久删除要删附件文件（data/ 目录）。 */
  dataDir?: string
  ip?: string | null
  userAgent?: string | null
}

export interface SpaceView {
  id: string
  name: string
  slug: string
  kind: string
  icon: string | null
  color: string | null
  visibility: 'workspace' | 'members'
  isPersonal: boolean
  description: string | null
  /** 所属大类（ADR-0012）；null = 未分类 */
  groupId: string | null
  /** 在此空间新建记录的默认类型 / 模板（ADR-0019） */
  defaultKind: string | null
  defaultTemplateId: string | null
  /** 默认类型为本空间的空间类型时（ADR-0036） */
  defaultTypeId: string | null
  /**
   * 启用类型（ADR-0036、REQ-KB-014）：已解析（null → 按空间种类推导 + 本空间全部空间类型；悬空项已去掉）。
   * 列表接口里不含空间类型推导（只有详情解析完整）。
   */
  enabledKinds: string[]
  /** 原值：null = 用默认（编辑对话框据此显示「恢复默认」） */
  enabledKindsRaw: string[] | null
  sortKey: string
  /** 当前用户的有效空间角色（01 §5，取较高者）；前端据此显示管理入口。 */
  myRole: SpaceRole | null
  /** 当前用户是否显式在 space_members 里（侧栏「我的空间」）。 */
  isMember: boolean
  memberCount: number
  createdBy: string
  archivedAt: string | null
  deletedAt: string | null
  /** 仅回收站对象：距硬删剩余天数（02 §5）。 */
  daysLeft?: number
  createdAt: string
  updatedAt: string
}

// ---------- 个人空间（REQ-SPACE-009） ----------

/**
 * 01 §3.1 写「userId 前 8 位」，但 UUID v7 前 8 位十六进制是毫秒时间戳，同一分钟内加入的成员会撞
 * `(workspace_id, slug)` 唯一约束（debug/2026-09-23-personal-slug-uuidv7）。改取末 8 位随机段。
 */
export function personalSlug(userId: string): string {
  return `me-${userId.replace(/-/g, '').slice(-8)}`
}

/** 工作区内最后一个 sort_key 之后（新空间落在末尾；避免多个个人空间同为 'a0' 造成排序键重复）。 */
async function nextSortKey(db: DbOrTx, workspaceId: string): Promise<string> {
  const [last] = await db
    .select({ k: spaces.sortKey })
    .from(spaces)
    .where(eq(spaces.workspaceId, workspaceId))
    .orderBy(desc(spaces.sortKey))
    .limit(1)
  return generateKeyBetween(last?.k ?? null, null)
}

/** 幂等：已存在则返回既有 id。 */
export async function ensurePersonalSpace(
  db: DbOrTx,
  workspaceId: string,
  userId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.createdBy, userId),
        eq(spaces.isPersonal, true),
      ),
    )
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const [row] = await db
    .insert(spaces)
    .values({
      workspaceId,
      name: PERSONAL_SPACE_NAME,
      slug: personalSlug(userId),
      kind: 'work',
      visibility: 'members',
      isPersonal: true,
      sortKey: await nextSortKey(db, workspaceId),
      createdBy: userId,
    })
    .returning({ id: spaces.id })
  if (!row) throw new Error('insert spaces returned nothing')
  await db
    .insert(spaceMembers)
    .values({ spaceId: row.id, userId, role: 'admin' })
    .onConflictDoNothing()
  return { id: row.id, created: true }
}

// ---------- 读取与鉴权 ----------

const toRef = (row: SpaceRow, memberRole: SpaceRole | null): SpaceRef => ({
  id: row.id,
  visibility: row.visibility as SpaceRef['visibility'],
  isPersonal: row.isPersonal,
  createdBy: row.createdBy,
  archivedAt: row.archivedAt,
  deletedAt: row.deletedAt,
  memberRole,
})

async function memberRoleOf(db: DbOrTx, spaceId: string, userId: string) {
  const [sm] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .limit(1)
  return (sm?.role as SpaceRole | undefined) ?? null
}

/**
 * 按 id 或 slug 取空间并判读权限；不存在 / 不可读 → 404。
 * `allowDeleted`：回收站操作（restore / permanent），软删对象只对工作区 owner/admin 放行。
 */
export async function loadSpace(
  db: DbOrTx,
  ctx: SpaceCtx,
  key: string,
  opts: { allowDeleted?: boolean } = {},
): Promise<{ row: SpaceRow; ref: SpaceRef }> {
  const [row] = await db
    .select()
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, ctx.workspaceId),
        UUID_RE.test(key) ? eq(spaces.id, key) : eq(spaces.slug, key),
      ),
    )
    .limit(1)
  if (!row) throw AppError.notFound('空间不存在')
  const ref = toRef(row, await memberRoleOf(db, row.id, ctx.actor.id))
  if (row.deletedAt && opts.allowDeleted) {
    if (!can(ctx.actor, 'workspace.manage', null)) throw AppError.notFound('空间不存在')
    return { row, ref }
  }
  if (!can(ctx.actor, 'space.read', ref)) throw AppError.notFound('空间不存在')
  return { row, ref }
}

const memberCountSql = sql<number>`(select count(*)::int from ${spaceMembers} sm where sm.space_id = ${spaces.id})`

function toView(
  actor: Actor,
  row: SpaceRow,
  memberRole: SpaceRole | null,
  memberCount: number,
  now = new Date(),
): SpaceView {
  const v: SpaceView = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    icon: row.icon,
    color: row.color,
    visibility: row.visibility as SpaceView['visibility'],
    isPersonal: row.isPersonal,
    description: row.description,
    groupId: row.groupId,
    defaultKind: row.defaultKind,
    defaultTemplateId: row.defaultTemplateId,
    defaultTypeId: row.defaultTypeId,
    enabledKinds: resolveEnabledKinds({
      raw: row.enabledKinds,
      spaceKind: row.kind,
      isPersonal: row.isPersonal,
      spaceTypeIds: [],
    }),
    enabledKindsRaw: row.enabledKinds ?? null,
    sortKey: row.sortKey,
    myRole: effectiveSpaceRole(actor, toRef(row, memberRole)),
    isMember: memberRole !== null,
    memberCount,
    createdBy: row.createdBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
  if (row.deletedAt) {
    const purgeAt = row.deletedAt.getTime() + SOFT_DELETE_DAYS * DAY_MS
    v.daysLeft = Math.max(0, Math.ceil((purgeAt - now.getTime()) / DAY_MS))
  }
  return v
}

export async function viewOf(db: DbOrTx, ctx: SpaceCtx, id: string): Promise<SpaceView> {
  const [r] = await db
    .select({ s: spaces, role: spaceMembers.role, n: memberCountSql })
    .from(spaces)
    .leftJoin(
      spaceMembers,
      and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, ctx.actor.id)),
    )
    .where(eq(spaces.id, id))
  if (!r) throw AppError.notFound('空间不存在')
  const view = toView(ctx.actor, r.s, (r.role as SpaceRole | null) ?? null, r.n)
  // 启用类型完整解析：本空间的空间类型 + 本人的个人类型（悬空项去掉）+ 已删除内置类型去掉
  const [types, deleted] = await Promise.all([
    db
      .select({ id: entryTypes.id, spaceId: entryTypes.spaceId, createdBy: entryTypes.createdBy })
      .from(entryTypes)
      .where(
        and(
          eq(entryTypes.workspaceId, r.s.workspaceId),
          or(
            eq(entryTypes.spaceId, id),
            and(isNull(entryTypes.spaceId), eq(entryTypes.createdBy, ctx.actor.id)),
          ),
        ),
      ),
    db
      .select({ kind: entryKindOverrides.kind })
      .from(entryKindOverrides)
      .where(
        and(
          eq(entryKindOverrides.workspaceId, r.s.workspaceId),
          eq(entryKindOverrides.deleted, true),
        ),
      ),
  ])
  view.enabledKinds = resolveEnabledKinds({
    raw: r.s.enabledKinds,
    spaceKind: r.s.kind,
    isPersonal: r.s.isPersonal,
    spaceTypeIds: types.filter((t) => t.spaceId === id).map((t) => t.id),
    knownTypeIds: types.map((t) => t.id),
    deletedKinds: deleted.map((d) => d.kind),
  })
  return view
}

export const accessChanged = (ctx: SpaceCtx, payload: { spaceId: string; userIds?: string[] }) =>
  (ctx.bus ?? getEventBus()).publish('entry.access_changed', payload)

// ---------- 列表 / 详情 ----------

const SORT_COL = {
  sortKey: spaces.sortKey,
  name: spaces.name,
  createdAt: spaces.createdAt,
} as const

/**
 * GET /spaces（REQ-SPACE-001 · 002 · 004）。
 * - 默认：可见且未归档；`archived=1` 只列归档的；`deleted=1` 回收站（空间只有工作区 owner/admin 能删，故只对其返回）。
 * - 他人的个人空间不进列表（owner/admin 按矩阵可读，但放进侧栏只是噪音；按 id / slug 仍可访问）。
 */
export async function listSpaces(
  db: DbOrTx,
  ctx: SpaceCtx,
  q: z.infer<typeof listSpacesQuery>,
): Promise<{ items: SpaceView[]; nextCursor: string | null; total?: number }> {
  const conds: SQL[] = [eq(spaces.workspaceId, ctx.workspaceId)]
  if (q.deleted) {
    if (!can(ctx.actor, 'workspace.manage', null)) return { items: [], nextCursor: null }
    conds.push(isNotNull(spaces.deletedAt))
  } else {
    conds.push(visibleSpacesWhere(ctx.actor))
    conds.push(q.archived ? isNotNull(spaces.archivedAt) : isNull(spaces.archivedAt))
    conds.push(not(and(eq(spaces.isPersonal, true), ne(spaces.createdBy, ctx.actor.id)) as SQL))
  }
  const primary = q.sort[0] ?? { field: 'sortKey' as const, dir: 'asc' as const }
  const col = SORT_COL[primary.field]
  const c = decodeCursor(q.cursor, 2)
  if (q.cursor && !c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  const pageConds = [...conds]
  if (c) {
    const [v, id] = c
    const val = primary.field === 'createdAt' ? new Date(String(v)) : String(v)
    pageConds.push(
      primary.dir === 'desc'
        ? sql`(${col}, ${spaces.id}) < (${val}, ${String(id)}::uuid)`
        : sql`(${col}, ${spaces.id}) > (${val}, ${String(id)}::uuid)`,
    )
  }
  const order = primary.dir === 'desc' ? [desc(col), desc(spaces.id)] : [asc(col), asc(spaces.id)]
  const rows = await db
    .select({ s: spaces, role: spaceMembers.role, n: memberCountSql })
    .from(spaces)
    .leftJoin(
      spaceMembers,
      and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, ctx.actor.id)),
    )
    .where(and(...pageConds))
    .orderBy(...order)
    .limit(q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > q.limit && last
      ? encodeCursor([
          primary.field === 'createdAt' ? last.s.createdAt.toISOString() : last.s[primary.field],
          last.s.id,
        ])
      : null
  const now = new Date()
  const items = page.map((r) =>
    toView(ctx.actor, r.s, (r.role as SpaceRole | null) ?? null, r.n, now),
  )
  if (!q.withTotal) return { items, nextCursor }
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(spaces)
    .where(and(...conds))
  return { items, nextCursor, total: t?.n ?? 0 }
}

/** GET /spaces/:idOrSlug（REQ-SPACE-002）：不可见 → 404。 */
export async function getSpace(db: DbOrTx, ctx: SpaceCtx, key: string): Promise<SpaceView> {
  const { row } = await loadSpace(db, ctx, key)
  return viewOf(db, ctx, row.id)
}

// ---------- 创建 / 修改 ----------

/** 由名称生成 slug：ASCII 部分转 kebab；中文等没有 ASCII 的名字退化为 `s-<随机 6 位>`。 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '')
  return base.length >= 2 ? base : `s-${Math.random().toString(36).slice(2, 8)}`
}

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

const slugConflict = () =>
  new AppError(409, 'CONFLICT_UNIQUE', 'slug 已被占用', {
    errors: [{ path: 'slug', message: 'slug 已被占用' }],
  })

async function slugTaken(db: DbOrTx, workspaceId: string, slug: string) {
  const [r] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.slug, slug)))
    .limit(1)
  return !!r
}

/** POST /spaces（REQ-SPACE-001 · 008）：guest 403；显式 slug 重复 → 409；自动 slug 冲突追加序号。创建者为 space admin。 */
export async function createSpace(
  db: Db,
  ctx: SpaceCtx,
  input: z.infer<typeof createSpaceSchema>,
): Promise<SpaceView> {
  assertCan(ctx.actor, 'space.create', null)
  const groupId = input.groupId ? await requireGroupId(db, ctx.workspaceId, input.groupId) : null
  let slug = input.slug
  if (slug) {
    if (await slugTaken(db, ctx.workspaceId, slug)) throw slugConflict()
  } else {
    const base = slugify(input.name)
    slug = base
    for (let i = 2; await slugTaken(db, ctx.workspaceId, slug); i++) slug = `${base}-${i}`
  }
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(spaces)
        .values({
          workspaceId: ctx.workspaceId,
          name: input.name,
          slug,
          kind: input.kind,
          icon: input.icon ?? null,
          color: input.color ?? null,
          visibility: input.visibility,
          description: input.description ?? null,
          groupId,
          sortKey: await nextSortKey(tx, ctx.workspaceId),
          createdBy: ctx.actor.id,
        })
        .returning({ id: spaces.id })
      if (!row) throw new Error('insert spaces returned nothing')
      await tx.insert(spaceMembers).values({ spaceId: row.id, userId: ctx.actor.id, role: 'admin' })
      return row.id
    })
    return viewOf(db, ctx, id)
  } catch (err) {
    if (isUniqueViolation(err)) throw slugConflict() // 并发同 slug：唯一约束兜底
    throw err
  }
}

/** PATCH /spaces/:id（REQ-SPACE-003 · 008 · 009）：space admin+；个人空间不可改可见性；乐观锁 ifUpdatedAt。 */
export async function patchSpace(
  db: DbOrTx,
  ctx: SpaceCtx,
  key: string,
  patch: z.infer<typeof patchSpaceSchema>,
): Promise<SpaceView> {
  const { row, ref } = await loadSpace(db, ctx, key)
  assertCan(ctx.actor, 'space.manage', ref)
  if (row.isPersonal && patch.visibility !== undefined && patch.visibility !== row.visibility)
    throw AppError.forbidden('个人空间不可改可见性')
  if (row.updatedAt.toISOString() !== new Date(patch.ifUpdatedAt).toISOString())
    throw new AppError(409, 'CONFLICT_STALE', '空间已被他人修改', {
      current: await viewOf(db, ctx, row.id),
    })
  const set: Partial<typeof spaces.$inferInsert> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.icon !== undefined) set.icon = patch.icon
  if (patch.color !== undefined) set.color = patch.color
  if (patch.visibility !== undefined) set.visibility = patch.visibility
  if (patch.description !== undefined) set.description = patch.description
  if (patch.kind !== undefined) set.kind = patch.kind
  if (patch.defaultKind !== undefined) {
    set.defaultKind = patch.defaultKind
    if (patch.defaultKind) set.defaultTypeId = null
  }
  if (patch.defaultTypeId !== undefined) {
    // 只能是本空间的空间类型：个人类型他人用不了（ADR-0036 修订 ADR-0019）
    if (patch.defaultTypeId) {
      const t = await loadEntryType(db, ctx.workspaceId, patch.defaultTypeId)
      if (!t || t.spaceId !== row.id)
        throw AppError.validation([{ path: 'defaultTypeId', message: '默认类型须为本空间的类型' }])
      set.defaultKind = null
    }
    set.defaultTypeId = patch.defaultTypeId
  }
  if (patch.enabledKinds !== undefined) {
    // 启用清单（REQ-KB-014）：类型项须为本空间的空间类型或本人的个人类型
    if (patch.enabledKinds) {
      for (const [i, k] of patch.enabledKinds.entries()) {
        if (!k.startsWith('type:')) continue
        const t = await loadEntryType(db, ctx.workspaceId, k.slice(5))
        const ok = !!t && (t.spaceId ? t.spaceId === row.id : t.createdBy === ctx.actor.id)
        if (!ok) throw AppError.validation([{ path: `enabledKinds.${i}`, message: '类型不存在' }])
      }
      set.enabledKinds = [...new Set(patch.enabledKinds)]
    } else set.enabledKinds = null
  }
  if (patch.defaultTemplateId !== undefined) {
    if (patch.defaultTemplateId)
      await assertSharedTemplate(db, ctx.workspaceId, patch.defaultTemplateId)
    set.defaultTemplateId = patch.defaultTemplateId
  }
  if (patch.groupId !== undefined) {
    if (row.isPersonal && patch.groupId) throw AppError.forbidden('个人空间不归入大类')
    set.groupId = patch.groupId ? await requireGroupId(db, ctx.workspaceId, patch.groupId) : null
  }
  await db.update(spaces).set(set).where(eq(spaces.id, row.id))
  if (patch.visibility !== undefined && patch.visibility !== row.visibility)
    accessChanged(ctx, { spaceId: row.id })
  return viewOf(db, ctx, row.id)
}

// 各写操作的鉴权与前置校验单独成函数：单个接口与批量（含 dryRun）共用，保证判定一致（ADR-0021）

async function checkArchive(db: DbOrTx, ctx: SpaceCtx, key: string, archived: boolean) {
  const { row, ref } = await loadSpace(db, ctx, key)
  assertCan(ctx.actor, 'space.manage', ref)
  if (row.isPersonal && archived) throw AppError.forbidden('个人空间不可归档')
  return row
}

async function checkSoftDelete(db: DbOrTx, ctx: SpaceCtx, key: string) {
  const { row, ref } = await loadSpace(db, ctx, key)
  if (row.isPersonal) throw AppError.forbidden('个人空间不可删除')
  assertCan(ctx.actor, 'space.delete', ref)
  return row
}

async function checkRestore(db: DbOrTx, ctx: SpaceCtx, key: string) {
  assertCan(ctx.actor, 'workspace.manage', null)
  const { row } = await loadSpace(db, ctx, key, { allowDeleted: true })
  if (!row.deletedAt) throw new AppError(409, 'CONFLICT_STALE', '空间未被删除')
  return row
}

async function checkPurge(db: DbOrTx, ctx: SpaceCtx, key: string) {
  // 先判权限再查对象：member 对任何 id 都是 403（REQ-SPACE-007 验收）
  assertCan(ctx.actor, 'workspace.manage', null)
  const { row } = await loadSpace(db, ctx, key, { allowDeleted: true })
  if (row.isPersonal) throw AppError.forbidden('个人空间不可删除')
  return row
}

/** POST /spaces/:id/archive|unarchive（REQ-SPACE-004）：归档后只读；个人空间不可归档（收件箱默认落点）。 */
export async function setSpaceArchived(
  db: DbOrTx,
  ctx: SpaceCtx,
  key: string,
  archived: boolean,
): Promise<SpaceView> {
  const row = await checkArchive(db, ctx, key, archived)
  if (!!row.archivedAt !== archived) {
    await db
      .update(spaces)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(spaces.id, row.id))
    accessChanged(ctx, { spaceId: row.id })
  }
  return viewOf(db, ctx, row.id)
}

// ---------- 删除 / 恢复 ----------

/** DELETE /spaces/:id（REQ-SPACE-003 · 007 · 009）：软删；仅工作区 owner/admin；个人空间 403。 */
export async function softDeleteSpace(db: DbOrTx, ctx: SpaceCtx, key: string): Promise<void> {
  const row = await checkSoftDelete(db, ctx, key)
  await db
    .update(spaces)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(spaces.id, row.id))
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'space.deleted',
    targetType: 'space',
    targetId: row.id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta: { name: row.name },
  })
  accessChanged(ctx, { spaceId: row.id })
}

/** POST /spaces/:id/restore（REQ-SPACE-007）：仅工作区 owner/admin（空间也只有他们能删）。 */
export async function restoreSpace(db: DbOrTx, ctx: SpaceCtx, key: string): Promise<SpaceView> {
  const row = await checkRestore(db, ctx, key)
  await db
    .update(spaces)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(spaces.id, row.id))
  accessChanged(ctx, { spaceId: row.id })
  return viewOf(db, ctx, row.id)
}

/**
 * DELETE /spaces/:id?permanent=1（REQ-SPACE-003 · 007）：仅工作区 owner/admin；个人空间 403。
 * 未软删的空间也可直接永久删（02 §5 未要求先进回收站）；任务 / 记录 / 评论 / 附件一并清除，记审计。
 */
export async function permanentlyDeleteSpace(db: Db, ctx: SpaceCtx, key: string): Promise<void> {
  const row = await checkPurge(db, ctx, key)
  if (!ctx.dataDir) throw new Error('permanentlyDeleteSpace 需要 dataDir（删除附件文件）')
  const counts = await purgeSpace({ db, dataDir: ctx.dataDir }, row.id)
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'space.permanently_deleted',
    targetType: 'space',
    targetId: row.id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta: { name: row.name, slug: row.slug, wasDeleted: !!row.deletedAt, ...counts },
  })
  accessChanged(ctx, { spaceId: row.id })
}

// ---------- 批量（ADR-0021） ----------

export interface SpaceBatchResult {
  ok: string[]
  failed: BatchFailure[]
  /** ok 里的空间当前未删除的记录 / 任务数（删除确认弹层据此提示影响面） */
  counts: { entries: number; tasks: number }
}

async function contentCounts(db: DbOrTx, ids: string[]) {
  if (!ids.length) return { entries: 0, tasks: 0 }
  const count = async (t: typeof entries | typeof tasks) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(inArray(t.spaceId, ids), isNull(t.deletedAt)))
    return r?.n ?? 0
  }
  return { entries: await count(entries), tasks: await count(tasks) }
}

/**
 * POST /spaces/batch（REQ-SPACE-010 ~ 012）：逐个走与单个接口相同的 check*（鉴权 / 个人空间 / 回收站状态），
 * 单个失败进 failed 不影响其它；dryRun 只跑 check 与计数。purge 只接受已在回收站的空间，防止误把正常空间彻底删掉。
 */
export async function batchSpaces(
  db: Db,
  ctx: SpaceCtx,
  input: z.infer<typeof batchSpacesSchema>,
): Promise<SpaceBatchResult> {
  const groupId =
    input.op === 'move' && input.groupId
      ? await requireGroupId(db, ctx.workspaceId, input.groupId)
      : null
  const ok: string[] = []
  const failed: SpaceBatchResult['failed'] = []
  const ids = [...new Set(input.ids)]
  // 计数在写之前：删除 / 彻底删除之后就查不到了
  const pending: string[] = []
  for (const id of ids) {
    try {
      switch (input.op) {
        case 'archive':
        case 'unarchive':
          await checkArchive(db, ctx, id, input.op === 'archive')
          break
        case 'move': {
          const { row, ref } = await loadSpace(db, ctx, id)
          assertCan(ctx.actor, 'space.manage', ref)
          if (row.isPersonal && groupId) throw AppError.forbidden('个人空间不归入大类')
          break
        }
        case 'delete':
          await checkSoftDelete(db, ctx, id)
          break
        case 'restore':
          await checkRestore(db, ctx, id)
          break
        case 'purge': {
          const row = await checkPurge(db, ctx, id)
          if (!row.deletedAt)
            throw new AppError(409, 'CONFLICT_STALE', '只能彻底删除回收站里的空间')
          break
        }
      }
      pending.push(id)
    } catch (err) {
      failed.push(batchFailure(id, err, '无权操作此空间'))
    }
  }
  const counts = await contentCounts(db, pending)
  if (input.dryRun) return { ok: pending, failed, counts }
  for (const id of pending) {
    try {
      switch (input.op) {
        case 'archive':
        case 'unarchive':
          await setSpaceArchived(db, ctx, id, input.op === 'archive')
          break
        case 'move':
          await db.update(spaces).set({ groupId, updatedAt: new Date() }).where(eq(spaces.id, id))
          break
        case 'delete':
          await softDeleteSpace(db, ctx, id)
          break
        case 'restore':
          await restoreSpace(db, ctx, id)
          break
        case 'purge':
          await permanentlyDeleteSpace(db, ctx, id)
          break
      }
      ok.push(id)
    } catch (err) {
      failed.push(batchFailure(id, err, '无权操作此空间'))
    }
  }
  return { ok, failed, counts }
}

// ---------- 排序 ----------

/**
 * PATCH /spaces/reorder（REQ-SPACE-005）：在 `after` 与其后第一个更大的键之间取新键，只写被拖项一行。
 * 被拖项需要 space.manage（sort_key 是工作区共享顺序）；`after` 只需可读。
 */
export async function reorderSpace(
  db: DbOrTx,
  ctx: SpaceCtx,
  input: { id: string; after: string | null; groupId?: string | null },
): Promise<SpaceView> {
  if (input.after === input.id)
    throw AppError.validation([{ path: 'after', message: '不能放在自己之后' }])
  const moved = await loadSpace(db, ctx, input.id)
  assertCan(ctx.actor, 'space.manage', moved.ref)
  const lowKey = input.after ? (await loadSpace(db, ctx, input.after)).row.sortKey : null
  const [next] = await db
    .select({ k: spaces.sortKey })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, ctx.workspaceId),
        ne(spaces.id, moved.row.id),
        lowKey === null ? undefined : gt(spaces.sortKey, lowKey),
      ),
    )
    .orderBy(asc(spaces.sortKey))
    .limit(1)
  // 放到最前且最前面就是自己之外的最小键：取 (null, 最小键)
  const sortKey = generateKeyBetween(lowKey, next?.k ?? null)
  // 拖到另一大类（ADR-0012）：键仍是工作区全局序，组内相对顺序自然正确
  const set: Partial<typeof spaces.$inferInsert> = { sortKey, updatedAt: new Date() }
  if (input.groupId !== undefined) {
    if (moved.row.isPersonal && input.groupId) throw AppError.forbidden('个人空间不归入大类')
    set.groupId = input.groupId ? await requireGroupId(db, ctx.workspaceId, input.groupId) : null
  }
  await db.update(spaces).set(set).where(eq(spaces.id, moved.row.id))
  return viewOf(db, ctx, moved.row.id)
}

// ---------- 成员 ----------

export interface SpaceMemberView {
  userId: string
  displayName: string
  email: string
  image: string | null
  role: SpaceRole
  workspaceRole: WorkspaceRole
  joinedAt: string
}

/** GET /spaces/:id/members：可读即可；只列仍是工作区成员的人（已离开的不显示）。 */
export async function listSpaceMembers(
  db: DbOrTx,
  ctx: SpaceCtx,
  key: string,
): Promise<SpaceMemberView[]> {
  const { row } = await loadSpace(db, ctx, key)
  const rows = await db
    .select({
      userId: spaceMembers.userId,
      role: spaceMembers.role,
      joinedAt: spaceMembers.joinedAt,
      name: userTable.name,
      displayName: userTable.displayName,
      email: userTable.email,
      image: userTable.image,
      workspaceRole: memberTable.role,
    })
    .from(spaceMembers)
    .innerJoin(userTable, eq(userTable.id, spaceMembers.userId))
    .innerJoin(
      memberTable,
      and(
        eq(memberTable.userId, spaceMembers.userId),
        eq(memberTable.organizationId, ctx.workspaceId),
      ),
    )
    .where(eq(spaceMembers.spaceId, row.id))
    .orderBy(asc(spaceMembers.joinedAt))
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName || r.name,
    email: r.email,
    image: r.image,
    role: r.role as SpaceRole,
    workspaceRole: r.workspaceRole as WorkspaceRole,
    joinedAt: r.joinedAt.toISOString(),
  }))
}

async function workspaceMemberOf(db: DbOrTx, workspaceId: string, userId: string) {
  const [m] = await db
    .select({
      id: userTable.id,
      role: memberTable.role,
      name: userTable.name,
      displayName: userTable.displayName,
    })
    .from(memberTable)
    .innerJoin(userTable, eq(userTable.id, memberTable.userId))
    .where(and(eq(memberTable.organizationId, workspaceId), eq(memberTable.userId, userId)))
    .limit(1)
  return m ?? null
}

function assertRoleAllowed(workspaceRole: string, role: SpaceRole) {
  const cap = spaceRoleCap(workspaceRole as WorkspaceRole)
  if (!spaceRoleWithin(role, cap))
    throw AppError.validation([{ path: 'role', message: `该成员在空间里最高只能是 ${cap}` }])
}

/** POST /spaces/:id/members（REQ-SPACE-006 · 009）：个人空间 403；guest 只能是 viewer；同事务发 space.invited。 */
export async function addSpaceMember(
  db: Db,
  ctx: SpaceCtx,
  key: string,
  input: { userId: string; role: SpaceRole },
) {
  const { row, ref } = await loadSpace(db, ctx, key)
  if (row.isPersonal) throw AppError.forbidden('个人空间不可加人')
  assertCan(ctx.actor, 'space.manage', ref)
  const target = await workspaceMemberOf(db, ctx.workspaceId, input.userId)
  if (!target) throw AppError.validation([{ path: 'userId', message: '不是工作区成员' }])
  assertRoleAllowed(target.role, input.role)
  const actor = await workspaceMemberOf(db, ctx.workspaceId, ctx.actor.id)
  await db.transaction(async (tx) => {
    await tx
      .insert(spaceMembers)
      .values({ spaceId: row.id, userId: input.userId, role: input.role })
      .onConflictDoUpdate({
        target: [spaceMembers.spaceId, spaceMembers.userId],
        set: { role: input.role },
      })
    await emit(tx, {
      kind: 'space.invited',
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      targetType: 'space',
      targetId: row.id,
      visibilityScope: { spaceId: row.id, userIds: [input.userId] },
      payload: {
        spaceId: row.id,
        spaceName: row.name,
        spaceSlug: row.slug,
        actorId: ctx.actor.id,
        actorName: actor?.displayName || actor?.name || '',
        role: input.role,
      },
    })
  })
  accessChanged(ctx, { spaceId: row.id, userIds: [input.userId] })
  return { spaceId: row.id, userId: input.userId, role: input.role }
}

/** PATCH /spaces/:id/members/:userId（REQ-SPACE-003）：改空间角色；目标须已在空间里。 */
export async function patchSpaceMember(
  db: DbOrTx,
  ctx: SpaceCtx,
  key: string,
  userId: string,
  role: SpaceRole,
) {
  const { row, ref } = await loadSpace(db, ctx, key)
  assertCan(ctx.actor, 'space.manage', ref)
  if (row.isPersonal) throw AppError.forbidden('个人空间不可改成员')
  const target = await workspaceMemberOf(db, ctx.workspaceId, userId)
  if (!target || (await memberRoleOf(db, row.id, userId)) === null)
    throw AppError.notFound('该用户不在此空间')
  assertRoleAllowed(target.role, role)
  await db
    .update(spaceMembers)
    .set({ role })
    .where(and(eq(spaceMembers.spaceId, row.id), eq(spaceMembers.userId, userId)))
  accessChanged(ctx, { spaceId: row.id, userIds: [userId] })
  return { spaceId: row.id, userId, role }
}

/** DELETE /spaces/:id/members/:userId（REQ-SPACE-003）：移出空间并广播 entry.access_changed（collab 收回访问）。 */
export async function removeSpaceMember(
  db: DbOrTx,
  ctx: SpaceCtx,
  key: string,
  userId: string,
): Promise<void> {
  const { row, ref } = await loadSpace(db, ctx, key)
  assertCan(ctx.actor, 'space.manage', ref)
  if (row.isPersonal) throw AppError.forbidden('个人空间不可改成员')
  const deleted = await db
    .delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, row.id), eq(spaceMembers.userId, userId)))
    .returning({ userId: spaceMembers.userId })
  if (!deleted.length) throw AppError.notFound('该用户不在此空间')
  accessChanged(ctx, { spaceId: row.id, userIds: [userId] })
}

/**
 * 大类 service（ADR-0012、02 §9 /space-groups、REQ-KB-001 · 002）。
 * - 工作区共享一套大类，全员可读；增删改排需 `can('group.manage')`（owner / admin）。
 * - 删大类 → 其下空间 group_id 置空（FK on delete set null），即「未分类」。
 * - 排序同空间：fractional-indexing `sort_key`（列级 COLLATE "C"），reorder 只改被拖项一行。
 */
import { and, asc, eq, gt, ne } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import {
  type createSpaceGroupSchema,
  DEFAULT_SPACE_GROUPS,
  type patchSpaceGroupSchema,
} from '../../shared/schemas/space-groups.ts'
import { assertCan } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { spaceGroups } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import type { SpaceCtx } from './spaces.ts'

export interface SpaceGroupView {
  id: string
  name: string
  color: string | null
  icon: string | null
  description: string | null
  sortKey: string
}

type Row = typeof spaceGroups.$inferSelect
const view = (r: Row): SpaceGroupView => ({
  id: r.id,
  name: r.name,
  color: r.color,
  icon: r.icon,
  description: r.description,
  sortKey: r.sortKey,
})

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (err as { cause?: { code?: string } })?.cause?.code === '23505'
const nameConflict = () => new AppError(409, 'CONFLICT_UNIQUE', '已有同名大类')

/** 新工作区预置大类（create-owner / seed 同事务调用）；已有任何大类则不动。 */
export async function ensureDefaultGroups(db: DbOrTx, workspaceId: string, createdBy?: string) {
  const [any] = await db
    .select({ id: spaceGroups.id })
    .from(spaceGroups)
    .where(eq(spaceGroups.workspaceId, workspaceId))
    .limit(1)
  if (any) return
  let key: string | null = null
  for (const g of DEFAULT_SPACE_GROUPS) {
    key = generateKeyBetween(key, null)
    await db
      .insert(spaceGroups)
      .values({ workspaceId, ...g, sortKey: key, createdBy: createdBy ?? null })
      .onConflictDoNothing()
  }
}

export async function listSpaceGroups(db: DbOrTx, ctx: SpaceCtx): Promise<SpaceGroupView[]> {
  const rows = await db
    .select()
    .from(spaceGroups)
    .where(eq(spaceGroups.workspaceId, ctx.workspaceId))
    .orderBy(asc(spaceGroups.sortKey), asc(spaceGroups.id))
  return rows.map(view)
}

/** 取本工作区的大类（跨工作区 / 不存在 → 422，用于 spaces 的 groupId 校验）。 */
export async function requireGroupId(db: DbOrTx, workspaceId: string, id: string): Promise<string> {
  const [r] = await db
    .select({ id: spaceGroups.id })
    .from(spaceGroups)
    .where(and(eq(spaceGroups.id, id), eq(spaceGroups.workspaceId, workspaceId)))
  if (!r) throw AppError.validation([{ path: 'groupId', message: '大类不存在' }])
  return r.id
}

async function loadRow(db: DbOrTx, ctx: SpaceCtx, id: string): Promise<Row> {
  const [r] = await db
    .select()
    .from(spaceGroups)
    .where(and(eq(spaceGroups.id, id), eq(spaceGroups.workspaceId, ctx.workspaceId)))
  if (!r) throw AppError.notFound('大类不存在')
  return r
}

export async function createSpaceGroup(
  db: DbOrTx,
  ctx: SpaceCtx,
  input: z.infer<typeof createSpaceGroupSchema>,
): Promise<SpaceGroupView> {
  assertCan(ctx.actor, 'group.manage', null)
  const tail = (await listSpaceGroups(db, ctx)).at(-1)?.sortKey ?? null
  try {
    const [row] = await db
      .insert(spaceGroups)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        color: input.color ?? null,
        icon: input.icon ?? null,
        description: input.description ?? null,
        sortKey: generateKeyBetween(tail, null),
        createdBy: ctx.actor.id,
      })
      .returning()
    if (!row) throw new Error('insert space_groups failed')
    return view(row)
  } catch (err) {
    if (isUniqueViolation(err)) throw nameConflict()
    throw err
  }
}

export async function patchSpaceGroup(
  db: DbOrTx,
  ctx: SpaceCtx,
  id: string,
  input: z.infer<typeof patchSpaceGroupSchema>,
): Promise<SpaceGroupView> {
  assertCan(ctx.actor, 'group.manage', null)
  await loadRow(db, ctx, id)
  try {
    const [row] = await db
      .update(spaceGroups)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(spaceGroups.id, id))
      .returning()
    if (!row) throw AppError.notFound('大类不存在')
    return view(row)
  } catch (err) {
    if (isUniqueViolation(err)) throw nameConflict()
    throw err
  }
}

/** 删除大类：其下空间变「未分类」（不删空间）。 */
export async function deleteSpaceGroup(db: DbOrTx, ctx: SpaceCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'group.manage', null)
  await loadRow(db, ctx, id)
  await db.delete(spaceGroups).where(eq(spaceGroups.id, id))
}

export async function reorderSpaceGroup(
  db: DbOrTx,
  ctx: SpaceCtx,
  input: { id: string; after: string | null },
): Promise<SpaceGroupView> {
  assertCan(ctx.actor, 'group.manage', null)
  if (input.after === input.id)
    throw AppError.validation([{ path: 'after', message: '不能放在自己之后' }])
  const moved = await loadRow(db, ctx, input.id)
  const lowKey = input.after ? (await loadRow(db, ctx, input.after)).sortKey : null
  const [next] = await db
    .select({ k: spaceGroups.sortKey })
    .from(spaceGroups)
    .where(
      and(
        eq(spaceGroups.workspaceId, ctx.workspaceId),
        ne(spaceGroups.id, moved.id),
        lowKey === null ? undefined : gt(spaceGroups.sortKey, lowKey),
      ),
    )
    .orderBy(asc(spaceGroups.sortKey))
    .limit(1)
  const [row] = await db
    .update(spaceGroups)
    .set({ sortKey: generateKeyBetween(lowKey, next?.k ?? null), updatedAt: new Date() })
    .where(eq(spaceGroups.id, moved.id))
    .returning()
  if (!row) throw AppError.notFound('大类不存在')
  return view(row)
}

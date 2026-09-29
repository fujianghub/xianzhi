/**
 * 保存视图（ADR-0033、REQ-BUG-009）：个人所有（同标签 ADR-0017 的先例，按 owner_id 过滤，不涉角色比较）；
 * 他人的视图一律 404。带空间的视图：创建时该空间须可读；空间硬删时级联删除。
 */
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import type { EntryFilterSearch } from '../../shared/entry-search.ts'
import {
  type createEntryViewSchema,
  MAX_ENTRY_VIEWS,
  type patchEntryViewSchema,
} from '../../shared/schemas/entry-views.ts'
import { can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { entryViews } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { type EntryCtx, loadSpaceRef } from './entries.ts'

type Row = typeof entryViews.$inferSelect

export interface EntryViewView {
  id: string
  name: string
  spaceId: string | null
  search: EntryFilterSearch
  createdAt: string
  updatedAt: string
}

const toView = (r: Row): EntryViewView => ({
  id: r.id,
  name: r.name,
  spaceId: r.spaceId,
  search: r.search as EntryFilterSearch,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

const mine = (ctx: EntryCtx) =>
  and(eq(entryViews.workspaceId, ctx.workspaceId), eq(entryViews.ownerId, ctx.actor.id))

/** 空间视图不重复记 spaceId（由视图本身的 spaceId 决定打开位置）。 */
const scoped = (search: EntryFilterSearch, spaceId: string | null) => {
  if (!spaceId) return search
  const { spaceId: _drop, ...rest } = search
  return rest
}

export async function listEntryViews(db: Db, ctx: EntryCtx): Promise<EntryViewView[]> {
  const rows = await db
    .select()
    .from(entryViews)
    .where(mine(ctx))
    .orderBy(asc(entryViews.sortKey), asc(entryViews.id))
  return rows.map(toView)
}

export async function createEntryView(
  db: Db,
  ctx: EntryCtx,
  input: z.infer<typeof createEntryViewSchema>,
): Promise<EntryViewView> {
  const spaceId = input.spaceId ?? null
  if (spaceId) {
    const sp = await loadSpaceRef(db, ctx.actor, spaceId)
    if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在')
  }
  const [n] = await db.select({ n: count() }).from(entryViews).where(mine(ctx))
  if ((n?.n ?? 0) >= MAX_ENTRY_VIEWS)
    throw AppError.validation([{ path: 'name', message: `每人最多 ${MAX_ENTRY_VIEWS} 个视图` }])
  const [last] = await db
    .select({ k: entryViews.sortKey })
    .from(entryViews)
    .where(mine(ctx))
    .orderBy(desc(entryViews.sortKey))
    .limit(1)
  const [row] = await db
    .insert(entryViews)
    .values({
      workspaceId: ctx.workspaceId,
      ownerId: ctx.actor.id,
      spaceId,
      name: input.name,
      search: scoped(input.search, spaceId),
      sortKey: generateKeyBetween(last?.k ?? null, null),
    })
    .returning()
  if (!row) throw new Error('insert entry_views failed')
  return toView(row)
}

async function requireOwn(db: Db, ctx: EntryCtx, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(entryViews)
    .where(and(mine(ctx), eq(entryViews.id, id)))
    .limit(1)
  if (!row) throw AppError.notFound('视图不存在')
  return row
}

export async function patchEntryView(
  db: Db,
  ctx: EntryCtx,
  id: string,
  input: z.infer<typeof patchEntryViewSchema>,
): Promise<EntryViewView> {
  const cur = await requireOwn(db, ctx, id)
  if (
    input.ifUpdatedAt &&
    cur.updatedAt.toISOString() !== new Date(input.ifUpdatedAt).toISOString()
  )
    throw new AppError(409, 'CONFLICT_STALE', '视图已被修改', { current: toView(cur) })
  const [row] = await db
    .update(entryViews)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.search !== undefined ? { search: scoped(input.search, cur.spaceId) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(entryViews.id, id))
    .returning()
  if (!row) throw AppError.notFound('视图不存在')
  return toView(row)
}

export async function deleteEntryView(db: Db, ctx: EntryCtx, id: string): Promise<void> {
  await requireOwn(db, ctx, id)
  await db.delete(entryViews).where(eq(entryViews.id, id))
}

/**
 * 空间目录树（ADR-0012、REQ-KB-005）：`entries.parent_id` + `tree_order`（fractional-indexing，COLLATE "C"）。
 * - `tree_order` 为 null = 不在目录（「其余记录」）；在目录中的记录父页必须同空间且也在目录中。
 * - 一次取整棵树（只取标题等元数据，不取正文，不变量 6）；可见性同列表（visibleEntriesWhere），读不到的节点连同其子树不出现。
 * - 移动：需对被移动记录 entry.write；父页须同空间、可读、在目录中，且不能是自己或自己的后代（递归 CTE 防环）；
 *   `after` 须为新父页下的同级。只改被移动的一行。
 * - 软删父页 / 移到别的空间：其子页上移一级（接到它原来的父页、保持相对顺序在其位置）。
 */
import { and, asc, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import type { moveEntrySchema } from '../../shared/schemas/entries.ts'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import { assertCan, can, visibleEntriesWhere } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { entries } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import type { EntryCtx } from './entries.ts'
import { loadEntry } from './entries.ts'
import { getSpace } from './spaces.ts'

export interface TreeNode {
  id: string
  title: string
  kind: EntryKind
  typeId: string | null
  parentId: string | null
  treeOrder: string
  updatedAt: string
}

/** 同级末尾的顺序键。 */
export async function lastSiblingKey(
  db: DbOrTx,
  spaceId: string,
  parentId: string | null,
  exceptId?: string,
): Promise<string | null> {
  const [last] = await db
    .select({ k: entries.treeOrder })
    .from(entries)
    .where(
      and(
        eq(entries.spaceId, spaceId),
        parentId ? eq(entries.parentId, parentId) : isNull(entries.parentId),
        isNotNull(entries.treeOrder),
        isNull(entries.deletedAt),
        exceptId ? ne(entries.id, exceptId) : undefined,
      ),
    )
    .orderBy(sql`${entries.treeOrder} desc`)
    .limit(1)
  return last?.k ?? null
}

/** 新建记录放进目录（createEntry 同事务调用）：校验父页后返回 { parentId, treeOrder }。 */
export async function placeNew(
  db: DbOrTx,
  ctx: EntryCtx,
  spaceId: string,
  parentId: string | null,
): Promise<{ parentId: string | null; treeOrder: string }> {
  if (parentId) await requireParent(db, ctx, spaceId, parentId)
  return {
    parentId,
    treeOrder: generateKeyBetween(await lastSiblingKey(db, spaceId, parentId), null),
  }
}

async function requireParent(db: DbOrTx, ctx: EntryCtx, spaceId: string, parentId: string) {
  const p = await loadEntry(db, ctx.actor, parentId)
  if (!p || !can(ctx.actor, 'entry.read', p.ref) || p.row.deletedAt)
    throw AppError.validation([{ path: 'parentId', message: '父页不存在' }])
  if (p.row.spaceId !== spaceId)
    throw AppError.validation([{ path: 'parentId', message: '父页须在同一空间' }])
  if (p.row.treeOrder === null)
    throw AppError.validation([{ path: 'parentId', message: '父页不在目录中' }])
  return p
}

/** GET /spaces/:id/tree：目录内的全部可见节点（扁平，前端组树）。 */
export async function getSpaceTree(db: Db, ctx: EntryCtx, spaceKey: string): Promise<TreeNode[]> {
  const space = await getSpace(db, ctx, spaceKey) // 不可见 → 404
  const rows = await db
    .select({
      id: entries.id,
      title: entries.title,
      kind: entries.kind,
      typeId: entries.typeId,
      parentId: entries.parentId,
      treeOrder: entries.treeOrder,
      updatedAt: entries.updatedAt,
    })
    .from(entries)
    .where(
      and(
        eq(entries.spaceId, space.id),
        isNotNull(entries.treeOrder),
        isNull(entries.archivedAt),
        visibleEntriesWhere(ctx.actor),
      ),
    )
    .orderBy(asc(entries.treeOrder), asc(entries.id))
    .limit(5000)
  // 父页读不到 / 不在目录 → 其子树整体不出现（避免孤儿冒到根上泄露层级）
  const ids = new Set(rows.map((r) => r.id))
  const keep = new Set<string>()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const reachable = (id: string, seen = new Set<string>()): boolean => {
    if (keep.has(id)) return true
    const r = byId.get(id)
    if (!r || seen.has(id)) return false
    seen.add(id)
    const ok = r.parentId === null || (ids.has(r.parentId) && reachable(r.parentId, seen))
    if (ok) keep.add(id)
    return ok
  }
  return rows
    .filter((r) => reachable(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind as EntryKind,
      typeId: r.typeId,
      parentId: r.parentId,
      treeOrder: r.treeOrder as string,
      updatedAt: r.updatedAt.toISOString(),
    }))
}

/** `candidate` 是否是 `id` 自己或其后代（沿 candidate 往上找祖先）。 */
async function isSelfOrDescendant(db: DbOrTx, id: string, candidate: string): Promise<boolean> {
  const r = await db.execute<{ hit: boolean }>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, parent_id, 0 from ${entries} where id = ${candidate}
      union all
      select e.id, e.parent_id, up.depth + 1 from ${entries} e join up on e.id = up.parent_id where up.depth < 64
    )
    select exists(select 1 from up where id = ${id}) as hit`)
  return !!r.rows[0]?.hit
}

/** PATCH /entries/:id/move（REQ-KB-005）。 */
export async function moveEntry(
  db: Db,
  ctx: EntryCtx,
  id: string,
  input: z.infer<typeof moveEntrySchema>,
): Promise<{ id: string; parentId: string | null; treeOrder: string | null }> {
  const loaded = await loadEntry(db, ctx.actor, id)
  if (!loaded || !can(ctx.actor, 'entry.read', loaded.ref) || loaded.row.deletedAt)
    throw AppError.notFound('记录不存在')
  assertCan(ctx.actor, 'entry.write', loaded.ref)
  const spaceId = loaded.row.spaceId
  if ('detach' in input) {
    await db.transaction(async (tx) => {
      await liftChildren(tx, loaded.row)
      await tx.update(entries).set({ parentId: null, treeOrder: null }).where(eq(entries.id, id))
    })
    return { id, parentId: null, treeOrder: null }
  }
  const parentId = input.parentId
  if (parentId) {
    if (await isSelfOrDescendant(db, id, parentId))
      throw AppError.validation([{ path: 'parentId', message: '不能移到自己或自己的子页下' }])
    await requireParent(db, ctx, spaceId, parentId)
  }
  let low: string | null = null
  if (input.after) {
    if (input.after === id)
      throw AppError.validation([{ path: 'after', message: '不能放在自己之后' }])
    const [a] = await db
      .select({ k: entries.treeOrder, p: entries.parentId, s: entries.spaceId })
      .from(entries)
      .where(eq(entries.id, input.after))
    if (!a || a.s !== spaceId || a.p !== parentId || a.k === null)
      throw AppError.validation([{ path: 'after', message: 'after 须为同一父页下的同级' }])
    low = a.k
  }
  const [next] = await db
    .select({ k: entries.treeOrder })
    .from(entries)
    .where(
      and(
        eq(entries.spaceId, spaceId),
        parentId ? eq(entries.parentId, parentId) : isNull(entries.parentId),
        isNotNull(entries.treeOrder),
        ne(entries.id, id),
        low === null ? undefined : gt(entries.treeOrder, low),
      ),
    )
    .orderBy(asc(entries.treeOrder))
    .limit(1)
  const treeOrder = generateKeyBetween(low, next?.k ?? null)
  await db.update(entries).set({ parentId, treeOrder }).where(eq(entries.id, id))
  return { id, parentId, treeOrder }
}

/**
 * 子页上移一级：接到 `row` 原来的父页下，保持彼此相对顺序并排在 `row` 原位置之后
 * （软删父页、移出目录、移到别的空间时调用）。
 */
export async function liftChildren(
  tx: DbOrTx,
  row: { id: string; spaceId: string; parentId: string | null; treeOrder: string | null },
): Promise<void> {
  const kids = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.parentId, row.id), isNotNull(entries.treeOrder)))
    .orderBy(asc(entries.treeOrder))
  if (!kids.length) return
  const inTree = row.treeOrder !== null
  const newParent = inTree ? row.parentId : null
  let low = inTree ? row.treeOrder : await lastSiblingKey(tx, row.spaceId, null)
  const [next] =
    inTree && low
      ? await tx
          .select({ k: entries.treeOrder })
          .from(entries)
          .where(
            and(
              eq(entries.spaceId, row.spaceId),
              newParent ? eq(entries.parentId, newParent) : isNull(entries.parentId),
              isNotNull(entries.treeOrder),
              gt(entries.treeOrder, low),
              ne(entries.id, row.id),
            ),
          )
          .orderBy(asc(entries.treeOrder))
          .limit(1)
      : []
  for (const k of kids) {
    low = generateKeyBetween(low, next?.k ?? null)
    await tx
      .update(entries)
      .set({ parentId: newParent, treeOrder: low })
      .where(eq(entries.id, k.id))
  }
}

/**
 * 列表批量路径（ADR-0014）：一次递归查询取出所有祖先，再按可见性过滤；
 * 每条返回「根 → 父页」，读不到的祖先及其以上截断（与 entryPath 同规则）。不在目录的记录返回空。
 */
export async function entryPaths(
  db: DbOrTx,
  ctx: EntryCtx,
  rows: { id: string; parentId: string | null; treeOrder: string | null }[],
): Promise<Map<string, { id: string; title: string }[]>> {
  const out = new Map<string, { id: string; title: string }[]>()
  const starts = [
    ...new Set(
      rows.filter((r) => r.treeOrder !== null && r.parentId).map((r) => r.parentId as string),
    ),
  ]
  if (!starts.length) return out
  const r = await db.execute<{ id: string; title: string; parent_id: string | null }>(sql`
    with recursive up(id, title, parent_id, depth) as (
      select id, title, parent_id, 0 from ${entries} where id in (${sql.join(
        starts.map((s) => sql`${s}::uuid`),
        sql`, `,
      )})
      union all
      select e.id, e.title, e.parent_id, up.depth + 1 from ${entries} e join up on e.id = up.parent_id where up.depth < 64
    )
    select distinct id, title, parent_id from up`)
  const byId = new Map(r.rows.map((x) => [x.id, x]))
  const visible = new Set(
    r.rows.length
      ? (
          await db
            .select({ id: entries.id })
            .from(entries)
            .where(
              and(
                sql`${entries.id} in (${sql.join(
                  r.rows.map((x) => sql`${x.id}::uuid`),
                  sql`, `,
                )})`,
                isNull(entries.deletedAt),
                visibleEntriesWhere(ctx.actor),
              ),
            )
        ).map((x) => x.id)
      : [],
  )
  for (const row of rows) {
    if (row.treeOrder === null || !row.parentId) continue
    const chain: { id: string; title: string }[] = []
    let cur = byId.get(row.parentId)
    let guard = 0
    while (cur && guard++ < 64) {
      if (!visible.has(cur.id)) break // 读不到：其以上全部截断
      chain.unshift({ id: cur.id, title: cur.title })
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    }
    out.set(row.id, chain)
  }
  return out
}

/** 记录路径（面包屑）：自根到父页；读不到的祖先截断在其之下。 */
export async function entryPath(
  db: DbOrTx,
  ctx: EntryCtx,
  parentId: string | null,
): Promise<{ id: string; title: string }[]> {
  if (!parentId) return []
  const r = await db.execute<{ id: string; title: string; depth: number }>(sql`
    with recursive up(id, title, parent_id, depth) as (
      select id, title, parent_id, 0 from ${entries} where id = ${parentId}
      union all
      select e.id, e.title, e.parent_id, up.depth + 1 from ${entries} e join up on e.id = up.parent_id where up.depth < 64
    )
    select id, title, depth from up order by depth desc`)
  const out: { id: string; title: string }[] = []
  for (const row of r.rows) {
    const e = await loadEntry(db, ctx.actor, row.id)
    if (!e || !can(ctx.actor, 'entry.read', e.ref) || e.row.deletedAt) {
      out.length = 0 // 读不到的祖先：只保留其下方可见的一段
      continue
    }
    out.push({ id: row.id, title: row.title })
  }
  return out
}

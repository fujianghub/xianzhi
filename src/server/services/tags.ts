/**
 * 标签（01 §3.7、02 §9、REQ-TAG-001 · 002 · REQ-TAG-004 ~ 007）：颜色为 9 色 token 名（ADR-0010）。
 * 按人隔离（ADR-0017）：标签属于创建者，只有本人看得到、用得了、管得了；同一人名下不重名，不同人可同名。
 * 共享的记录 / 任务上，各人打的是各自的标签（关联表不变，读写时按 tags.created_by = 当前用户过滤）。
 * 新建 = 非 guest；改名 / 改色 / 合并 / 删除 = 本人（管理员不例外）。
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { createTagSchema, patchTagSchema } from '../../shared/schemas/tags.ts'
import { type Actor, assertCan, can, type TagRef } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { entryTags, tags, taskTags } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'

export interface TagCtx {
  actor: Actor
  workspaceId: string
}
export interface TagView {
  id: string
  name: string
  color: string
  createdBy: string | null
  canManage: boolean
  usage: { tasks: number; entries: number }
}

const conflict = () =>
  new AppError(409, 'CONFLICT_UNIQUE', '标签名已存在', {
    errors: [{ path: 'name', message: '标签名已存在' }],
  })
const isUnique = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/** 当前用户自己的标签 id（SQL 片段），供记录 / 任务 / 搜索按人过滤。 */
export const ownTagIdsSql = (actorId: string) =>
  sql`(select id from ${tags} where created_by = ${actorId})`

/** 校验 tagIds 都是当前用户自己的标签（别人的 / 不存在 → 422，不泄露是否存在）。 */
export async function assertOwnTags(db: DbOrTx, ctx: TagCtx, ids: string[], path = 'tagIds') {
  const want = [...new Set(ids)]
  if (!want.length) return
  const found = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        inArray(tags.id, want),
        eq(tags.workspaceId, ctx.workspaceId),
        eq(tags.createdBy, ctx.actor.id),
      ),
    )
  if (found.length !== want.length) throw AppError.validation([{ path, message: '标签不存在' }])
}

/** GET /tags：本人的标签（数量级几十，不分页），附使用次数与 canManage。 */
export async function listTags(db: DbOrTx, ctx: TagCtx): Promise<TagView[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      createdBy: tags.createdBy,
      t: sql<number>`(select count(*)::int from ${taskTags} tt where tt.tag_id = ${tags.id})`,
      e: sql<number>`(select count(*)::int from ${entryTags} et where et.tag_id = ${tags.id})`,
    })
    .from(tags)
    .where(and(eq(tags.workspaceId, ctx.workspaceId), eq(tags.createdBy, ctx.actor.id)))
    .orderBy(asc(tags.name))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    createdBy: r.createdBy,
    canManage: can(ctx.actor, 'tag.manage', { id: r.id, createdBy: r.createdBy }),
    usage: { tasks: r.t, entries: r.e },
  }))
}

/** 当前用户能否新建标签（列表附带，TagPicker / 管理页据此显示「新建」）。 */
export const canCreateTag = (ctx: TagCtx) => can(ctx.actor, 'tag.create', null)

async function getTag(db: DbOrTx, ctx: TagCtx, id: string): Promise<TagView> {
  const found = (await listTags(db, ctx)).find((t) => t.id === id)
  if (!found) throw AppError.notFound('标签不存在')
  return found
}
const refOf = (t: TagView): TagRef => ({ id: t.id, createdBy: t.createdBy })

export async function createTag(db: Db, ctx: TagCtx, input: z.infer<typeof createTagSchema>) {
  assertCan(ctx.actor, 'tag.create', null)
  try {
    const [row] = await db
      .insert(tags)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        color: input.color,
        createdBy: ctx.actor.id,
      })
      .returning({ id: tags.id })
    return getTag(db, ctx, row?.id ?? '')
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
}

export async function patchTag(
  db: Db,
  ctx: TagCtx,
  id: string,
  input: z.infer<typeof patchTagSchema>,
) {
  assertCan(ctx.actor, 'tag.manage', refOf(await getTag(db, ctx, id)))
  try {
    await db
      .update(tags)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.color ? { color: input.color } : {}),
      })
      .where(
        and(
          eq(tags.id, id),
          eq(tags.workspaceId, ctx.workspaceId),
          eq(tags.createdBy, ctx.actor.id),
        ),
      )
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
  return getTag(db, ctx, id)
}

/** DELETE /tags/:id：删除并解除所有关联（task_tags / entry_tags 经 FK 级联）。 */
export async function deleteTag(db: Db, ctx: TagCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'tag.manage', refOf(await getTag(db, ctx, id)))
  await db
    .delete(tags)
    .where(
      and(eq(tags.id, id), eq(tags.workspaceId, ctx.workspaceId), eq(tags.createdBy, ctx.actor.id)),
    )
}

/**
 * POST /tags/:id/merge（REQ-TAG-005）：把 `id` 的全部任务 / 记录关联并入 `intoId`（已有的不重复），再删除 `id`。
 * 需对两边都可管理；同事务。
 */
export async function mergeTag(db: Db, ctx: TagCtx, id: string, intoId: string): Promise<TagView> {
  if (id === intoId) throw AppError.validation([{ path: 'intoId', message: '不能合并到自己' }])
  const src = await getTag(db, ctx, id)
  const dst = await getTag(db, ctx, intoId)
  assertCan(ctx.actor, 'tag.manage', refOf(src))
  assertCan(ctx.actor, 'tag.manage', refOf(dst))
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into ${entryTags} (entry_id, tag_id)
      select entry_id, ${intoId}::uuid from ${entryTags} where tag_id = ${id}
      on conflict do nothing`)
    await tx.execute(sql`
      insert into ${taskTags} (task_id, tag_id)
      select task_id, ${intoId}::uuid from ${taskTags} where tag_id = ${id}
      on conflict do nothing`)
    await tx.delete(tags).where(eq(tags.id, id))
  })
  return getTag(db, ctx, intoId)
}

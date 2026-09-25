/**
 * 标签（01 §3.7、02 §9、REQ-TAG-001 · 002）：工作区内名字唯一，颜色为 9 色 token 名（ADR-0010）。
 * 权限：创建 = 非 guest（tag.create，TagPicker 输入即创建）；改名 / 改色 / 删除 = owner/admin（tag.manage，影响全工作区）。
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { createTagSchema, patchTagSchema } from '../../shared/schemas/tags.ts'
import { type Actor, assertCan } from '../authz.ts'
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

/** GET /tags：全部标签（数量级几十，不分页），附使用次数（仅计数，不泄露对象）。 */
export async function listTags(db: DbOrTx, ctx: TagCtx): Promise<TagView[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      t: sql<number>`(select count(*)::int from ${taskTags} tt where tt.tag_id = ${tags.id})`,
      e: sql<number>`(select count(*)::int from ${entryTags} et where et.tag_id = ${tags.id})`,
    })
    .from(tags)
    .where(eq(tags.workspaceId, ctx.workspaceId))
    .orderBy(asc(tags.name))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    usage: { tasks: r.t, entries: r.e },
  }))
}

async function getTag(db: DbOrTx, ctx: TagCtx, id: string): Promise<TagView> {
  const found = (await listTags(db, ctx)).find((t) => t.id === id)
  if (!found) throw AppError.notFound('标签不存在')
  return found
}

export async function createTag(db: Db, ctx: TagCtx, input: z.infer<typeof createTagSchema>) {
  assertCan(ctx.actor, 'tag.create', null)
  try {
    const [row] = await db
      .insert(tags)
      .values({ workspaceId: ctx.workspaceId, name: input.name, color: input.color })
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
  assertCan(ctx.actor, 'tag.manage', null)
  await getTag(db, ctx, id)
  try {
    await db
      .update(tags)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.color ? { color: input.color } : {}),
      })
      .where(and(eq(tags.id, id), eq(tags.workspaceId, ctx.workspaceId)))
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
  return getTag(db, ctx, id)
}

/** DELETE /tags/:id：删除并解除所有关联（task_tags / entry_tags 经 FK 级联）。 */
export async function deleteTag(db: Db, ctx: TagCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'tag.manage', null)
  const r = await db
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.workspaceId, ctx.workspaceId)))
    .returning({ id: tags.id })
  if (!r.length) throw AppError.notFound('标签不存在')
}

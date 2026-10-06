/**
 * 个人清单（ADR-0044、REQ-TASK-029 · 030）：任务的按人分类，同标签按人私有（ADR-0017）。
 * - 清单 / 文件夹属于本人：只有本人看得到、管得了、往里归任务；管理员不例外。
 * - 归类存 `task_list_items(task, user) → list`：同一任务各人各归各的，互不覆盖，不动 tasks 行。
 * - 删清单：归类随之删除，任务不动（回到「未归类」）；删文件夹：其下清单回到根（FK set null）。
 * - 文件夹只装清单，深度 1；每人 ≤ 200 项（07 §5）。
 */
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import type { TaskListKind } from '../../shared/schemas/enums.ts'
import {
  type createTaskListSchema,
  type patchTaskListSchema,
  TASK_LISTS_MAX,
} from '../../shared/schemas/taskLists.ts'
import { type Actor, assertCan, can, type TaskListRef } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { taskListItems, taskLists, tasks } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'

export interface TaskListCtx {
  actor: Actor
  workspaceId: string
}
export interface TaskListView {
  id: string
  kind: TaskListKind
  name: string
  color: string | null
  parentId: string | null
  sortKey: string
}

type Row = typeof taskLists.$inferSelect
const view = (r: Row): TaskListView => ({
  id: r.id,
  kind: r.kind as TaskListKind,
  name: r.name,
  color: r.color,
  parentId: r.parentId,
  sortKey: r.sortKey,
})
const refOf = (r: Pick<Row, 'id' | 'ownerId'>): TaskListRef => ({ id: r.id, ownerId: r.ownerId })

const conflict = () =>
  new AppError(409, 'CONFLICT_UNIQUE', '同名清单已存在', {
    errors: [{ path: 'name', message: '同名清单已存在' }],
  })
const isUnique = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/** 本人的清单行；别人的 / 不存在 → null（不泄露是否存在） */
async function loadOwn(db: DbOrTx, ctx: TaskListCtx, id: string): Promise<Row | null> {
  const [r] = await db
    .select()
    .from(taskLists)
    .where(and(eq(taskLists.id, id), eq(taskLists.workspaceId, ctx.workspaceId)))
    .limit(1)
  return r && can(ctx.actor, 'task_list.manage', refOf(r)) ? r : null
}

/** 任务可归入的清单：本人的、kind = list；否则 422（path 默认 listId） */
export async function assertOwnList(db: DbOrTx, ctx: TaskListCtx, id: string, path = 'listId') {
  const r = await loadOwn(db, ctx, id)
  if (r?.kind !== 'list') throw AppError.validation([{ path, message: '清单不存在' }])
}

/** 同层最后一项的 sortKey */
async function lastKey(db: DbOrTx, ctx: TaskListCtx, parentId: string | null) {
  const [r] = await db
    .select({ k: taskLists.sortKey })
    .from(taskLists)
    .where(
      and(
        eq(taskLists.ownerId, ctx.actor.id),
        eq(taskLists.workspaceId, ctx.workspaceId),
        parentId ? eq(taskLists.parentId, parentId) : isNull(taskLists.parentId),
      ),
    )
    .orderBy(sql`${taskLists.sortKey} desc`)
    .limit(1)
  return r?.k ?? null
}

async function assertFolder(db: DbOrTx, ctx: TaskListCtx, id: string) {
  const f = await loadOwn(db, ctx, id)
  if (f?.kind !== 'folder')
    throw AppError.validation([{ path: 'parentId', message: '文件夹不存在' }])
}

/** GET /task-lists：本人的清单与文件夹，按层内 sortKey（前端组树） */
export async function listTaskLists(db: DbOrTx, ctx: TaskListCtx): Promise<TaskListView[]> {
  const rows = await db
    .select()
    .from(taskLists)
    .where(and(eq(taskLists.workspaceId, ctx.workspaceId), eq(taskLists.ownerId, ctx.actor.id)))
    .orderBy(asc(taskLists.sortKey), asc(taskLists.id))
  return rows.map(view)
}

export async function createTaskList(
  db: DbOrTx,
  ctx: TaskListCtx,
  input: z.infer<typeof createTaskListSchema>,
): Promise<TaskListView> {
  assertCan(ctx.actor, 'task_list.create', null)
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taskLists)
    .where(and(eq(taskLists.workspaceId, ctx.workspaceId), eq(taskLists.ownerId, ctx.actor.id)))
  if (n >= TASK_LISTS_MAX)
    throw AppError.validation([{ path: 'name', message: `清单最多 ${TASK_LISTS_MAX} 个` }])
  const parentId = input.kind === 'list' ? (input.parentId ?? null) : null
  if (parentId) await assertFolder(db, ctx, parentId)
  try {
    const [r] = await db
      .insert(taskLists)
      .values({
        workspaceId: ctx.workspaceId,
        ownerId: ctx.actor.id,
        kind: input.kind,
        name: input.name,
        color: input.kind === 'list' ? (input.color ?? 'blue') : null,
        parentId,
        sortKey: generateKeyBetween(await lastKey(db, ctx, parentId), null),
      })
      .returning()
    return view(r as Row)
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
}

export async function patchTaskList(
  db: DbOrTx,
  ctx: TaskListCtx,
  id: string,
  input: z.infer<typeof patchTaskListSchema>,
): Promise<TaskListView> {
  const cur = await loadOwn(db, ctx, id)
  if (!cur) throw AppError.notFound('清单不存在')
  const set: Partial<typeof taskLists.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = input.name
  if (input.color !== undefined) {
    if (cur.kind === 'folder')
      throw AppError.validation([{ path: 'color', message: '文件夹没有颜色' }])
    set.color = input.color
  }
  let parentId = cur.parentId
  if (input.parentId !== undefined) {
    if (cur.kind === 'folder' && input.parentId)
      throw AppError.validation([{ path: 'parentId', message: '文件夹不能再放进文件夹' }])
    if (input.parentId) await assertFolder(db, ctx, input.parentId)
    parentId = input.parentId
    set.parentId = parentId
  }
  if (input.after !== undefined || input.parentId !== undefined) {
    // 排序：放到同层 after 之后（null = 最前）；只换层不给 after = 放到该层最后
    const sameLayer = parentId ? eq(taskLists.parentId, parentId) : isNull(taskLists.parentId)
    const mine = and(
      eq(taskLists.ownerId, ctx.actor.id),
      eq(taskLists.workspaceId, ctx.workspaceId),
      sameLayer,
      sql`${taskLists.id} <> ${id}`,
    )
    if (input.after === undefined)
      set.sortKey = generateKeyBetween(await lastKey(db, ctx, parentId), null)
    else {
      const prev = input.after ? await loadOwn(db, ctx, input.after) : null
      if (input.after && !prev)
        throw AppError.validation([{ path: 'after', message: '清单不存在' }])
      const [next] = await db
        .select({ k: taskLists.sortKey })
        .from(taskLists)
        .where(prev ? and(mine, gt(taskLists.sortKey, prev.sortKey)) : mine)
        .orderBy(asc(taskLists.sortKey))
        .limit(1)
      set.sortKey = generateKeyBetween(prev?.sortKey ?? null, next?.k ?? null)
    }
  }
  try {
    const [r] = await db.update(taskLists).set(set).where(eq(taskLists.id, id)).returning()
    return view(r as Row)
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
}

/** 删清单：归类级联删除，任务不动；删文件夹：其下清单回到根（排在根的最后） */
export async function deleteTaskList(db: DbOrTx, ctx: TaskListCtx, id: string): Promise<void> {
  const cur = await loadOwn(db, ctx, id)
  if (!cur) throw AppError.notFound('清单不存在')
  if (cur.kind === 'folder') {
    const kids = await db
      .select({ id: taskLists.id })
      .from(taskLists)
      .where(eq(taskLists.parentId, id))
      .orderBy(asc(taskLists.sortKey))
    let key = await lastKey(db, ctx, null)
    for (const k of kids) {
      key = generateKeyBetween(key, null)
      await db.update(taskLists).set({ parentId: null, sortKey: key }).where(eq(taskLists.id, k.id))
    }
  }
  await db.delete(taskLists).where(eq(taskLists.id, id))
}

/**
 * 设置某任务在「本人」名下的清单（null = 移出清单）。调用方已校验任务可写 / 可读。
 * 只动本人那一行 `task_list_items`，不影响别人的归类（ADR-0044 §A.3）。
 */
export async function setTaskList(
  db: DbOrTx,
  ctx: TaskListCtx,
  taskId: string,
  listId: string | null,
): Promise<void> {
  if (listId) await assertOwnList(db, ctx, listId)
  await db
    .delete(taskListItems)
    .where(and(eq(taskListItems.taskId, taskId), eq(taskListItems.userId, ctx.actor.id)))
  if (listId) await db.insert(taskListItems).values({ taskId, userId: ctx.actor.id, listId })
}

/**
 * 本人名下「在某清单里」/「不在任何清单里」的任务条件（SQL 片段，用于列表 / 计数，可与 withTotal 共用）。
 * 给的是文件夹 id 时展开为其下各清单（ADR-0050：点文件夹 = 聚合看其下全部清单）；只认本人的文件夹。
 */
export const inOwnListSql = (actorId: string, listId: string) =>
  sql`exists (select 1 from ${taskListItems} tli where tli.task_id = ${tasks.id} and tli.user_id = ${actorId} and (tli.list_id = ${listId} or tli.list_id in (select tl.id from ${taskLists} tl where tl.parent_id = ${listId} and tl.owner_id = ${actorId})))`
export const notInOwnListSql = (actorId: string) =>
  sql`not exists (select 1 from ${taskListItems} tli where tli.task_id = ${tasks.id} and tli.user_id = ${actorId})`

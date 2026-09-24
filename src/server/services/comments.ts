/**
 * 评论（01 §3.9、02 §9、REQ-COMMENT-001 · 003 · 005 · 006 · 007）。
 * - 可读目标即可评论（含 guest viewer）；线程：未指定 → 首条评论 id 即 threadId；回复继承父评论的线程；编辑器锚定评论带 threadId。
 * - body_plain 与 mentions 在同一事务写入；事件 task.commented / entry.commented / mention.created 同事务 emit（不变量 1 · 3）。
 * - 软删保留占位（有回复时线程结构不塌）；解决 / 取消解决按线程整体标记，权限走 comment.resolve。
 */
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  createCommentSchema,
  listCommentsQuery,
  patchCommentSchema,
} from '../../shared/schemas/comments.ts'
import { type PmNode, pmMentionUserIds, pmToPlain } from '../../shared/schemas/pm.ts'
import { type Actor, assertCan, type CommentRef, can } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { member as memberTable, user as userTable } from '../db/schema/auth.ts'
import { comments, mentions } from '../db/schema/business.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'
import { emit } from './events.ts'
import { loadCommentRef, loadEntryRef, loadTaskRef } from './refs.ts'

export interface CommentCtx {
  actor: Actor
  workspaceId: string
}

type Row = typeof comments.$inferSelect
const SUMMARY_LEN = 100
const LEFT_MEMBER = '已离开的成员'

export interface CommentView {
  id: string
  targetType: 'task' | 'entry'
  targetId: string
  threadId: string
  parentId: string | null
  author: { id: string; displayName: string; image: string | null }
  /** 软删占位：bodyPm = null、deleted = true */
  bodyPm: unknown
  deleted: boolean
  orphaned: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

interface TargetInfo {
  kind: 'task' | 'entry'
  id: string
  title: string
  spaceSlug: string
  ref: CommentRef['target']
}

async function loadTarget(
  db: DbOrTx,
  ctx: CommentCtx,
  type: 'task' | 'entry',
  id: string,
): Promise<TargetInfo> {
  if (type === 'task') {
    const t = await loadTaskRef(db, ctx.actor, ctx.workspaceId, id)
    if (!t || !can(ctx.actor, 'task.read', t.ref)) throw AppError.notFound('任务不存在')
    return {
      kind: 'task',
      id,
      title: t.row.title,
      spaceSlug: t.space.row.slug,
      ref: { kind: 'task', ref: t.ref },
    }
  }
  const e = await loadEntryRef(db, ctx.actor, ctx.workspaceId, id)
  if (!e || !can(ctx.actor, 'entry.read', e.ref)) throw AppError.notFound('记录不存在')
  return {
    kind: 'entry',
    id,
    title: e.row.title,
    spaceSlug: e.space.row.slug,
    ref: { kind: 'entry', ref: e.ref },
  }
}

async function displayNames(db: DbOrTx, ctx: CommentCtx, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; image: string | null }>()
  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      displayName: userTable.displayName,
      image: userTable.image,
    })
    .from(memberTable)
    .innerJoin(userTable, eq(userTable.id, memberTable.userId))
    .where(and(eq(memberTable.organizationId, ctx.workspaceId), inArray(memberTable.userId, ids)))
  return new Map(rows.map((r) => [r.id, { name: r.displayName || r.name, image: r.image }]))
}

async function toViews(db: DbOrTx, ctx: CommentCtx, rows: Row[]): Promise<CommentView[]> {
  const names = await displayNames(db, ctx, [...new Set(rows.map((r) => r.authorId))])
  return rows.map((r) => {
    const n = names.get(r.authorId)
    const deleted = r.deletedAt !== null
    return {
      id: r.id,
      targetType: r.targetType as 'task' | 'entry',
      targetId: r.targetId,
      threadId: r.threadId,
      parentId: r.parentId,
      author: { id: r.authorId, displayName: n?.name ?? LEFT_MEMBER, image: n?.image ?? null },
      bodyPm: deleted ? null : r.bodyPm,
      deleted,
      orphaned: r.orphaned,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  })
}

/** GET /comments?targetType&targetId：按创建时间正序、游标分页；含软删占位（REQ-COMMENT-007）。 */
export async function listComments(
  db: DbOrTx,
  ctx: CommentCtx,
  q: z.infer<typeof listCommentsQuery>,
) {
  await loadTarget(db, ctx, q.targetType, q.targetId)
  const conds: SQL[] = [
    eq(comments.workspaceId, ctx.workspaceId),
    eq(comments.targetType, q.targetType),
    eq(comments.targetId, q.targetId),
  ]
  const c = decodeCursor(q.cursor, 2)
  if (q.cursor && !c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  if (c)
    conds.push(
      sql`(${comments.createdAt}, ${comments.id}) > (${String(c[0])}::timestamptz, ${String(c[1])}::uuid)`,
    )
  const rows = await db
    .select()
    .from(comments)
    .where(and(...conds))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  return {
    items: await toViews(db, ctx, page),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
  }
}

async function actorName(db: DbOrTx, id: string) {
  const [u] = await db
    .select({ name: userTable.name, displayName: userTable.displayName })
    .from(userTable)
    .where(eq(userTable.id, id))
  return u?.displayName || u?.name || ''
}

/**
 * 提及（REQ-COMMENT-006、T1-024）：写 mentions 行并为每个被提及者 emit mention.created；
 * 是否能读由扇出前 can(read) 过滤——无权者有 mentions 行但无通知。只对本次新增的用户发。
 */
async function recordMentions(
  tx: DbOrTx,
  ctx: CommentCtx,
  row: Row,
  target: TargetInfo,
  userIds: string[],
  summary: string,
) {
  const fresh = userIds.filter((u) => u !== ctx.actor.id)
  if (!fresh.length) return
  await tx.insert(mentions).values(fresh.map((userId) => ({ commentId: row.id, userId })))
  const name = await actorName(tx, ctx.actor.id)
  const url =
    target.kind === 'task'
      ? `/spaces/${target.spaceSlug}/tasks/${target.id}#c-${row.id}`
      : `/entries/${target.id}#c-${row.id}`
  for (const userId of fresh)
    await emit(tx, {
      kind: 'mention.created',
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      targetType: 'comment',
      targetId: row.id,
      visibilityScope: { userIds: [userId] },
      payload: {
        targetType: 'comment',
        targetId: row.id,
        title: target.title,
        commentId: row.id,
        actorId: ctx.actor.id,
        actorName: name,
        summary,
        url,
      },
    })
}

/** POST /comments（REQ-COMMENT-001 · 005 · 006）。 */
export async function createComment(
  db: Db,
  ctx: CommentCtx,
  input: z.infer<typeof createCommentSchema>,
): Promise<CommentView> {
  const target = await loadTarget(db, ctx, input.targetType, input.targetId)
  assertCan(ctx.actor, 'comment.create', target.ref.ref)
  let threadId = input.threadId
  if (input.parentId) {
    const [parent] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, input.parentId))
      .limit(1)
    if (!parent || parent.targetType !== input.targetType || parent.targetId !== input.targetId)
      throw AppError.validation([{ path: 'parentId', message: '父评论不在同一目标下' }])
    threadId = parent.threadId
  } else if (threadId) {
    // 已存在的线程须属同一目标（编辑器锚定的新线程由客户端生成 id，允许不存在）
    const [t] = await db
      .select({ targetId: comments.targetId })
      .from(comments)
      .where(eq(comments.threadId, threadId))
      .limit(1)
    if (t && t.targetId !== input.targetId)
      throw AppError.validation([{ path: 'threadId', message: '线程不在同一目标下' }])
  }
  const doc = input.bodyPm as PmNode
  const plain = pmToPlain(doc)
  if (!plain.trim() && !JSON.stringify(doc).includes('"mention"'))
    throw AppError.validation([{ path: 'bodyPm', message: '评论不能为空' }])
  const summary = plain.slice(0, SUMMARY_LEN)
  const id = crypto.randomUUID()
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(comments)
      .values({
        id,
        workspaceId: ctx.workspaceId,
        targetType: input.targetType,
        targetId: input.targetId,
        threadId: threadId ?? id,
        parentId: input.parentId ?? null,
        authorId: ctx.actor.id,
        bodyPm: input.bodyPm,
        bodyPlain: plain,
      })
      .returning()
    if (!r) throw new Error('insert comments failed')
    const base = {
      commentId: r.id,
      threadId: r.threadId,
      actorId: ctx.actor.id,
      actorName: await actorName(tx, ctx.actor.id),
      summary,
    }
    if (target.kind === 'task')
      await emit(tx, {
        kind: 'task.commented',
        workspaceId: ctx.workspaceId,
        actorId: ctx.actor.id,
        targetType: 'task',
        targetId: target.id,
        payload: { taskId: target.id, title: target.title, spaceSlug: target.spaceSlug, ...base },
      })
    else
      await emit(tx, {
        kind: 'entry.commented',
        workspaceId: ctx.workspaceId,
        actorId: ctx.actor.id,
        targetType: 'entry',
        targetId: target.id,
        payload: { entryId: target.id, title: target.title, ...base },
      })
    await recordMentions(tx, ctx, r, target, pmMentionUserIds(doc), summary)
    return r
  })
  const [v] = await toViews(db, ctx, [row])
  return v as CommentView
}

async function requireComment(db: DbOrTx, ctx: CommentCtx, id: string) {
  const c = await loadCommentRef(db, ctx.actor, ctx.workspaceId, id)
  const readable =
    c &&
    (c.ref.target.kind === 'task'
      ? can(ctx.actor, 'task.read', c.ref.target.ref)
      : can(ctx.actor, 'entry.read', c.ref.target.ref))
  if (!c || !readable) throw AppError.notFound('评论不存在')
  return c
}

/** PATCH /comments/:id：仅作者；已删除不可改；乐观锁；新增的提及才发通知。 */
export async function patchComment(
  db: Db,
  ctx: CommentCtx,
  id: string,
  input: z.infer<typeof patchCommentSchema>,
) {
  const c = await requireComment(db, ctx, id)
  if (c.row.authorId !== ctx.actor.id || c.row.deletedAt)
    throw AppError.forbidden('只能编辑自己的评论')
  if (c.row.updatedAt.toISOString() !== new Date(input.ifUpdatedAt).toISOString()) {
    const [cur] = await toViews(db, ctx, [c.row])
    throw new AppError(409, 'CONFLICT_STALE', '评论已被修改', { current: cur })
  }
  const doc = input.bodyPm as PmNode
  const plain = pmToPlain(doc)
  const target = await loadTarget(db, ctx, c.row.targetType as 'task' | 'entry', c.row.targetId)
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(comments)
      .set({ bodyPm: input.bodyPm, bodyPlain: plain, updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning()
    const had = new Set(
      (
        await tx.select({ u: mentions.userId }).from(mentions).where(eq(mentions.commentId, id))
      ).map((m) => m.u),
    )
    const added = pmMentionUserIds(doc).filter((u) => !had.has(u))
    if (r) await recordMentions(tx, ctx, r, target, added, plain.slice(0, SUMMARY_LEN))
    return r
  })
  const [v] = await toViews(db, ctx, [row as Row])
  return v as CommentView
}

/** DELETE /comments/:id：作者或 owner/admin；软删保留占位（REQ-COMMENT-007）。 */
export async function deleteComment(db: DbOrTx, ctx: CommentCtx, id: string): Promise<void> {
  const c = await requireComment(db, ctx, id)
  if (c.row.deletedAt) return
  if (c.row.authorId !== ctx.actor.id && !can(ctx.actor, 'workspace.manage', null))
    throw AppError.forbidden('只能删除自己的评论')
  await db
    .update(comments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(comments.id, id))
}

/** POST /comments/:id/resolve | unresolve（REQ-COMMENT-003）：整条线程一起标记。 */
export async function setResolved(db: DbOrTx, ctx: CommentCtx, id: string, resolved: boolean) {
  const c = await requireComment(db, ctx, id)
  // 以线程首条评论作为权限判定对象（其作者即「评论作者」）
  const root =
    c.row.threadId === c.row.id
      ? c
      : ((await loadCommentRef(db, ctx.actor, ctx.workspaceId, c.row.threadId)) ?? c)
  assertCan(ctx.actor, 'comment.resolve', root.ref)
  await db
    .update(comments)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: ctx.actor.id }
        : { resolvedAt: null, resolvedBy: null },
    )
    .where(and(eq(comments.workspaceId, ctx.workspaceId), eq(comments.threadId, c.row.threadId)))
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.threadId, c.row.threadId))
    .orderBy(asc(comments.createdAt))
  return { items: await toViews(db, ctx, rows), nextCursor: null }
}

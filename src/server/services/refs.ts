/**
 * 授权引用加载（authz 的入参，01 §5）：任务 / 记录 / 评论 / 附件目标。
 * 不做判定，只组装 Ref；调用方用 can()。对象不存在或不在本工作区 → null。
 */
import { and, eq } from 'drizzle-orm'
import type { Actor, AttachmentRef, CommentRef, TaskRef } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { attachments, comments, tasks } from '../db/schema/business.ts'
import { loadEntry, loadSpaceRef } from './entries.ts'

export async function loadTaskRef(db: DbOrTx, actor: Actor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)))
    .limit(1)
  if (!row) return null
  const sp = await loadSpaceRef(db, actor, row.spaceId)
  if (!sp) return null
  const ref: TaskRef = {
    id: row.id,
    creatorId: row.creatorId,
    assigneeId: row.assigneeId,
    deletedAt: row.deletedAt,
    space: sp.ref,
  }
  return { row, ref, space: sp }
}

export async function loadEntryRef(db: DbOrTx, actor: Actor, workspaceId: string, id: string) {
  const e = await loadEntry(db, actor, id)
  if (!e || e.row.workspaceId !== workspaceId) return null
  return e
}

/** 评论 → 其目标（任务 / 记录）的 Ref。软删评论仍返回（调用方决定）。 */
export async function loadCommentRef(db: DbOrTx, actor: Actor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.workspaceId, workspaceId)))
    .limit(1)
  if (!row) return null
  let target: CommentRef['target'] | null = null
  if (row.targetType === 'task') {
    const t = await loadTaskRef(db, actor, workspaceId, row.targetId)
    if (t) target = { kind: 'task', ref: t.ref }
  } else {
    const e = await loadEntryRef(db, actor, workspaceId, row.targetId)
    if (e) target = { kind: 'entry', ref: e.ref }
  }
  if (!target) return null
  const ref: CommentRef = { id: row.id, authorId: row.authorId, target }
  return { row, ref }
}

export async function loadAttachmentRef(db: DbOrTx, actor: Actor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.workspaceId, workspaceId)))
    .limit(1)
  if (!row) return null
  let target: AttachmentRef['target'] = null
  if (row.targetType && row.targetId) {
    if (row.targetType === 'user') target = { kind: 'user', userId: row.targetId }
    else if (row.targetType === 'task') {
      const t = await loadTaskRef(db, actor, workspaceId, row.targetId)
      if (!t) return null
      target = { kind: 'task', ref: t.ref }
    } else if (row.targetType === 'entry') {
      const e = await loadEntryRef(db, actor, workspaceId, row.targetId)
      if (!e) return null
      target = { kind: 'entry', ref: e.ref }
    } else {
      const c = await loadCommentRef(db, actor, workspaceId, row.targetId)
      if (!c) return null
      target = { kind: 'comment', ref: c.ref }
    }
  }
  const ref: AttachmentRef = { id: row.id, ownerId: row.ownerId, target }
  return { row, ref }
}

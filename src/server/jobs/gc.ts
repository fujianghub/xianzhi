/**
 * 数据生命周期作业（07 §3）：全部幂等、单次上限 1000 行；由 jobs/index.ts 注册与调度。
 */
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { gcSnapshots } from '../../collab/snapshots.ts'
import type { Db } from '../db/index.ts'
import {
  attachments,
  comments,
  entries,
  events,
  idempotencyKeys,
  notificationDeliveries,
  notifications,
  spaces,
  tasks,
} from '../db/schema/business.ts'
import { dataPath, removeOlderThan, removeQuietly } from '../lib/files.ts'
import { writeEntryDerived } from '../services/derived.ts'

export const BATCH = 1000
const DAY = 86_400_000
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms)

export interface GcDeps {
  db: Db
  dataDir: string
  now?: Date
}

async function deleteAttachmentsRows(
  deps: GcDeps,
  rows: { id: string; storageKey: string; variants: unknown }[],
): Promise<void> {
  if (!rows.length) return
  for (const r of rows) {
    await removeQuietly(dataPath(deps.dataDir, r.storageKey))
    for (const v of Object.values((r.variants ?? {}) as Record<string, string>))
      if (typeof v === 'string') await removeQuietly(dataPath(deps.dataDir, v))
  }
  await deps.db.delete(attachments).where(
    inArray(
      attachments.id,
      rows.map((r) => r.id),
    ),
  )
}

/** 软删 30 天后硬删（space / task / entry / comment）+ 其附件文件（01 §1）。 */
export async function gcSoftDeleted(deps: GcDeps): Promise<Record<string, number>> {
  const cutoff = ago(deps.now ?? new Date(), 30 * DAY)
  const out: Record<string, number> = {}
  const pick = async (table: typeof entries | typeof tasks | typeof comments | typeof spaces) =>
    (
      await deps.db
        .select({ id: table.id })
        .from(table)
        .where(and(isNotNull(table.deletedAt), lt(table.deletedAt, cutoff)))
        .limit(BATCH)
    ).map((r) => r.id)

  const commentIds = await pick(comments)
  if (commentIds.length) {
    await deleteAttachmentsRows(
      deps,
      await deps.db
        .select()
        .from(attachments)
        .where(
          and(
            sql`${attachments.targetType} = 'comment'`,
            inArray(attachments.targetId, commentIds),
          ),
        ),
    )
    await deps.db.delete(comments).where(inArray(comments.id, commentIds))
  }
  out.comments = commentIds.length

  const entryIds = await pick(entries)
  if (entryIds.length) {
    await deleteAttachmentsRows(
      deps,
      await deps.db
        .select()
        .from(attachments)
        .where(
          and(sql`${attachments.targetType} = 'entry'`, inArray(attachments.targetId, entryIds)),
        ),
    )
    await deps.db
      .delete(comments)
      .where(and(sql`${comments.targetType} = 'entry'`, inArray(comments.targetId, entryIds)))
    await deps.db.delete(entries).where(inArray(entries.id, entryIds))
  }
  out.entries = entryIds.length

  const taskIds = await pick(tasks)
  await purgeTasks(deps, taskIds)
  out.tasks = taskIds.length

  // 空间：软删空间下的任务 / 记录本身没有 deleted_at（随空间一起不可见），到期时整体清除。
  // 注（2026-09-24，T1-001）：旧逻辑「其下仍有任务 / 记录就跳过」会让软删空间永远不被清除。
  const spaceIds = await pick(spaces)
  for (const id of spaceIds) await purgeSpace(deps, id)
  out.spaces = spaceIds.length
  return out
}

/**
 * 硬删一批任务：附件（含其评论的附件）行与文件、评论、子任务断开父引用；watchers / task_tags 经 FK 级联。
 * 用于 `DELETE /tasks/:id?permanent=1`（REQ-TASK-013）与软删 30 天到期清理。
 */
export async function purgeTasks(deps: GcDeps, taskIds: string[]): Promise<void> {
  if (!taskIds.length) return
  const commentIds = (
    await deps.db
      .select({ id: comments.id })
      .from(comments)
      .where(and(sql`${comments.targetType} = 'task'`, inArray(comments.targetId, taskIds)))
  ).map((r) => r.id)
  await deleteAttachmentsRows(
    deps,
    await deps.db
      .select()
      .from(attachments)
      .where(
        or(
          and(sql`${attachments.targetType} = 'task'`, inArray(attachments.targetId, taskIds)),
          commentIds.length
            ? and(
                sql`${attachments.targetType} = 'comment'`,
                inArray(attachments.targetId, commentIds),
              )
            : undefined,
        ),
      ),
  )
  await deps.db.transaction(async (tx) => {
    if (commentIds.length) await tx.delete(comments).where(inArray(comments.id, commentIds))
    await tx.update(tasks).set({ parentId: null }).where(inArray(tasks.parentId, taskIds))
    await tx.delete(tasks).where(inArray(tasks.id, taskIds))
  })
}

/**
 * 硬删一个空间及其全部内容（任务、记录、评论、附件行与文件、快照 / 标签等经 FK 级联）。
 * 用于 `DELETE /spaces/:id?permanent=1`（REQ-SPACE-007）与软删 30 天到期清理。附件文件先删、行在事务里删。
 */
export async function purgeSpace(
  deps: GcDeps,
  spaceId: string,
): Promise<{ tasks: number; entries: number; comments: number }> {
  const entryIds = (
    await deps.db.select({ id: entries.id }).from(entries).where(eq(entries.spaceId, spaceId))
  ).map((r) => r.id)
  const taskIds = (
    await deps.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.spaceId, spaceId))
  ).map((r) => r.id)
  const onTargets = (
    col: typeof comments.targetType | typeof attachments.targetType,
    idCol: typeof comments.targetId | typeof attachments.targetId,
  ) =>
    or(
      entryIds.length ? and(sql`${col} = 'entry'`, inArray(idCol, entryIds)) : undefined,
      taskIds.length ? and(sql`${col} = 'task'`, inArray(idCol, taskIds)) : undefined,
    )
  const commentIds =
    entryIds.length || taskIds.length
      ? (
          await deps.db
            .select({ id: comments.id })
            .from(comments)
            .where(onTargets(comments.targetType, comments.targetId))
        ).map((r) => r.id)
      : []
  const attachmentRows =
    entryIds.length || taskIds.length || commentIds.length
      ? await deps.db
          .select()
          .from(attachments)
          .where(
            or(
              onTargets(attachments.targetType, attachments.targetId),
              commentIds.length
                ? and(
                    sql`${attachments.targetType} = 'comment'`,
                    inArray(attachments.targetId, commentIds),
                  )
                : undefined,
            ),
          )
      : []
  await deleteAttachmentsRows(deps, attachmentRows)
  await deps.db.transaction(async (tx) => {
    if (commentIds.length) await tx.delete(comments).where(inArray(comments.id, commentIds))
    if (entryIds.length) await tx.delete(entries).where(inArray(entries.id, entryIds))
    if (taskIds.length) {
      await tx.update(tasks).set({ parentId: null }).where(inArray(tasks.id, taskIds))
      await tx.delete(tasks).where(inArray(tasks.id, taskIds))
    }
    await tx.delete(spaces).where(eq(spaces.id, spaceId))
  })
  return { tasks: taskIds.length, entries: entryIds.length, comments: commentIds.length }
}

export async function gcIdempotency(deps: GcDeps): Promise<number> {
  const r = await deps.db.execute<{ key: string }>(
    sql`delete from ${idempotencyKeys} where key in (select key from ${idempotencyKeys} where created_at < ${ago(deps.now ?? new Date(), DAY)} limit ${BATCH}) returning key`,
  )
  return r.rows.length
}

/** 无归属附件 7 天后删除（行 + 文件）。 */
export async function gcAttachments(deps: GcDeps): Promise<number> {
  const rows = await deps.db
    .select()
    .from(attachments)
    .where(
      and(
        isNull(attachments.targetType),
        lt(attachments.createdAt, ago(deps.now ?? new Date(), 7 * DAY)),
      ),
    )
    .limit(BATCH)
  await deleteAttachmentsRows(deps, rows)
  return rows.length
}

export async function gcSnapshotsJob(deps: GcDeps): Promise<number> {
  return gcSnapshots(deps.db, deps.now)
}

/**
 * 已处理事件 180 天后删除（07 §3）。notifications.event_id 级联删除，
 * 仍被通知引用的事件跳过——否则会连带删掉「未读永久保留」的通知；通知按 gc.notifications 生命周期先走。
 */
export async function gcEvents(deps: GcDeps): Promise<number> {
  const r = await deps.db.execute<{ id: string }>(sql`
    delete from ${events} where id in (
      select e.id from ${events} e
      where e.processed_at is not null and e.created_at < ${ago(deps.now ?? new Date(), 180 * DAY)}
        and not exists (select 1 from ${notifications} n where n.event_id = e.id)
      limit ${BATCH}) returning id`)
  return r.rows.length
}

/** 已读 90 天归档；归档 1 年删除（07 §3）。 */
export async function gcNotifications(
  deps: GcDeps,
): Promise<{ archived: number; deleted: number }> {
  const now = deps.now ?? new Date()
  const a = await deps.db.execute<{ id: string }>(sql`
    update ${notifications} set archived_at = ${now}
    where id in (select id from ${notifications} where read_at is not null and read_at < ${ago(now, 90 * DAY)} and archived_at is null limit ${BATCH})
    returning id`)
  const d = await deps.db.execute<{ id: string }>(sql`
    delete from ${notifications} where id in (select id from ${notifications} where archived_at is not null and archived_at < ${ago(now, 365 * DAY)} limit ${BATCH})
    returning id`)
  return { archived: a.rows.length, deleted: d.rows.length }
}

export async function gcDeliveries(deps: GcDeps): Promise<number> {
  const r = await deps.db.execute<{ id: string }>(
    sql`delete from ${notificationDeliveries} where id in (select id from ${notificationDeliveries} where created_at < ${ago(deps.now ?? new Date(), 30 * DAY)} limit ${BATCH}) returning id`,
  )
  return r.rows.length
}

/** 导出产物 7 天后删除（data/exports/）。 */
export async function gcExports(deps: GcDeps): Promise<number> {
  return removeOlderThan(dataPath(deps.dataDir, 'exports'), ago(deps.now ?? new Date(), 7 * DAY))
}

/** derived_error 非空的记录重试派生（03 §4.2）。 */
export async function deriveRetry(deps: GcDeps): Promise<{ ok: number; failed: number }> {
  const rows = await deps.db
    .select({ id: entries.id, ydoc: entries.ydoc })
    .from(entries)
    .where(isNotNull(entries.derivedError))
    .limit(BATCH)
  let ok = 0
  let failed = 0
  for (const r of rows) {
    try {
      await writeEntryDerived(deps.db, r.id, r.ydoc)
      ok++
    } catch (err) {
      failed++
      await deps.db
        .update(entries)
        .set({ derivedError: String(err instanceof Error ? err.message : err).slice(0, 500) })
        .where(eq(entries.id, r.id))
    }
  }
  return { ok, failed }
}

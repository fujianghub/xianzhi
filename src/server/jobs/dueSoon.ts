/**
 * task.due_soon（01 §4、REQ-TASK-010）：每 15 分钟扫描「24 小时内到期、未完成、有指派人、未软删」的任务，
 * 每个 (任务, 截止时刻) 只发一次——同一截止时刻再跑不重复；改期后截止时刻变化，到新截止前 24h 再发一次。
 * 规范原文「同 task 每 24h 最多一条」与「改期后重新计算」在「24h 内连续改期」时冲突，以后者为准（01 §4 注 2026-09-24）。
 */
import { and, eq, gt, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { events, spaces, tasks } from '../db/schema/business.ts'
import { emit } from '../services/events.ts'

export const DUE_SOON_WINDOW_MS = 24 * 3_600_000
const BATCH = 500

export async function runDueSoon(db: Db, now = new Date()): Promise<{ emitted: number }> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      workspaceId: tasks.workspaceId,
      spaceId: tasks.spaceId,
      spaceSlug: spaces.slug,
      assigneeId: tasks.assigneeId,
      dueAt: tasks.dueAt,
    })
    .from(tasks)
    .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
    .where(
      and(
        isNull(tasks.deletedAt),
        isNull(spaces.deletedAt),
        isNotNull(tasks.assigneeId),
        notInArray(tasks.status, ['done', 'cancelled']),
        gt(tasks.dueAt, now),
        lte(tasks.dueAt, new Date(now.getTime() + DUE_SOON_WINDOW_MS)),
        // 同一 (任务, 截止时刻) 已发过则跳过
        sql`not exists (select 1 from ${events} e where e.kind = 'task.due_soon' and e.target_id = ${tasks.id} and e.payload ->> 'dueAt' = to_char(${tasks.dueAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
      ),
    )
    .limit(BATCH)
  let emitted = 0
  for (const r of rows) {
    if (!r.assigneeId || !r.dueAt) continue
    await emit(db, {
      kind: 'task.due_soon',
      workspaceId: r.workspaceId,
      actorId: null,
      targetType: 'task',
      targetId: r.id,
      visibilityScope: { spaceId: r.spaceId, userIds: [r.assigneeId] },
      payload: {
        taskId: r.id,
        title: r.title,
        assigneeId: r.assigneeId,
        spaceSlug: r.spaceSlug,
        dueAt: r.dueAt.toISOString(),
        hoursLeft: Math.max(1, Math.ceil((r.dueAt.getTime() - now.getTime()) / 3_600_000)),
      },
    })
    emitted++
  }
  return { emitted }
}

/** 任务页按截止日分组（ADR-0043、REQ-TASK-027）：纯函数，用户时区，与今日页同口径（逾期 = 截止早于今天 00:00）。 */
import { addDays, localDateOf, zonedMidnight } from '../../shared/tz.ts'
import type { Task } from './task-queries.ts'

export const TASK_GROUPS = ['overdue', 'today', 'tomorrow', 'week', 'later', 'noDate'] as const
type Group = (typeof TASK_GROUPS)[number]

/** 截止日 → 分组（用户时区；与今日页同口径） */
export function groupTasks<T extends Pick<Task, 'dueAt' | 'priority' | 'sortKey'>>(
  tasks: T[],
  tz: string,
  now: Date,
): Map<Group, T[]> {
  const today = localDateOf(tz, now)
  const edge = (days: number) => zonedMidnight(tz, addDays(today, days)).getTime()
  const [t0, t1, t2, t8] = [edge(0), edge(1), edge(2), edge(8)]
  const out = new Map<Group, T[]>(TASK_GROUPS.map((g) => [g, []]))
  for (const x of tasks) {
    const at = x.dueAt ? new Date(x.dueAt).getTime() : null
    const g: Group =
      at === null
        ? 'noDate'
        : at < t0
          ? 'overdue'
          : at < t1
            ? 'today'
            : at < t2
              ? 'tomorrow'
              : at < t8
                ? 'week'
                : 'later'
    out.get(g)?.push(x)
  }
  // 组内：截止早的在前，同一时刻优先级高的在前；无日期组按优先级
  for (const l of out.values())
    l.sort(
      (a, b) =>
        (a.dueAt ?? '').localeCompare(b.dueAt ?? '') ||
        b.priority - a.priority ||
        (a.sortKey < b.sortKey ? -1 : 1),
    )
  return out
}

/** 截止日期胶囊的色调（ADR-0044）：逾期 / 今天 / 明天 / 7 天内 / 更晚，按用户时区 */
export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'
export function dueTone(dueAt: string, tz: string, now = new Date()): DueTone {
  const today = localDateOf(tz, now)
  const edge = (days: number) => zonedMidnight(tz, addDays(today, days)).getTime()
  const at = new Date(dueAt).getTime()
  if (at < edge(0)) return 'overdue'
  if (at < edge(1)) return 'today'
  if (at < edge(2)) return 'tomorrow'
  if (at < edge(8)) return 'week'
  return 'later'
}

/** 按优先级分组（ADR-0044 显示选项）：紧急 → 无；组内截止早的在前 */
export const PRIORITY_GROUPS = ['p4', 'p3', 'p2', 'p1', 'p0'] as const
export function groupByPriority<T extends Pick<Task, 'dueAt' | 'priority' | 'sortKey'>>(
  tasks: T[],
): Map<(typeof PRIORITY_GROUPS)[number], T[]> {
  const out = new Map(PRIORITY_GROUPS.map((g) => [g, [] as T[]]))
  for (const x of tasks) out.get(`p${Math.min(4, Math.max(0, x.priority))}` as never)?.push(x)
  for (const l of out.values())
    l.sort(
      (a, b) =>
        (a.dueAt ?? '\uffff').localeCompare(b.dueAt ?? '\uffff') ||
        (a.sortKey < b.sortKey ? -1 : 1),
    )
  return out
}

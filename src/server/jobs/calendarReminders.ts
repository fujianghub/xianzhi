/**
 * calendar.reminder（ADR-0009、REQ-CAL-008）：每分钟扫描，触发时刻 = 发生开始 − 提前量，
 * 落在 (now − LOOKBACK, now] 内即 emit；每 (日程, 发生时刻, 提前量) 只发一次（按 events 去重，连跑幂等）。
 * 错过窗口（worker 停机超过 LOOKBACK）不补发，避免重启后一次性涌出旧提醒。
 */
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { formatLocalDate, localDateOf } from '../../shared/tz.ts'
import type { Db } from '../db/index.ts'
import { calendarEvents, events } from '../db/schema/business.ts'
import { occurrencesBetween } from '../services/calendar-recur.ts'
import { emit } from '../services/events.ts'

export const LOOKBACK_MS = 5 * 60_000
/** alarms 取值范围（schemas/calendar.ts）：-1440 … 10080 分钟 */
const MAX_BEFORE_MS = 10_080 * 60_000
const MAX_AFTER_MS = 1440 * 60_000

export async function runCalendarReminders(db: Db, now = new Date()): Promise<{ emitted: number }> {
  const winLo = new Date(now.getTime() - LOOKBACK_MS)
  // 发生开始可能落在 [winLo − 1 天, now + 7 天]（负提前量 = 开始后触发）
  const from = new Date(winLo.getTime() - MAX_AFTER_MS)
  const to = new Date(now.getTime() + MAX_BEFORE_MS + 1)
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        isNull(calendarEvents.deletedAt),
        sql`cardinality(${calendarEvents.alarms}) > 0`,
        lt(calendarEvents.startAt, to),
        or(
          and(isNull(calendarEvents.rrule), gt(calendarEvents.startAt, from)),
          and(
            isNotNull(calendarEvents.rrule),
            or(isNull(calendarEvents.repeatUntil), gt(calendarEvents.repeatUntil, from)),
          ),
        ),
      ),
    )
  let emitted = 0
  for (const r of rows) {
    let starts: Date[]
    try {
      starts = r.rrule
        ? occurrencesBetween(
            {
              ...r,
              rrule: r.rrule,
              exdates: ((r.exdates as unknown[]) ?? []).map((x) => new Date(x as string)),
            },
            from,
            to,
          ).filter((s) => s >= from)
        : [r.startAt]
    } catch {
      continue
    }
    for (const start of starts) {
      for (const alarm of r.alarms ?? []) {
        const fireAt = start.getTime() - alarm * 60_000
        if (fireAt <= winLo.getTime() || fireAt > now.getTime()) continue
        const occurrenceStart = start.toISOString()
        const [dup] = await db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.kind, 'calendar.reminder'),
              eq(events.targetId, r.id),
              sql`${events.payload} ->> 'occurrenceStart' = ${occurrenceStart}`,
              sql`(${events.payload} ->> 'alarm')::int = ${alarm}`,
            ),
          )
          .limit(1)
        if (dup) continue
        await emit(db, {
          kind: 'calendar.reminder',
          workspaceId: r.workspaceId,
          actorId: null,
          targetType: 'calendar_event',
          targetId: r.id,
          visibilityScope: { userIds: [r.ownerId] },
          payload: {
            eventId: r.id,
            ownerId: r.ownerId,
            title: r.title,
            ...(r.location ? { location: r.location } : {}),
            allDay: r.allDay,
            occurrenceStart,
            alarm,
            date: formatLocalDate(localDateOf(r.timezone, start)),
          },
        })
        emitted++
      }
    }
  }
  return { emitted }
}

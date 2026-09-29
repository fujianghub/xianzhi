/**
 * Bug 统计（ADR-0033、REQ-BUG-007）：`GET /entries/bug-stats`。
 * 与列表同口径的条件（kind 强制 bug）取出 status / priority / foundAt / resolvedAt，按操作者时区与周起始日分桶在服务端计算；
 * 重开次数来自 entry_field_changes。存量按当前 foundAt / resolvedAt 倒推（近似：重开会清 resolvedAt、删除 / 归档不计）。
 */
import { and, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { bugStatsQuery } from '../../shared/schemas/entries.ts'
import { BUG_CLOSED_STATUSES, BUG_PRIORITIES } from '../../shared/schemas/entryFields.ts'
import {
  addDays,
  addMonths,
  dayOfWeek,
  formatLocalDate,
  type LocalDate,
  localDateOf,
  parseLocalDate,
  zonedMidnight,
} from '../../shared/tz.ts'
import type { Db } from '../db/index.ts'
import { entries, entryFieldChanges } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { timezoneOf } from './bug-fields.ts'
import { type EntryCtx, entryListConds } from './entries.ts'

export const MAX_BUCKETS = 104
const DAY = 86_400_000
const AGING = [
  { key: '0-7', max: 7 },
  { key: '8-30', max: 30 },
  { key: '31-90', max: 90 },
  { key: '90+', max: Number.POSITIVE_INFINITY },
] as const

export interface BugStats {
  from: string
  to: string
  bucket: 'week' | 'month'
  summary: { total: number; open: number; p0Open: number; closedInRange: number; reopened: number }
  /** 每桶：起始日、新增（按发现日期）、关闭（按解决日期）、期末未关闭存量 */
  trend: { start: string; created: number; resolved: number; open: number }[]
  /** 区间内已修复（fixed）的修复天数（解决 − 发现），按优先级 */
  mttr: { priority: string; n: number; avgDays: number; medianDays: number }[]
  /** 未关闭按账龄（今天 − 发现日期） */
  aging: { key: string; n: number }[]
}

const dayNum = (s: string) => {
  const d = parseLocalDate(s)
  return d ? Date.UTC(d.y, d.m - 1, d.d) / DAY : Number.NaN
}
const round1 = (n: number) => Math.round(n * 10) / 10

export async function bugStats(
  db: Db,
  ctx: EntryCtx & { weekStartsOn?: number },
  q: z.infer<typeof bugStatsQuery>,
): Promise<BugStats> {
  const tz = await timezoneOf(db, ctx.actor.id, ctx.timezone)
  const today = localDateOf(tz, new Date())
  const to = q.to ? (parseLocalDate(q.to) as LocalDate) : today
  const from = q.from ? (parseLocalDate(q.from) as LocalDate) : addDays(to, -7 * 12 + 1)
  // 分桶起点对齐：周 = 周起始日；月 = 1 号
  const wso = ctx.weekStartsOn ?? 1
  const first =
    q.bucket === 'month'
      ? { y: from.y, m: from.m, d: 1 }
      : addDays(from, -((dayOfWeek(from) - wso + 7) % 7))
  const next = (d: LocalDate) => (q.bucket === 'month' ? addMonths(d, 1) : addDays(d, 7))
  const starts: LocalDate[] = []
  for (let d = first; formatLocalDate(d) <= formatLocalDate(to); d = next(d)) {
    starts.push(d)
    if (starts.length > MAX_BUCKETS)
      throw AppError.validation([{ path: 'from', message: `区间最多 ${MAX_BUCKETS} 个统计桶` }])
  }

  const conds = await entryListConds(db, ctx, { ...q, kind: ['bug'] })
  const rows = await db
    .select({
      status: sql<string | null>`${entries.fields} ->> 'status'`,
      priority: sql<string | null>`${entries.fields} ->> 'priority'`,
      foundAt: sql<string | null>`${entries.fields} ->> 'foundAt'`,
      resolvedAt: sql<string | null>`${entries.fields} ->> 'resolvedAt'`,
    })
    .from(entries)
    .where(and(...conds))

  const fromS = formatLocalDate(from)
  const toS = formatLocalDate(to)
  const todayN = dayNum(formatLocalDate(today))
  const closed = (s: string | null) => BUG_CLOSED_STATUSES.includes(String(s))
  const trend = starts.map((s, i) => {
    const lo = formatLocalDate(s)
    // 桶终点（不含）：下一桶起点，最后一桶截到 to 的次日
    const hiDate = i === starts.length - 1 ? addDays(to, 1) : next(s)
    const hi = formatLocalDate(hiDate)
    let created = 0
    let resolved = 0
    let open = 0
    for (const r of rows) {
      if (r.foundAt && r.foundAt >= lo && r.foundAt < hi) created++
      if (r.resolvedAt && closed(r.status) && r.resolvedAt >= lo && r.resolvedAt < hi) resolved++
      if (r.foundAt && r.foundAt < hi && !(closed(r.status) && r.resolvedAt && r.resolvedAt < hi))
        open++
    }
    return { start: lo, created, resolved, open }
  })

  const mttr = BUG_PRIORITIES.map((priority) => {
    const days = rows
      .filter(
        (r) =>
          r.status === 'fixed' &&
          (r.priority ?? 'p2') === priority &&
          r.foundAt &&
          r.resolvedAt &&
          r.resolvedAt >= fromS &&
          r.resolvedAt <= toS,
      )
      .map((r) => dayNum(String(r.resolvedAt)) - dayNum(String(r.foundAt)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
    const n = days.length
    const mid = Math.floor(n / 2)
    return {
      priority,
      n,
      avgDays: n ? round1(days.reduce((a, x) => a + x, 0) / n) : 0,
      medianDays: n
        ? n % 2
          ? (days[mid] ?? 0)
          : round1(((days[mid - 1] ?? 0) + (days[mid] ?? 0)) / 2)
        : 0,
    }
  })

  const openRows = rows.filter((r) => !closed(r.status))
  const aging = AGING.map((b, i) => {
    const min = i === 0 ? 0 : (AGING[i - 1]?.max ?? 0) + 1
    return {
      key: b.key,
      n: openRows.filter((r) => {
        const age = r.foundAt ? todayN - dayNum(r.foundAt) : 0
        return age >= min && age <= b.max
      }).length,
    }
  })

  // 重开：区间内 已关闭 → 未关闭 的状态变化，只算当前匹配（仍为 bug）的记录
  const reopened = rows.length
    ? ((
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(entryFieldChanges)
          .where(
            and(
              inArray(
                entryFieldChanges.entryId,
                db
                  .select({ id: entries.id })
                  .from(entries)
                  .where(and(...conds)),
              ),
              sql`${entryFieldChanges.field} = 'status'`,
              inArray(entryFieldChanges.fromValue, [...BUG_CLOSED_STATUSES]),
              sql`${entryFieldChanges.toValue} in ('new', 'pending')`,
              sql`${entryFieldChanges.createdAt} >= ${zonedMidnight(tz, from).toISOString()}::timestamptz`,
              sql`${entryFieldChanges.createdAt} < ${zonedMidnight(tz, addDays(to, 1)).toISOString()}::timestamptz`,
            ),
          )
      )[0]?.n ?? 0)
    : 0

  return {
    from: fromS,
    to: toS,
    bucket: q.bucket,
    summary: {
      total: rows.length,
      open: openRows.length,
      p0Open: openRows.filter((r) => r.priority === 'p0').length,
      closedInRange: rows.filter(
        (r) => closed(r.status) && r.resolvedAt && r.resolvedAt >= fromS && r.resolvedAt <= toS,
      ).length,
      reopened,
    },
    trend,
    mttr,
    aging,
  }
}

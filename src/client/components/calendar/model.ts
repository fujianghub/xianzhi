/**
 * 日历前端模型（ADR-0009）：日程与任务统一成 CalItem；按用户时区切日、分栏、RRULE 预设与中文描述。
 */
import type { PaletteColor } from '../../../shared/schemas/enums.ts'
import {
  addDays,
  dayOfWeek,
  formatLocalDate,
  type LocalDate,
  localDateOf,
  localDateTimeOf,
  parseLocalDate,
  zonedMidnight,
} from '../../../shared/tz.ts'
import type { CalendarOccurrence, CalendarView } from '../../lib/calendar-queries.ts'
import type { Task } from '../../lib/task-queries.ts'

export type PaletteName = PaletteColor

export interface CalItem {
  key: string
  source: 'event' | 'task'
  title: string
  color: PaletteName
  allDay: boolean
  start: Date
  end: Date
  /** 覆盖的本地日期（含首尾，YYYY-MM-DD） */
  startDay: string
  endDay: string
  occ?: CalendarOccurrence
  task?: Task
  done?: boolean
}

export const MIN_PER_DAY = 1440
export const SNAP = 15

export const dayKey = formatLocalDate
export const keyToDate = (k: string) => parseLocalDate(k) as LocalDate

export function eventToItem(
  o: CalendarOccurrence,
  tz: string,
  cals: Map<string, CalendarView>,
): CalItem {
  const start = new Date(o.startAt)
  const end = new Date(o.endAt)
  let sd: LocalDate
  let ed: LocalDate
  if (o.allDay) {
    // 全天：按事件自身时区取日期，避免跨时区查看时漂一天
    sd = localDateOf(o.timezone, start)
    ed = addDays(localDateOf(o.timezone, end), -1)
    if (dayKey(ed) < dayKey(sd)) ed = sd
  } else {
    sd = localDateOf(tz, start)
    ed = localDateOf(tz, new Date(end.getTime() - 1))
  }
  return {
    key: o.key,
    source: 'event',
    title: o.title,
    color: (cals.get(o.calendarId)?.color ?? 'blue') as PaletteName,
    allDay: o.allDay,
    start,
    end,
    startDay: dayKey(sd),
    endDay: dayKey(ed),
    occ: o,
  }
}

const TASK_BLOCK_MIN = 30

export function taskToItem(
  t: Task,
  tz: string,
  spaceColor: string | null | undefined,
): CalItem | null {
  const iso = t.dueAt ?? t.scheduledAt
  if (!iso) return null
  const start = new Date(iso)
  const { date, minutes } = localDateTimeOf(tz, start)
  const allDay = minutes === 0 || minutes === 23 * 60 + 59
  const k = dayKey(date)
  return {
    key: `task:${t.id}`,
    source: 'task',
    title: t.title,
    color: ((spaceColor as PaletteName | null) ?? 'gray') as PaletteName,
    allDay,
    start: allDay ? zonedMidnight(tz, date) : start,
    end: allDay
      ? zonedMidnight(tz, addDays(date, 1))
      : new Date(start.getTime() + TASK_BLOCK_MIN * 60_000),
    startDay: k,
    endDay: k,
    task: t,
    done: t.status === 'done' || t.status === 'cancelled',
  }
}

export const covers = (it: CalItem, k: string) => it.startDay <= k && it.endDay >= k

/** 月格 / 全天行排序：多日优先、全天优先，再按开始时刻 */
export function sortItems(a: CalItem, b: CalItem): number {
  const spanA = a.startDay !== a.endDay ? 1 : 0
  const spanB = b.startDay !== b.endDay ? 1 : 0
  return (
    spanB - spanA ||
    Number(b.allDay) - Number(a.allDay) ||
    a.start.getTime() - b.start.getTime() ||
    a.title.localeCompare(b.title)
  )
}

/** 定时项在某日的 [开始分钟, 结束分钟)（跨日截断到当日）。 */
export function segmentOf(it: CalItem, k: string, tz: string): { from: number; to: number } {
  const from = it.startDay === k ? localDateTimeOf(tz, it.start).minutes : 0
  const endLocal = localDateTimeOf(tz, it.end)
  const to =
    it.endDay === k
      ? dayKey(endLocal.date) === k
        ? Math.max(endLocal.minutes, from + SNAP)
        : MIN_PER_DAY
      : MIN_PER_DAY
  return { from, to: Math.min(MIN_PER_DAY, Math.max(to, from + SNAP)) }
}

/** 时间轴分栏：重叠成簇，簇内平分列宽。 */
export function layoutLanes(
  segs: { from: number; to: number }[],
): { lane: number; lanes: number }[] {
  const order = segs
    .map((_, i) => i)
    .sort((a, b) => {
      const sa = segs[a] as { from: number; to: number }
      const sb = segs[b] as { from: number; to: number }
      return sa.from - sb.from || sb.to - sa.to
    })
  const out = segs.map(() => ({ lane: 0, lanes: 1 }))
  let cluster: number[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const i of cluster) (out[i] as { lanes: number }).lanes = laneEnds.length
    cluster = []
    laneEnds = []
  }
  for (const i of order) {
    const s = segs[i] as { from: number; to: number }
    if (s.from >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= s.from)
    if (lane < 0) lane = laneEnds.push(0) - 1
    laneEnds[lane] = s.to
    ;(out[i] as { lane: number }).lane = lane
    cluster.push(i)
    clusterEnd = Math.max(clusterEnd, s.to)
  }
  flush()
  return out
}

export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** 本地日期 + 分钟 → 真实时刻 */
export const at = (tz: string, d: LocalDate, minutes: number) =>
  new Date(zonedMidnight(tz, d).getTime() + minutes * 60_000)

export const snap = (m: number) => Math.round(m / SNAP) * SNAP

// ---------------------------------------------------------------- 重复规则

export const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface Repeat {
  freq: Freq
  interval: number
  /** WEEKLY：0=周日 … 6=周六 */
  byDay: number[]
  end: { kind: 'never' } | { kind: 'until'; date: string } | { kind: 'count'; count: number }
}

export function parseRepeat(rrule: string | null | undefined): Repeat | null {
  if (!rrule) return null
  const kv = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((p) => p.split('=') as [string, string]),
  )
  const freq = kv.FREQ as Freq
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const byDay = (kv.BYDAY ?? '')
    .split(',')
    .filter(Boolean)
    .map((d: string) => BYDAY.indexOf(d.slice(-2) as (typeof BYDAY)[number]))
    .filter((i: number) => i >= 0)
  let end: Repeat['end'] = { kind: 'never' }
  if (kv.COUNT) end = { kind: 'count', count: Number(kv.COUNT) }
  else if (kv.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(kv.UNTIL)
    if (m) end = { kind: 'until', date: `${m[1]}-${m[2]}-${m[3]}` }
  }
  return { freq, interval: Number(kv.INTERVAL ?? 1) || 1, byDay, end }
}

export function buildRRule(r: Repeat): string {
  const parts = [`FREQ=${r.freq}`]
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  if (r.freq === 'WEEKLY' && r.byDay.length)
    parts.push(
      `BYDAY=${[...r.byDay]
        .sort()
        .map((i) => BYDAY[i])
        .join(',')}`,
    )
  if (r.end.kind === 'count') parts.push(`COUNT=${r.end.count}`)
  // UNTIL 按事件时区的浮动时间解释（服务端 calendar-recur）：取该日 23:59:59
  if (r.end.kind === 'until') parts.push(`UNTIL=${r.end.date.replace(/-/g, '')}T235959Z`)
  return parts.join(';')
}

type T = (key: string, opts?: Record<string, unknown>) => string

/** 描述（编辑器摘要 / 事件详情）；文案在 i18n `calendar.repeat.*`。 */
export function describeRepeat(r: Repeat | null, t: T): string {
  if (!r) return t('calendar.repeat.none')
  const n = r.interval
  let s: string
  const weekdays = [...r.byDay].sort()
  if (r.freq === 'DAILY')
    s = n === 1 ? t('calendar.repeat.everyDayOne') : t('calendar.repeat.everyDay', { count: n })
  else if (r.freq === 'WEEKLY') {
    if (n === 1 && weekdays.join() === '1,2,3,4,5') s = t('calendar.repeat.weekdays')
    else {
      s = n === 1 ? t('calendar.repeat.everyWeekOne') : t('calendar.repeat.everyWeek', { count: n })
      if (weekdays.length)
        s += t('calendar.repeat.onDays', {
          days: weekdays.map((i) => t(`calendar.wd.${i}`)).join(t('calendar.repeat.sep')),
        })
    }
  } else if (r.freq === 'MONTHLY')
    s = n === 1 ? t('calendar.repeat.everyMonthOne') : t('calendar.repeat.everyMonth', { count: n })
  else
    s = n === 1 ? t('calendar.repeat.everyYearOne') : t('calendar.repeat.everyYear', { count: n })
  if (r.end.kind === 'until') s += t('calendar.repeat.until', { date: r.end.date })
  if (r.end.kind === 'count') s += t('calendar.repeat.times', { count: r.end.count })
  return s
}

export type RepeatPreset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom'

export function presetOf(r: Repeat | null): RepeatPreset {
  if (!r) return 'none'
  const days = [...r.byDay].sort().join()
  if (r.freq === 'DAILY' && r.interval === 1) return 'daily'
  if (r.freq === 'WEEKLY' && r.interval === 1 && days === '1,2,3,4,5') return 'weekdays'
  if (r.freq === 'WEEKLY' && r.byDay.length <= 1)
    return r.interval === 1 ? 'weekly' : r.interval === 2 ? 'biweekly' : 'custom'
  if (r.freq === 'MONTHLY' && r.interval === 1) return 'monthly'
  if (r.freq === 'YEARLY' && r.interval === 1) return 'yearly'
  return 'custom'
}

export function repeatFromPreset(
  p: RepeatPreset,
  start: LocalDate,
  prev: Repeat | null,
): Repeat | null {
  const end = prev?.end ?? { kind: 'never' as const }
  const wd = dayOfWeek(start)
  switch (p) {
    case 'none':
      return null
    case 'daily':
      return { freq: 'DAILY', interval: 1, byDay: [], end }
    case 'weekdays':
      return { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5], end }
    case 'weekly':
      return { freq: 'WEEKLY', interval: 1, byDay: [wd], end }
    case 'biweekly':
      return { freq: 'WEEKLY', interval: 2, byDay: [wd], end }
    case 'monthly':
      return { freq: 'MONTHLY', interval: 1, byDay: [], end }
    case 'yearly':
      return { freq: 'YEARLY', interval: 1, byDay: [], end }
    case 'custom':
      return prev ?? { freq: 'WEEKLY', interval: 1, byDay: [wd], end }
  }
}

// ---------------------------------------------------------------- 提醒

export const TIMED_ALARMS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880] as const
// 全天事件：-540 = 当天 09:00；900 = 前一天 09:00；2340 = 两天前 09:00；9540 = 一周前 09:00
export const ALLDAY_ALARMS = [-540, 900, 2340, 9540] as const

export function alarmLabel(m: number, allDay: boolean, t: T): string {
  if (allDay) {
    if (m === -540) return t('calendar.alarm.dayOf')
    if (m === 900) return t('calendar.alarm.dayBefore', { count: 1 })
    if (m === 2340) return t('calendar.alarm.dayBefore', { count: 2 })
    if (m === 9540) return t('calendar.alarm.weekBefore')
  }
  if (m === 0) return t('calendar.alarm.atTime')
  if (m < 0) return t('calendar.alarm.after', { count: -m })
  if (m < 60) return t('calendar.alarm.minutes', { count: m })
  if (m < 1440) return t('calendar.alarm.hours', { count: m / 60 })
  return t('calendar.alarm.days', { count: m / 1440 })
}

export const dateInput = (d: LocalDate) => formatLocalDate(d)
export const weekOf = (d: LocalDate, weekStartsOn: number) =>
  addDays(d, -((dayOfWeek(d) - weekStartsOn + 7) % 7))

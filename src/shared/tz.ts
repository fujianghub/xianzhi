/**
 * 按用户时区计算日 / 周边界（02 §4「视图别名」、REQ-TASK-005 · 017）：只用 Intl，不引日期库。
 * 所有返回值都是 UTC 时刻（Date），数据库比较直接用；跨 DST 的日可能是 23 / 25 小时。
 */
export interface LocalDate {
  y: number
  m: number // 1–12
  d: number
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  return f
}

function parts(tz: string, at: Date) {
  const p: Record<string, number> = {}
  for (const x of fmt(tz).formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return p as {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
  }
}

/** 时区是否可用（非法 IANA 名 → false）。 */
export function isValidTimeZone(tz: string): boolean {
  try {
    fmt(tz)
    return true
  } catch {
    return false
  }
}

/** 该时区在 `at` 时刻相对 UTC 的偏移（毫秒，本地 − UTC）。 */
export function tzOffsetMs(tz: string, at: Date): number {
  const p = parts(tz, at)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** `at` 在该时区的本地日期。 */
export function localDateOf(tz: string, at: Date): LocalDate {
  const p = parts(tz, at)
  return { y: p.year, m: p.month, d: p.day }
}

/** 规整溢出的日期（如 d=0、d=32）。 */
export function addDays(date: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** 本地日期的 00:00 对应的 UTC 时刻（DST 当天 00:00 不存在时取其后第一个有效时刻）。 */
export function zonedMidnight(tz: string, date: LocalDate): Date {
  const wall = Date.UTC(date.y, date.m - 1, date.d)
  let t = wall - tzOffsetMs(tz, new Date(wall))
  const second = wall - tzOffsetMs(tz, new Date(t))
  if (second !== t) t = Math.max(t, second)
  return new Date(t)
}

/** 本地今日 [00:00, 次日 00:00)。 */
export function dayRange(tz: string, now: Date): { start: Date; end: Date } {
  const today = localDateOf(tz, now)
  return { start: zonedMidnight(tz, today), end: zonedMidnight(tz, addDays(today, 1)) }
}

/** 本地本周 [周起始日 00:00, +7 天)；weekStartsOn：0 = 周日 … 6 = 周六。 */
export function weekRange(tz: string, weekStartsOn: number, now: Date): { start: Date; end: Date } {
  const today = localDateOf(tz, now)
  const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay()
  const first = addDays(today, -((dow - weekStartsOn + 7) % 7))
  return { start: zonedMidnight(tz, first), end: zonedMidnight(tz, addDays(first, 7)) }
}

/** 'YYYY-MM-DD' ⇄ LocalDate（日历 search param，REQ-UI-031）；非法返回 null。 */
export function parseLocalDate(s: string | undefined): LocalDate | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null
  if (!m) return null
  const d = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  const t = addDays(d, 0)
  return t.y === d.y && t.m === d.m && t.d === d.d ? d : null
}
export const formatLocalDate = (d: LocalDate) =>
  `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
export const sameLocalDate = (a: LocalDate, b: LocalDate) =>
  a.y === b.y && a.m === b.m && a.d === b.d
/** 0 = 周日 … 6 = 周六 */
export const dayOfWeek = (d: LocalDate) => new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay()

/** 含 anchor 的那一周的 7 天（按 weekStartsOn 起始）。 */
export function weekDays(weekStartsOn: number, anchor: LocalDate): LocalDate[] {
  const first = addDays(anchor, -((dayOfWeek(anchor) - weekStartsOn + 7) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/**
 * 月视图 6×7 网格（REQ-UI-031）：从含本月 1 日那一周的周起始日开始，固定 42 天；
 * 返回本地日期序列与对应的 UTC 区间 [start, end)（供 GET /tasks?from&to）。
 */
export function monthGrid(
  tz: string,
  weekStartsOn: number,
  anchor: LocalDate,
): { days: LocalDate[]; start: Date; end: Date } {
  const first = weekDays(weekStartsOn, { y: anchor.y, m: anchor.m, d: 1 })[0] as LocalDate
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  return {
    days,
    start: zonedMidnight(tz, first),
    end: zonedMidnight(tz, addDays(first, 42)),
  }
}

/** 加减月份（日取 1 号，避免 1/31 + 1 月溢出）。 */
export function addMonths(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.y, d.m - 1 + n, 1))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: 1 }
}

/** 本地日期 + 当日分钟数（日历事件归日与时间轴定位，REQ-UI-031）。 */
export function localDateTimeOf(tz: string, at: Date): { date: LocalDate; minutes: number } {
  const p = parts(tz, at)
  return { date: { y: p.year, m: p.month, d: p.day }, minutes: (p.hour % 24) * 60 + p.minute }
}

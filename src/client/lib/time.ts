/**
 * 时间显示（04 §7、REQ-UI-018 · REQ-TASK-017）：24 小时内相对时间（「刚刚 / 5 分钟前 / 3 小时后」），
 * 超出显示绝对日期；悬停 title 一律为完整绝对时间。日期数字按用户 locale 与 timezone（存储始终是 UTC）。
 */
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const cache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${tz}|${JSON.stringify(opts)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, hourCycle: 'h23', ...opts })
    cache.set(key, f)
  }
  return f
}

/** 完整绝对时间（悬停 title）：2026年9月24日 14:05。 */
export function absoluteTime(d: Date, locale = 'zh-CN', tz = 'Asia/Shanghai'): string {
  return dtf(locale, tz, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/** 相对 / 绝对的主显示文本。 */
export function displayTime(d: Date, now: Date, locale = 'zh-CN', tz = 'Asia/Shanghai'): string {
  const diff = d.getTime() - now.getTime()
  const abs = Math.abs(diff)
  if (abs < DAY) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (abs < MIN) return rtf.format(0, 'second') // zh-CN：「现在」
    return abs < HOUR
      ? rtf.format(Math.round(diff / MIN), 'minute')
      : rtf.format(Math.round(diff / HOUR), 'hour')
  }
  const sameYear =
    dtf(locale, tz, { year: 'numeric' }).format(d) ===
    dtf(locale, tz, { year: 'numeric' }).format(now)
  return dtf(
    locale,
    tz,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  ).format(d)
}

/** 截止日期短格式：今天 / 明天 / 9月24日（按用户时区的日历日比较）。 */
export function dueLabel(d: Date, now: Date, locale = 'zh-CN', tz = 'Asia/Shanghai'): string {
  const day = (x: Date) =>
    dtf(locale, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
  const plus = (n: number) => new Date(now.getTime() + n * DAY)
  // 今天 / 明天 / 昨天：由 Intl 按 locale 给出，不在代码里写死文案
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const n of [0, 1, -1]) if (day(d) === day(plus(n))) return rtf.format(n, 'day')
  return displayTime(d, new Date(now.getTime() + 2 * DAY), locale, tz)
}

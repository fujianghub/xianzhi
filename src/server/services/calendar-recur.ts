/**
 * 日程重复展开（ADR-0009、REQ-CAL-004）：RRULE 在事件 `timezone` 的**本地墙钟**上展开
 * （把本地时刻当作 UTC 的「浮动时间」喂给 rrule），再换回真实时刻——跨 DST 仍是「每天 09:00」。
 * UNTIL 同样按浮动时间解释（前端按本地日期 23:59:59 生成）。
 */
import rrulePkg from 'rrule'
import { CAL_FREQS } from '../../shared/schemas/enums.ts'
import { tzOffsetMs } from '../../shared/tz.ts'

const { RRule } = rrulePkg

/** 单次查询最多展开的发生次数（防御超长区间 × 每日重复）。 */
export const MAX_OCCURRENCES = 2000

/** 真实时刻 → 该时区墙钟的「浮动 UTC」。 */
export const toFloating = (tz: string, at: Date) => new Date(at.getTime() + tzOffsetMs(tz, at))

/** 浮动 UTC → 真实时刻（与 zonedMidnight 同法处理 DST 缝隙）。 */
export function fromFloating(tz: string, wall: Date): Date {
  const w = wall.getTime()
  let t = w - tzOffsetMs(tz, new Date(w))
  const second = w - tzOffsetMs(tz, new Date(t))
  if (second !== t) t = Math.max(t, second)
  return new Date(t)
}

export class InvalidRRuleError extends Error {}

/** 校验并解析 RRULE（不含 DTSTART）；只接受 DAILY / WEEKLY / MONTHLY / YEARLY。 */
export function parseRRule(rrule: string) {
  let opts: ReturnType<typeof RRule.parseString>
  try {
    opts = RRule.parseString(rrule.replace(/^RRULE:/i, ''))
  } catch {
    throw new InvalidRRuleError('无法解析的重复规则')
  }
  const freq = opts.freq === undefined ? undefined : RRule.FREQUENCIES[opts.freq]
  if (!freq || !(CAL_FREQS as readonly string[]).includes(freq))
    throw new InvalidRRuleError('重复频率仅支持 每天 / 每周 / 每月 / 每年')
  if (opts.count !== undefined && opts.count !== null && (opts.count < 1 || opts.count > 1000))
    throw new InvalidRRuleError('重复次数须在 1–1000 之间')
  if (opts.interval !== undefined && (opts.interval < 1 || opts.interval > 99))
    throw new InvalidRRuleError('重复间隔须在 1–99 之间')
  return opts
}

interface Recurring {
  startAt: Date
  endAt: Date
  timezone: string
  rrule: string
  exdates?: Date[]
}

function ruleOf(ev: Recurring) {
  return new RRule({ ...parseRRule(ev.rrule), dtstart: toFloating(ev.timezone, ev.startAt) })
}

/**
 * 与 [from, to) 相交的发生时刻（真实 UTC 时刻，已剔除 exdates）。
 * 发生 = [start, start + 时长)；区间向前放宽一个时长，覆盖「开始早于 from 但仍在进行」的发生。
 */
export function occurrencesBetween(ev: Recurring, from: Date, to: Date): Date[] {
  const dur = ev.endAt.getTime() - ev.startAt.getTime()
  const rule = ruleOf(ev)
  const lo = toFloating(ev.timezone, new Date(from.getTime() - dur))
  const hi = toFloating(ev.timezone, to)
  const ex = new Set((ev.exdates ?? []).map((d) => d.getTime()))
  const out: Date[] = []
  rule.between(lo, hi, true, (d) => {
    const real = fromFloating(ev.timezone, d)
    if (real.getTime() + dur > from.getTime() && real < to && !ex.has(real.getTime()))
      out.push(real)
    return out.length < MAX_OCCURRENCES
  })
  return out
}

/** 该时刻是否是系列里的一次发生（改 / 删单次时校验 occurrenceStart）。 */
export function isOccurrence(ev: Recurring, at: Date): boolean {
  const f = toFloating(ev.timezone, at)
  const hit = ruleOf(ev).between(new Date(f.getTime() - 1), new Date(f.getTime() + 1), true)
  return hit.some((d) => fromFloating(ev.timezone, d).getTime() === at.getTime())
}

/** 系列最后一次发生的结束时刻；无限重复返回 null（写入 repeat_until 供区间剪枝）。 */
export function seriesEnd(ev: Recurring): Date | null {
  const opts = parseRRule(ev.rrule)
  if (!opts.until && !opts.count) return null
  const dur = ev.endAt.getTime() - ev.startAt.getTime()
  const all = ruleOf(ev).all((_, i) => i < 1000)
  const last = all.at(-1)
  return last ? new Date(fromFloating(ev.timezone, last).getTime() + dur) : ev.endAt
}

/**
 * 把系列截断到 `before`（不含）之前：改写 RRULE 的 UNTIL（去掉 COUNT）。
 * 用于「删除 / 修改此次及将来」。返回 null = before 之前已无发生（整个系列应删除）。
 */
export function truncateRRule(ev: Recurring, before: Date): string | null {
  const opts = parseRRule(ev.rrule)
  const rule = ruleOf(ev)
  const prev = rule.before(toFloating(ev.timezone, before), false)
  if (!prev) return null
  const { count: _c, until: _u, ...rest } = opts
  return new RRule({ ...rest, until: prev }).toString().replace(/^RRULE:/, '')
}

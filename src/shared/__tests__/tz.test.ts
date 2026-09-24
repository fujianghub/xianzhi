/** REQ-TASK-017 时区边界工具：日 / 周范围按用户时区，DST 日 23 / 25 小时。 */
import { describe, expect, it } from 'vitest'
import {
  addMonths,
  dayOfWeek,
  dayRange,
  formatLocalDate,
  isValidTimeZone,
  type LocalDate,
  localDateOf,
  monthGrid,
  parseLocalDate,
  weekDays,
  weekRange,
  zonedMidnight,
} from '../tz.ts'

const H = 3_600_000

describe('tz', () => {
  it('REQ-TASK-017 同一 UTC 时刻在上海与洛杉矶落在不同的本地日', () => {
    const at = new Date('2026-09-24T02:00:00Z') // 上海 10:00 9/24；洛杉矶 19:00 9/23
    expect(localDateOf('Asia/Shanghai', at)).toEqual({ y: 2026, m: 9, d: 24 })
    expect(localDateOf('America/Los_Angeles', at)).toEqual({ y: 2026, m: 9, d: 23 })
    const sh = dayRange('Asia/Shanghai', at)
    expect(sh.start.toISOString()).toBe('2026-09-23T16:00:00.000Z')
    expect(sh.end.toISOString()).toBe('2026-09-24T16:00:00.000Z')
    const la = dayRange('America/Los_Angeles', at)
    expect(la.start.toISOString()).toBe('2026-09-23T07:00:00.000Z')
  })

  it('REQ-TASK-017 DST：纽约 3/8 为 23 小时、11/1 为 25 小时', () => {
    const spring = dayRange('America/New_York', new Date('2026-03-08T12:00:00Z'))
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * H)
    const fall = dayRange('America/New_York', new Date('2026-11-01T12:00:00Z'))
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * H)
    expect(zonedMidnight('America/New_York', { y: 2026, m: 11, d: 1 }).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    )
  })

  it('REQ-TASK-017 周范围按 weekStartsOn（周一 / 周日）', () => {
    const thu = new Date('2026-09-24T02:00:00Z') // 上海周四
    expect(weekRange('Asia/Shanghai', 1, thu).start.toISOString()).toBe('2026-09-20T16:00:00.000Z') // 周一 9/21 00:00
    expect(weekRange('Asia/Shanghai', 0, thu).start.toISOString()).toBe('2026-09-19T16:00:00.000Z') // 周日 9/20 00:00
    const w = weekRange('Asia/Shanghai', 1, thu)
    expect(w.end.getTime() - w.start.getTime()).toBe(7 * 24 * H)
  })

  it('REQ-UI-031 月视图网格：固定 42 天、从周起始日开始、含本月全部日期；区间按时区换算', () => {
    const g = monthGrid('Asia/Shanghai', 1, { y: 2026, m: 9, d: 24 })
    expect(g.days).toHaveLength(42)
    expect(g.days[0]).toEqual({ y: 2026, m: 8, d: 31 }) // 9/1 是周二 → 从周一 8/31 开始
    expect(dayOfWeek(g.days[0] as LocalDate)).toBe(1)
    expect(g.days.some((d) => d.m === 9 && d.d === 30)).toBe(true)
    expect(g.start.toISOString()).toBe('2026-08-30T16:00:00.000Z')
    expect(g.end.getTime() - g.start.getTime()).toBe(42 * 24 * H)
    const sun = monthGrid('Asia/Shanghai', 0, { y: 2026, m: 11, d: 1 }) // 11/1 是周日
    expect(sun.days[0]).toEqual({ y: 2026, m: 11, d: 1 })
  })

  it('REQ-UI-031 周日期、月份加减与 YYYY-MM-DD 解析', () => {
    expect(weekDays(1, { y: 2026, m: 9, d: 24 }).map(formatLocalDate)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ])
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 1 })
    expect(addMonths({ y: 2026, m: 1, d: 5 }, -1)).toEqual({ y: 2025, m: 12, d: 1 })
    expect(parseLocalDate('2026-02-29')).toBeNull()
    expect(parseLocalDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 })
    expect(parseLocalDate('bad')).toBeNull()
  })

  it('非法时区名 → false', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })
})

/** REQ-TASK-017 时区边界工具：日 / 周范围按用户时区，DST 日 23 / 25 小时。 */
import { describe, expect, it } from 'vitest'
import { dayRange, isValidTimeZone, localDateOf, weekRange, zonedMidnight } from '../tz.ts'

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

  it('非法时区名 → false', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })
})

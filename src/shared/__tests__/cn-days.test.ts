/** 中国节假日 / 农历小字（ADR-0009 §3、REQ-CAL-007）：寒食节只在清明前一日（绕开 chinese-days 1.5.9 的误判）。 */
import { describe, expect, it } from 'vitest'
import { dayCaption, dayMeta } from '../cn-days.ts'
import { addDays, type LocalDate } from '../tz.ts'

/** 某年 4 月 1 ~ 25 日里显示「寒食节」的日期 */
function hanshiDays(y: number): string[] {
  const out: string[] = []
  let d: LocalDate = { y, m: 4, d: 1 }
  while (d.d <= 25 && d.m === 4) {
    if (dayMeta(d).festival === '寒食节') out.push(`${d.m}-${d.d}`)
    d = addDays(d, 1)
  }
  return out
}

describe('寒食节', () => {
  it('REQ-CAL-007 寒食节只在清明前一日（2025 清明 4/4、2026 · 2027 清明 4/5）', () => {
    expect(hanshiDays(2025)).toEqual(['4-3'])
    expect(hanshiDays(2026)).toEqual(['4-4'])
    expect(hanshiDays(2027)).toEqual(['4-4'])
  })

  it('REQ-CAL-007 清明之后的日子回到节气 / 节日 / 农历小字，同日其它主要节日照常', () => {
    expect(dayCaption(dayMeta({ y: 2026, m: 4, d: 5 }))).toMatchObject({ text: '清明' })
    expect(dayCaption(dayMeta({ y: 2026, m: 4, d: 10 })).text).not.toBe('寒食节')
    expect(dayMeta({ y: 2027, m: 4, d: 9 }).festival).toBe('上巳节')
  })
})

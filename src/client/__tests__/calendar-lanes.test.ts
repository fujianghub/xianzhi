/** REQ-CAL-011 时间轴分栏上限：重叠簇超过 2 列时收成「+N」。 */
import { describe, expect, it } from 'vitest'
import {
  type CalItem,
  capLanes,
  layoutBars,
  layoutLanes,
  toggleAllDay,
} from '../components/calendar/model.ts'

// 18:00–18:30 三条重叠；20:00 一条独立
const segs = [
  { from: 1080, to: 1110 },
  { from: 1080, to: 1110 },
  { from: 1080, to: 1110 },
  { from: 1200, to: 1260 },
]

describe('时间轴分栏', () => {
  it('REQ-CAL-011 layoutLanes 给出簇序号：重叠三条同簇 3 列，独立一条另成一簇', () => {
    const l = layoutLanes(segs)
    expect(l.slice(0, 3).map((s) => [s.lane, s.lanes, s.cluster])).toEqual([
      [0, 3, 0],
      [1, 3, 0],
      [2, 3, 0],
    ])
    expect(l[3]).toEqual({ lane: 0, lanes: 1, cluster: 1 })
  })

  it('REQ-CAL-011 capLanes(max=2)：保留第 1 列（宽度按 2 列），其余 2 条收进第 2 列的「+2」', () => {
    const { shown, more } = capLanes(segs, layoutLanes(segs), 2)
    expect(shown[0]).toMatchObject({ lane: 0, lanes: 2 })
    expect(shown[1]).toBeNull()
    expect(shown[2]).toBeNull()
    expect(shown[3]).toMatchObject({ lane: 0, lanes: 1 })
    expect(more).toEqual([{ cluster: 0, hidden: [1, 2], from: 1080, lane: 1, lanes: 2 }])
  })

  it('REQ-CAL-011 不超上限或 max=Infinity（日视图）时不收起', () => {
    const two = segs.slice(0, 2)
    expect(capLanes(two, layoutLanes(two), 2).more).toEqual([])
    const all = capLanes(segs, layoutLanes(segs), Number.POSITIVE_INFINITY)
    expect(all.more).toEqual([])
    expect(all.shown.every(Boolean)).toBe(true)
  })
})

describe('连续条排布（ADR-0057）', () => {
  // 2026-10-12（周一）~ 10-18（周日）一周
  const week = Array.from({ length: 7 }, (_, i) => `2026-10-${String(12 + i).padStart(2, '0')}`)
  const item = (key: string, startDay: string, endDay: string, allDay = true): CalItem => ({
    key,
    source: 'event',
    title: key,
    color: 'blue',
    allDay,
    start: new Date(`${startDay}T00:00:00+08:00`),
    end: new Date(`${endDay}T23:59:00+08:00`),
    startDay,
    endDay,
  })

  it('REQ-CAL-015 跨周的日程切成本周一段：起止列、两端是否延续；放不下的另起一行', () => {
    const bars = layoutBars(
      [
        item('a', '2026-10-16', '2026-10-19'), // 周五 → 下周一：本周 4~6 列，右端延续
        item('b', '2026-10-08', '2026-10-13'), // 上周 → 周二：本周 0~1 列，左端延续
        item('c', '2026-10-17', '2026-10-17', false), // 周六单日，和 a 重叠 → 第 2 行
        item('d', '2026-10-14', '2026-10-14', false), // 周三单日：第 1 行空位
        item('x', '2026-10-20', '2026-10-21'), // 不在本周
      ],
      week,
    )
    const by = Object.fromEntries(bars.map((b) => [b.item.key, b]))
    expect(Object.keys(by).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(by.a).toMatchObject({ c0: 4, c1: 6, lane: 0, contL: false, contR: true })
    expect(by.b).toMatchObject({ c0: 0, c1: 1, lane: 0, contL: true, contR: false })
    expect(by.d).toMatchObject({ c0: 2, c1: 2, lane: 0 })
    expect(by.c).toMatchObject({ c0: 5, c1: 5, lane: 1 })
  })
})

describe('切换全天（ADR-0057）', () => {
  const allDay16to19 = {
    allDay: true,
    startDate: '2026-10-16',
    endDate: '2026-10-19',
    startTime: '00:00',
    endTime: '00:00',
  }
  it('REQ-CAL-016 取消全天：00:00 起止改为 09:00–10:00、日期不变（结束落在 19 日当天）', () => {
    expect(toggleAllDay(allDay16to19, false)).toEqual({
      ...allDay16to19,
      allDay: false,
      startTime: '09:00',
      endTime: '10:00',
    })
  })
  it('REQ-CAL-016 已有时刻不动；打开全天时结束日不早于开始日', () => {
    const timed = { ...allDay16to19, allDay: false, startTime: '14:00', endTime: '15:30' }
    expect(toggleAllDay({ ...timed, allDay: true }, false)).toMatchObject({
      startTime: '14:00',
      endTime: '15:30',
    })
    expect(toggleAllDay({ ...timed, endDate: '2026-10-15' }, true)).toMatchObject({
      allDay: true,
      endDate: '2026-10-16',
    })
  })
})

/** REQ-CAL-011 时间轴分栏上限：重叠簇超过 2 列时收成「+N」。 */
import { describe, expect, it } from 'vitest'
import { capLanes, layoutLanes } from '../components/calendar/model.ts'

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

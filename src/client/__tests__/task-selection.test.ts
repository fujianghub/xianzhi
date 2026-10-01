/** ADR-0045：页面级选择的 Shift 连选（REQ-TASK-040）。 */
import { describe, expect, it } from 'vitest'
import { rangeSelect } from '../lib/task-selection.ts'

describe('task selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  it('REQ-TASK-040 Shift 连选取 anchor 与目标之间（含两端），方向无关；无 anchor 或 anchor 已不可见只选目标；目标不可见为空', () => {
    expect(rangeSelect(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeSelect(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeSelect(order, null, 'c')).toEqual(['c'])
    expect(rangeSelect(order, 'zz', 'c')).toEqual(['c'])
    expect(rangeSelect(order, 'a', 'zz')).toEqual([])
  })
})

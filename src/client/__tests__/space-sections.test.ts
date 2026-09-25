/** REQ-KB-002 侧栏分区与拖放计算（纯函数）。 */
import { describe, expect, it } from 'vitest'
import { groupSpaces, planSpaceMove, type Space, type SpaceGroup } from '../lib/space-queries.ts'

const g = (id: string, name: string): SpaceGroup => ({
  id,
  name,
  color: null,
  icon: null,
  description: null,
  sortKey: id,
})
const s = (id: string, groupId: string | null, isPersonal = false) =>
  ({ id, name: id, groupId, isPersonal }) as unknown as Space

describe('space sections', () => {
  const groups = [g('G1', '产品开发'), g('G2', '技术学习规划'), g('G3', '生活')]
  const spaces = [s('me', null, true), s('a', 'G1'), s('b', 'G1'), s('c', 'G2'), s('x', null)]

  it('REQ-KB-002 groupSpaces：按大类分区、个人空间不参与、空大类保留、其他（未归入大类）最后', () => {
    const secs = groupSpaces(spaces, groups)
    expect(
      secs.map((x) => [x.group?.name ?? '其他（未归入大类）', x.items.map((i) => i.id)]),
    ).toEqual([
      ['产品开发', ['a', 'b']],
      ['技术学习规划', ['c']],
      ['生活', []],
      ['其他（未归入大类）', ['x']],
    ])
    // 无其他（未归入大类）时不出现该区
    expect(groupSpaces(spaces.slice(0, 4), groups).at(-1)?.group?.name).toBe('生活')
  })

  it('REQ-KB-002 planSpaceMove：区内排序不带 groupId；跨区放到目标之后；拖到分区头放最前', () => {
    const secs = groupSpaces(spaces, groups)
    expect(planSpaceMove(secs, 'b', 'a')).toEqual({
      after: null,
      order: ['b', 'a', 'c', 'x'],
    })
    expect(planSpaceMove(secs, 'a', 'c')).toEqual({
      after: 'c',
      groupId: 'G2',
      order: ['b', 'c', 'a', 'x'],
    })
    expect(planSpaceMove(secs, 'x', 'group:G3')).toEqual({
      after: null,
      groupId: 'G3',
      order: ['a', 'b', 'c', 'x'],
    })
    expect(planSpaceMove(secs, 'c', 'group:none')).toEqual({
      after: null,
      groupId: null,
      order: ['a', 'b', 'c', 'x'],
    })
    expect(planSpaceMove(secs, 'a', 'a')).toBeNull()
    expect(planSpaceMove(secs, 'me', 'a')).toBeNull() // 个人空间不在分区里
  })
})

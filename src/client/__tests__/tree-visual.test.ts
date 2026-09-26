/** REQ-KB-006 目录层级表达 · REQ-UI-037 记录类型图标（ADR-0015）。 */
import { describe, expect, it } from 'vitest'
import { ENTRY_KINDS } from '../../shared/schemas/enums.ts'
import { ENTRY_KIND_ICON, ENTRY_KIND_TONE, toneClass } from '../components/domain/KindIcon.tsx'
import { staggerIndex, treeLevelClass } from '../components/ui/tree-guides.tsx'
import { flatten, type TreeNodeLite } from '../lib/tree.ts'

const n = (id: string, parentId: string | null, treeOrder: string): TreeNodeLite => ({
  id,
  title: id,
  kind: 'note',
  parentId,
  treeOrder,
})
// A
//   A1
//     A1a
//   A2
// B
const nodes = [
  n('A', null, 'a0'),
  n('A1', 'A', 'a0'),
  n('A1a', 'A1', 'a0'),
  n('A2', 'A', 'a1'),
  n('B', null, 'a1'),
]

describe('目录层级表达', () => {
  it('REQ-KB-006 flatten 给出直接子项数（折叠时显示在行尾）', () => {
    const flat = flatten(nodes, new Set(['A']))
    expect(flat.map((i) => [i.id, i.childCount])).toEqual([
      ['A', 2],
      ['B', 0],
    ])
    expect(flatten(nodes).find((i) => i.id === 'A1')?.childCount).toBe(1)
  })

  it('REQ-KB-006 展开入场按相对父项的位置错峰；根级为 0', () => {
    const idx = staggerIndex(flatten(nodes))
    expect(idx.get('A')).toBe(0)
    expect(idx.get('A1')).toBe(0)
    expect(idx.get('A1a')).toBe(0)
    expect(idx.get('A2')).toBe(2)
    expect(idx.get('B')).toBe(0)
  })

  it('REQ-KB-006 字重按层级递减：L0 600 · L1 500 · 其余 400', () => {
    expect(treeLevelClass(0)).toBe('xz-tree-l0')
    expect(treeLevelClass(1)).toBe('xz-tree-l1')
    expect(treeLevelClass(2)).toBe('')
  })
})

describe('记录类型图标', () => {
  it('REQ-UI-037 每种记录类型都有各不相同的图标，色调类取自色板', () => {
    const icons = ENTRY_KINDS.map((k) => ENTRY_KIND_ICON[k])
    expect(icons.every(Boolean)).toBe(true)
    expect(new Set(icons).size).toBe(ENTRY_KINDS.length)
    expect(toneClass(ENTRY_KIND_TONE.bug)).toBe('xz-tone-red')
    expect(toneClass(null)).toBe('xz-tone-gray')
  })
})

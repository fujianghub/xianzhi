/** REQ-KB-005 目录树纯函数：展平、过滤、拖放投影、键盘移动。 */
import { describe, expect, it } from 'vitest'
import {
  appendRoot,
  filterTree,
  flatten,
  keyboardMove,
  projectDrop,
  type TreeNodeLite,
} from '../lib/tree.ts'

const n = (id: string, parentId: string | null, treeOrder: string): TreeNodeLite => ({
  id,
  title: id,
  kind: 'note',
  parentId,
  treeOrder,
})
// A
//   A1
//   A2
// B
const nodes = [n('A', null, 'a0'), n('A1', 'A', 'a0'), n('A2', 'A', 'a1'), n('B', null, 'a1')]

describe('tree', () => {
  it('REQ-KB-005 flatten 深度优先、折叠、hasChildren', () => {
    expect(flatten(nodes).map((i) => `${'.'.repeat(i.depth)}${i.id}`)).toEqual([
      'A',
      '.A1',
      '.A2',
      'B',
    ])
    expect(flatten(nodes, new Set(['A'])).map((i) => i.id)).toEqual(['A', 'B'])
    expect(flatten(nodes)[0]?.hasChildren).toBe(true)
  })

  it('REQ-KB-005 filterTree 保留命中项及其祖先', () => {
    expect(
      filterTree(nodes, 'a2')
        .map((x) => x.id)
        .sort(),
    ).toEqual(['A', 'A2'])
  })

  it('REQ-KB-005 projectDrop：拖到 A1 之上成为 A 的第一个子页；右移成为子页；拖到末尾左移回根级', () => {
    const items = flatten(nodes)
    // B 拖到 A1 的位置（深度随 prev=A 夹到 1）→ A 下第一个
    expect(projectDrop(items, 'B', 'A1', 0, 24)).toMatchObject({
      parentId: 'A',
      after: null,
      depth: 1,
    })
    // A2 右移一格 → 成为 A1 的子页
    expect(projectDrop(items, 'A2', 'A2', 24, 24)).toMatchObject({ parentId: 'A1', after: null })
    // A2 拖到 B 之后并左移 → 根级、B 之后
    expect(projectDrop(items, 'A2', 'B', -24, 24)).toMatchObject({
      parentId: null,
      after: 'B',
      depth: 0,
    })
    // 原地不动 → null
    expect(projectDrop(items, 'A1', 'A1', 0, 24)).toBeNull()
  })

  it('REQ-KB-005 keyboardMove 上移 / 下移 / 缩进 / 取消缩进；appendRoot', () => {
    expect(keyboardMove(nodes, 'A2', 'up')).toEqual({ parentId: 'A', after: null })
    expect(keyboardMove(nodes, 'A1', 'up')).toBeNull()
    expect(keyboardMove(nodes, 'A1', 'down')).toEqual({ parentId: 'A', after: 'A2' })
    expect(keyboardMove(nodes, 'A2', 'indent')).toEqual({ parentId: 'A1', after: null })
    expect(keyboardMove(nodes, 'B', 'indent')).toEqual({ parentId: 'A', after: 'A2' })
    expect(keyboardMove(nodes, 'A1', 'outdent')).toEqual({ parentId: null, after: 'A' })
    expect(keyboardMove(nodes, 'A', 'outdent')).toBeNull()
    expect(appendRoot(nodes)).toEqual({ parentId: null, after: 'B' })
  })
})

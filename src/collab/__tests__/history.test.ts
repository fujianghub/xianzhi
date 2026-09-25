/** REQ-COLLAB-008 历史版本：快照重建与「以一次修改恢复」（纯 Yjs，不连库）。 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { diffBlocks, lcsPairs } from '../../shared/editor/diff.ts'
import { YDOC_FRAGMENT } from '../derive.ts'
import { restoreFragment, snapshotPmJson } from '../history.ts'

const para = (text: string) => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  return p
}
const texts = (doc: Y.Doc) =>
  doc
    .getXmlFragment(YDOC_FRAGMENT)
    .toArray()
    .map((n) =>
      (n as Y.XmlElement)
        .toArray()
        .map((t) => (t as Y.XmlText).toString())
        .join(''),
    )

describe('history', () => {
  it('REQ-COLLAB-008 lcsPairs 取最长公共子序列', () => {
    const p = lcsPairs(['a', 'b', 'c', 'd'], ['a', 'c', 'x', 'd'])
    expect([...p.entries()]).toEqual([
      [0, 0],
      [2, 1],
      [3, 3],
    ])
    expect(lcsPairs([], ['a']).size).toBe(0)
  })

  it('REQ-COLLAB-008 快照重建旧正文；恢复后内容回到快照、未变块保留身份、快照仍可重建', () => {
    const doc = new Y.Doc({ gc: false })
    const frag = doc.getXmlFragment(YDOC_FRAGMENT)
    frag.insert(0, [para('甲'), para('乙'), para('丙')])
    const snap = Y.encodeSnapshot(Y.snapshot(doc))
    const keep = frag.get(0)
    // 之后：删「乙」、改「丙」为「丁」、末尾加「戊」
    frag.delete(1, 1)
    frag.delete(1, 1)
    frag.insert(1, [para('丁'), para('戊')])
    expect(texts(doc)).toEqual(['甲', '丁', '戊'])

    const pm = snapshotPmJson(Y.encodeStateAsUpdate(doc), snap)
    expect(pm.content?.map((n) => n.content?.[0]?.text)).toEqual(['甲', '乙', '丙'])

    const svBefore = Y.encodeStateVector(doc)
    let stats: ReturnType<typeof restoreFragment> | undefined
    doc.transact(() => {
      stats = restoreFragment(doc, snap)
    })
    expect(texts(doc)).toEqual(['甲', '乙', '丙'])
    expect(stats).toEqual({ kept: 1, removed: 2, inserted: 2 })
    expect(frag.get(0)).toBe(keep) // 未变的块是同一个 Y 类型
    // 是「前进」的一次修改：状态向量变大，旧快照依然可重建
    expect(Y.encodeStateVector(doc)).not.toEqual(svBefore)
    expect(
      snapshotPmJson(Y.encodeStateAsUpdate(doc), snap).content?.map((n) => n.content?.[0]?.text),
    ).toEqual(['甲', '乙', '丙'])
  })

  it('REQ-COLLAB-008 diffBlocks：当前 → 快照按阅读顺序合并 same / del / add', () => {
    const p = (text: string) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })
    // 当前侧来自 jsonb（键序被重排）：不应影响相等判断
    const jsonb = (text: string) => ({ content: [{ text, type: 'text' }], type: 'paragraph' })
    const d = diffBlocks([jsonb('甲'), p('丁'), p('戊')], [p('甲'), p('乙'), p('丙')])
    expect(d.map((x) => `${x.op}:${x.node.content?.[0]?.text}`)).toEqual([
      'same:甲',
      'del:丁',
      'del:戊',
      'add:乙',
      'add:丙',
    ])
  })

  it('REQ-COLLAB-008 恢复到空快照 → 正文清空', () => {
    const doc = new Y.Doc({ gc: false })
    const frag = doc.getXmlFragment(YDOC_FRAGMENT)
    const snap = Y.encodeSnapshot(Y.snapshot(doc))
    frag.insert(0, [para('x')])
    doc.transact(() => restoreFragment(doc, snap))
    expect(frag.length).toBe(0)
  })
})

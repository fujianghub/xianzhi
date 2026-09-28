import { describe, expect, it } from 'vitest'
import { collectHeadings, numberHeadings } from './headings.ts'

describe('headings', () => {
  it('REQ-READ-004 章节编号跳级压缩：从 h2 起也从 1 开始，跳过的层级不产生空段', () => {
    expect(numberHeadings([2, 2, 3, 3, 2]).map((x) => x.num)).toEqual(['1', '2', '2.1', '2.2', '3'])
    expect(numberHeadings([1, 2, 4, 2, 4, 3])).toEqual([
      { num: '1', depth: 1 },
      { num: '1.1', depth: 2 },
      { num: '1.1.1', depth: 3 },
      { num: '1.2', depth: 2 },
      { num: '1.2.1', depth: 3 },
      // h3 在 h4 之后：h4 出栈，h3 成为 1.2 的新子节
      { num: '1.2.2', depth: 3 },
    ])
    // 先深后浅：h3 开头再来 h2，h2 不嵌在 h3 之下
    expect(numberHeadings([3, 2, 3]).map((x) => x.num)).toEqual(['1', '2', '2.1'])
    expect(numberHeadings([])).toEqual([])
  })

  it('REQ-READ-004 collectHeadings 只收标题且不进标题内部，编号随顺序给出', () => {
    const nodes = [
      { name: 'heading', level: 2, text: '背景', pos: 0 },
      { name: 'paragraph', level: 0, text: 'x', pos: 5 },
      { name: 'heading', level: 3, text: '细节', pos: 9 },
    ]
    const doc = {
      descendants: (
        f: (
          n: { type: { name: string }; attrs: Record<string, unknown>; textContent: string },
          pos: number,
        ) => boolean | undefined,
      ) => {
        for (const n of nodes)
          f({ type: { name: n.name }, attrs: { level: n.level }, textContent: n.text }, n.pos)
      },
    }
    expect(collectHeadings(doc)).toEqual([
      { level: 2, text: '背景', pos: 0, num: '1', depth: 1 },
      { level: 3, text: '细节', pos: 9, num: '1.1', depth: 2 },
    ])
  })
})

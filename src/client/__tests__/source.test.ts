/** REQ-EDITOR-020 Markdown 源码编辑：按块序列化 / 占位行 / LCS 合并沿用原节点；markdown-it 管线与导出序列化对称。 */
import { describe, expect, it } from 'vitest'
import { lossyMarks, mergeSource, sameDoc, toSource } from '../../shared/editor/source.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { markdownToHtml } from '../editor/paste.ts'

const p = (text: string, marks?: PmNode['marks']): PmNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
})
const h2 = (text: string): PmNode => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})
const ATT = '0192f7a0-0000-7000-8000-000000000001'
const attachment: PmNode = {
  type: 'attachment',
  attrs: { attachmentId: ATT, name: 'a.pdf', size: 1, mime: 'application/pdf' },
}
const doc = (...content: PmNode[]): PmNode => ({ type: 'doc', content })

describe('source', () => {
  const original = doc(
    h2('背景'),
    p('要保留的下划线', [{ type: 'underline' }]),
    attachment,
    p('要改的段落'),
  )

  it('REQ-EDITOR-020 toSource：逐块 Markdown，附件为占位行；图片写成 xz:attachment', () => {
    const src = toSource(original)
    expect(src).toBe('## 背景\n\n要保留的下划线\n\n⟦xz-keep:2:attachment⟧\n\n要改的段落\n')
    const img = toSource(doc({ type: 'image', attrs: { src: `xz:attachment/${ATT}`, alt: '' } }))
    expect(img.trim()).toBe(`![](xz:attachment/${ATT})`)
  })

  it('REQ-EDITOR-020 mergeSource：未改块沿用原节点（下划线保留）、占位行还原、改动块用解析结果', () => {
    // 模拟「编辑后 Markdown」的解析结果：改了最后一段，附件行挪到最后，新增一段
    const parsed = doc(
      h2('背景'),
      p('要保留的下划线'),
      p('改过的段落'),
      p('新增一段'),
      p('⟦xz-keep:2:attachment⟧'),
    )
    const r = mergeSource(original, parsed)
    expect(r.doc.content?.[1]).toEqual(original.content?.[1]) // 带 underline 的原节点
    expect(r.doc.content?.[4]).toEqual(attachment)
    expect(r.doc.content?.[2]).toEqual(p('改过的段落'))
    expect(r.kept).toBe(3)
    expect(sameDoc(r.doc, original)).toBe(false)
  })

  it('REQ-EDITOR-020 什么都没改 → sameDoc；删掉占位行 → 该块被删除', () => {
    const unchanged = doc(
      h2('背景'),
      p('要保留的下划线'),
      p('⟦xz-keep:2:attachment⟧'),
      p('要改的段落'),
    )
    expect(sameDoc(mergeSource(original, unchanged).doc, original)).toBe(true)
    const dropped = mergeSource(original, doc(h2('背景'), p('要保留的下划线'), p('要改的段落')))
    expect(dropped.doc.content?.some((n) => n.type === 'attachment')).toBe(false)
  })

  it('REQ-EDITOR-020 lossyMarks 列出 Markdown 表达不了的格式', () => {
    expect(lossyMarks(original)).toEqual(['underline'])
  })

  it('REQ-EDITOR-020 markdownToHtml 与导出对称：:::callout / mermaid / $$ / xz://entry', () => {
    const id = '0192f7a0-0000-7000-8000-000000000002'
    const html = markdownToHtml(
      [
        ':::warn',
        '小心 **这里**',
        ':::',
        '',
        '```mermaid',
        'graph TD; A-->B',
        '```',
        '',
        '$$',
        'E=mc^2',
        '$$',
        '',
        `见 [决策甲](xz://entry/${id})`,
      ].join('\n'),
    )
    expect(html).toContain('<aside data-callout="warn"><p>小心 <strong>这里</strong></p>')
    expect(html).toContain('<pre data-mermaid="">graph TD; A--&gt;B</pre>')
    expect(html).toContain('<div data-math="">E=mc^2</div>')
    expect(html).toContain(`<a data-entry-link="${id}" id="${id}" title="决策甲">决策甲</a>`)
  })
})

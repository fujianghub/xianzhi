/** T1-014 · 015 · 016 编辑器（单测层）：schema 全集与往返、未知节点保留、链接白名单、粘贴规则、斜杠过滤。 */
import { getSchema } from '@tiptap/core'
import { Node as PmNodeClass } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'
import { pmToHtmlDocument } from '../../shared/editor/serializers/html.ts'
import { pmToMarkdown } from '../../shared/editor/serializers/markdown.ts'
import { FULL_MARKS, FULL_NODES, type PmNode } from '../../shared/schemas/pm.ts'
import { guardUnknownNodes } from '../editor/extensions.ts'
import { schemaKit } from '../editor/kit.ts'
import {
  externalImages,
  looksLikeMarkdown,
  markdownToHtml,
  sanitizePastedHtml,
} from '../editor/paste.ts'
import { filterSlash, SLASH_ITEMS } from '../editor/slash.tsx'

const schema = getSchema(schemaKit())
const p = (text: string): PmNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** 每种节点一个最小合法样例（03 §3.1）。 */
const SAMPLE: PmNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'a',
          marks: FULL_MARKS.map((m) => ({
            type: m,
            attrs:
              m === 'link'
                ? { href: 'https://x.dev' }
                : m === 'comment'
                  ? { threadId: 't1' }
                  : undefined,
          }))
            .filter((m) => m.type !== 'code')
            .map((m) => (m.attrs ? m : { type: m.type })),
        },
        { type: 'hardBreak' },
        { type: 'mathInline', attrs: { latex: 'x^2' } },
        { type: 'mention', attrs: { id: 'u1', label: 'Ann' } },
        { type: 'entryLink', attrs: { id: 'e1', title: 'E' } },
      ],
    },
    { type: 'blockquote', content: [p('q')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('b')] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('o')] }] },
    {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('t')] }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'rust' },
      content: [{ type: 'text', text: 'fn main() {}' }],
    },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('h')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p('c')] }] },
      ],
    },
    { type: 'image', attrs: { src: 'xz:attachment/abc', width: 10, height: 10 } },
    {
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 's' }] },
        { type: 'detailsContent', content: [p('d')] },
      ],
    },
    { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
    { type: 'callout', attrs: { kind: 'warn' }, content: [p('w')] },
    { type: 'mermaid', attrs: { code: 'graph TD;A-->B' } },
    { type: 'entryCard', attrs: { entryId: 'e2' } },
    {
      type: 'attachment',
      attrs: { attachmentId: 'f1', name: 'a.pdf', size: 10, mime: 'application/pdf' },
    },
    { type: 'toc' },
    { type: 'unknownBlock', attrs: { raw: '{"type":"future"}' } },
  ],
}

describe('editor fullKit', () => {
  it('REQ-EDITOR-001 schema 含 03 §3.1 全部节点与标记，且无字体 / 字号 / 颜色标记', () => {
    const nodes = Object.keys(schema.nodes)
    const marks = Object.keys(schema.marks)
    for (const n of FULL_NODES) expect(nodes, n).toContain(n)
    for (const m of FULL_MARKS) expect(marks, m).toContain(m)
    for (const m of ['textStyle', 'color', 'fontFamily', 'fontSize']) expect(marks).not.toContain(m)
  })

  it('REQ-EDITOR-001 每节点 serializer 往返：fromJSON → toJSON 类型不丢，导出 Markdown / HTML 不抛错', () => {
    const doc = PmNodeClass.fromJSON(schema, SAMPLE)
    doc.check()
    const back = doc.toJSON() as PmNode
    const types = (n: PmNode, acc = new Set<string>()) => {
      acc.add(n.type)
      for (const c of n.content ?? []) types(c, acc)
      return acc
    }
    const got = types(back)
    for (const n of FULL_NODES) expect(got, n).toContain(n)
    expect(pmToMarkdown(back)).toContain('fn main() {}')
    expect(pmToHtmlDocument('x', back)).toContain('<h2')
  })

  it('REQ-EDITOR-016 未知节点保留原 JSON：Y 文档里的 future 节点变为 unknownBlock，Y 元素不被删除', () => {
    const s = getSchema(schemaKit())
    guardUnknownNodes(s)
    const ydoc = new Y.Doc({ gc: false })
    const frag = ydoc.getXmlFragment('default')
    const future = new Y.XmlElement('future')
    future.setAttribute('level', '9')
    const para = new Y.XmlElement('paragraph')
    para.insert(0, [new Y.XmlText('keep')])
    frag.insert(0, [future, para])
    const doc = yXmlFragmentToProseMirrorRootNode(frag, s)
    const first = doc.firstChild
    expect(first?.type.name).toBe('unknownBlock')
    expect(JSON.parse(String(first?.attrs.raw))).toMatchObject({
      type: 'future',
      attrs: { level: '9' },
    })
    expect(frag.length).toBe(2) // 未被 y-prosemirror 删除
    expect((frag.get(0) as Y.XmlElement).nodeName).toBe('future')
  })

  it('REQ-EDITOR-018 Link 配置：javascript: / data: 被拒，http / https / mailto / xz 通过', () => {
    const starter = schemaKit().find((e) => e.name === 'starterKit') as unknown as {
      options: { link: { isAllowedUri: (u: string) => boolean; protocols: string[] } }
    }
    const link = starter.options.link
    expect(link.protocols).toContain('xz')
    expect(link.isAllowedUri('javascript:alert(1)')).toBe(false)
    expect(link.isAllowedUri('data:text/html,x')).toBe(false)
    for (const u of ['https://a.dev', 'http://a.dev', 'mailto:a@b.c', 'xz://entry/1'])
      expect(link.isAllowedUri(u), u).toBe(true)
  })

  it('REQ-EDITOR-005 Markdown 粘贴 → 标题 / 列表 / 表格 / 任务项；含 font color 的 HTML 被剥色；外部图片被识别', () => {
    expect(looksLikeMarkdown('## 标题\n- a')).toBe(true)
    expect(looksLikeMarkdown('普通一句话 - 带连字符')).toBe(false)
    const h = markdownToHtml('## 标题\n- a')
    expect(h).toContain('<h2>标题</h2>')
    expect(h).toContain('<ul>')
    const tbl = markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |\n\n# T')
    expect(tbl).toContain('<table>')
    const todo = markdownToHtml('- [x] done\n- [ ] todo\n\n# T')
    expect(todo).toContain('data-type="taskList"')
    expect(todo).toContain('data-checked="true"')
    const dirty =
      '<p style="color:red"><font color="red" face="Arial">红字</font><span class="x" style="font-size:20px">大</span></p><pre><code class="language-rust hljs">x</code></pre>'
    const clean = sanitizePastedHtml(dirty)
    expect(clean).not.toMatch(/color|font|style|face|size/i)
    expect(clean).toContain('红字')
    expect(clean).toContain('class="language-rust"')
    expect(externalImages('<img src="https://x/y.png"><img src="xz:attachment/1">')).toEqual([
      'https://x/y.png',
    ])
    // 本编辑器复制的片段原样保留
    const own = '<p data-pm-slice="1 1 []" style="x">a</p>'
    expect(sanitizePastedHtml(own)).toBe(own)
  })

  it('REQ-EDITOR-002 斜杠菜单：覆盖 03 §11.1 清单；「表」过滤出表格；最多 8 条', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    for (const id of [
      'h1',
      'h2',
      'h3',
      'h4',
      'bullet',
      'ordered',
      'todo',
      'code',
      'table',
      'image',
      'file',
      'info',
      'tip',
      'warn',
      'danger',
      'mermaid',
      'math',
      'hr',
      'toc',
      'entryLink',
      'card',
      'details',
      'template',
    ])
      expect(ids, id).toContain(id)
    const label = (id: string) => ({ table: '表格' })[id] ?? id
    expect(filterSlash('表', label, (id) => (id === 'table' ? ['表格'] : []))[0]?.id).toBe('table')
    expect(filterSlash('table', label, () => [])[0]?.id).toBe('table')
    expect(filterSlash('', label).length).toBeLessThanOrEqual(8)
    expect(filterSlash('h', label).length).toBeLessThanOrEqual(8)
  })
})

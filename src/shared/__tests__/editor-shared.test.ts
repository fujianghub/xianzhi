/** REQ-EDITOR-016 未知节点保留；REQ-EDITOR-018 链接协议白名单。 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { isAllowedLink } from '../editor/links.ts'
import { unwrapUnknownPm, wrapUnknownPm, yElementToPm } from '../editor/unknown.ts'
import type { PmNode } from '../schemas/pm.ts'

describe('unknown nodes', () => {
  it('REQ-EDITOR-016 未知节点包成 unknownBlock 保留原 JSON，还原后与原文一致', () => {
    const future: PmNode = {
      type: 'future',
      attrs: { x: 1 },
      content: [{ type: 'text', text: '未来' }],
    }
    const doc: PmNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, future],
    }
    const wrapped = wrapUnknownPm(doc, new Set(['doc', 'paragraph']))
    expect(wrapped.content?.[1]).toEqual({
      type: 'unknownBlock',
      attrs: { raw: JSON.stringify(future) },
    })
    expect(unwrapUnknownPm(wrapped)).toEqual(doc)
  })
  it('REQ-EDITOR-016 Y 元素转 PM JSON（未知节点的 raw 来源）保留属性、文本与标记', () => {
    const ydoc = new Y.Doc({ gc: false })
    const frag = ydoc.getXmlFragment('default')
    const el = new Y.XmlElement('future')
    el.setAttribute('level', '3')
    const text = new Y.XmlText()
    text.insert(0, '粗体', { bold: {} })
    el.insert(0, [text])
    frag.insert(0, [el])
    expect(yElementToPm(el)).toEqual({
      type: 'future',
      attrs: { level: '3' },
      content: [{ type: 'text', text: '粗体', marks: [{ type: 'bold', attrs: {} }] }],
    })
  })
})

describe('links', () => {
  it('REQ-EDITOR-018 只允许 http / https / mailto / xz 与站内相对地址', () => {
    for (const ok of [
      'https://a.b',
      'http://x',
      'mailto:a@b.c',
      'xz://entry/1',
      '/entries/1',
      '#h',
    ])
      expect(isAllowedLink(ok), ok).toBe(true)
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:x',
      'java\tscript:x',
      'data:text/html,1',
      'vbscript:x',
      '//evil.com',
      'file:///etc/passwd',
    ])
      expect(isAllowedLink(bad), bad).toBe(false)
  })
})

/**
 * PM JSON → Y.XmlFragment（不依赖 ProseMirror Schema；与 y-prosemirror 的存储约定一致）：
 * 元素 nodeName = node.type、attrs 为 XML 属性；文本为 Y.XmlText，marks 作为格式属性（值为 attrs 或 {}）。
 * 只用于服务端模板注入与测试构造正文；客户端编辑走 Tiptap Collaboration。
 */
import * as Y from 'yjs'
import type { PmNode } from '../shared/schemas/pm.ts'

function toY(node: PmNode): Y.XmlElement | Y.XmlText {
  if (node.type === 'text') {
    const t = new Y.XmlText()
    const format: Record<string, unknown> = {}
    for (const m of node.marks ?? []) format[m.type] = m.attrs ?? {}
    t.insert(0, node.text ?? '', Object.keys(format).length ? format : undefined)
    return t
  }
  const el = new Y.XmlElement(node.type)
  for (const [k, v] of Object.entries(node.attrs ?? {}))
    if (v !== undefined && v !== null) el.setAttribute(k, v as string)
  const children = (node.content ?? []).map(toY)
  if (children.length) el.insert(0, children)
  return el
}

/** 把 doc 的子节点追加到 fragment 末尾（fragment 为空时即整篇注入）。 */
export function appendPmJson(fragment: Y.XmlFragment, doc: PmNode): void {
  const children = (doc.content ?? []).map(toY)
  if (children.length) fragment.insert(fragment.length, children)
}

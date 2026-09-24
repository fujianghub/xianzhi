/**
 * 未知节点保留（03 §3.3、REQ-EDITOR-016）：解析失败的节点不得静默丢弃。
 * - 客户端绑定编辑器前：把 Y 文档里 schema 不认识的元素原地换成 `unknownBlock{ raw }`（raw = 原节点的 JSON），
 *   编辑器显示占位块；y-prosemirror 不会因为认不出节点而删掉它。
 * - 服务端派生 pm_json 时：`unwrapUnknownPm` 把 unknownBlock 还原成原节点，导出 / 搜索 / 升级后的客户端都能拿到原 JSON。
 */
import type { PmNode } from '../schemas/pm.ts'

export const UNKNOWN_BLOCK = 'unknownBlock'

/** PM JSON 层：把 known 集合以外的节点包成 unknownBlock（测试与导入路径用）。 */
export function wrapUnknownPm(node: PmNode, known: ReadonlySet<string>): PmNode {
  if (node.type !== 'text' && !known.has(node.type))
    return { type: UNKNOWN_BLOCK, attrs: { raw: JSON.stringify(node) } }
  return node.content
    ? { ...node, content: node.content.map((c) => wrapUnknownPm(c, known)) }
    : node
}

/** PM JSON 层：unknownBlock → 原节点（raw 解析失败则保留占位本身）。 */
export function unwrapUnknownPm(node: PmNode): PmNode {
  if (node.type === UNKNOWN_BLOCK) {
    try {
      return JSON.parse(String(node.attrs?.raw ?? '')) as PmNode
    } catch {
      return node
    }
  }
  return node.content ? { ...node, content: node.content.map(unwrapUnknownPm) } : node
}

/** 最小 Y.XmlElement / XmlText 接口，避免 shared 依赖 yjs 的具体类（前端传入真实对象）。 */
interface YXmlLike {
  nodeName?: string
  length: number
  toArray(): unknown[]
  getAttributes(): Record<string, unknown>
  toJSON(): unknown
}

/** Y 元素 → PM JSON（未知节点的 raw 用；只取结构、属性与文本）。 */
export function yElementToPm(el: YXmlLike): PmNode {
  const attrs = el.getAttributes()
  const content = el.toArray().map((c) => {
    const x = c as YXmlLike & {
      toDelta?: () => { insert: string; attributes?: Record<string, unknown> }[]
    }
    if (typeof x.toDelta === 'function' && x.nodeName === undefined)
      return x.toDelta().map((d) => ({
        type: 'text',
        text: d.insert,
        ...(d.attributes
          ? {
              marks: Object.entries(d.attributes).map(([type, a]) => ({
                type,
                attrs: a as Record<string, unknown>,
              })),
            }
          : {}),
      }))
    return [yElementToPm(x)]
  })
  return {
    type: el.nodeName ?? 'unknown',
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content: content.flat() as PmNode[] } : {}),
  }
}

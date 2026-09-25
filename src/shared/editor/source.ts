/**
 * Markdown 源码编辑（ADR-0011 §1、REQ-EDITOR-020）：**一次性导入**，不是 Markdown 往返真源（不变量 1）。
 * - 打开：正文按顶层块逐块序列化；Markdown 表达不了的块（附件 / 记录卡片 / 目录 / 折叠块 / 未知节点）以占位行出现。
 * - 保存：解析编辑后的 Markdown 得到新块，逐块再序列化，与原块的 Markdown 做 LCS 配对——
 *   配上的直接沿用原节点（保留 Markdown 表达不了的格式与属性），占位行还原为原块，其余用解析结果。
 *   调用方再以一次 setContent 写回，y-prosemirror 只改真正变化的块。
 */
import type { PmNode } from '../schemas/pm.ts'
import { keyOf, lcsPairs } from './diff.ts'
import { pmToMarkdown } from './serializers/markdown.ts'

/** 源码里原样保留的块类型（Markdown 无对应语法）。 */
export const SOURCE_KEEP_TYPES = new Set([
  'attachment',
  'entryCard',
  'toc',
  'details',
  'unknownBlock',
])

/** 占位行：`⟦xz-keep:<序号>:<类型>⟧`，独占一段。 */
const KEEP_RE = /^⟦xz-keep:(\d+):[\w-]+⟧$/
export const keepToken = (i: number, type: string) => `⟦xz-keep:${i}:${type}⟧`

/** 图片在源码里写成 `xz:attachment/<id>`，解析回来仍是站内附件（07 §2.5）。 */
const blockMd = (n: PmNode) =>
  pmToMarkdown(
    { type: 'doc', content: [n] },
    { resolveImage: (id) => `xz:attachment/${id}` },
  ).trim()

export function toSourceChunks(doc: PmNode): string[] {
  return (doc.content ?? []).map((n, i) =>
    SOURCE_KEEP_TYPES.has(n.type) ? keepToken(i, n.type) : blockMd(n),
  )
}

export function toSource(doc: PmNode): string {
  return `${toSourceChunks(doc)
    .filter((c) => c !== '')
    .join('\n\n')}\n`
}

/** 编辑中出现、且 Markdown 会丢掉的格式（提示用）。 */
export function lossyMarks(doc: PmNode): string[] {
  const found = new Set<string>()
  const LOSSY_MARKS = new Set(['underline', 'highlight', 'subscript', 'superscript', 'comment'])
  const LOSSY_NODES = new Set(['mention', 'mathInline'])
  const walk = (n: PmNode) => {
    for (const m of n.marks ?? []) if (LOSSY_MARKS.has(m.type)) found.add(m.type)
    if (LOSSY_NODES.has(n.type)) found.add(n.type)
    if (n.attrs && 'textAlign' in n.attrs && n.attrs.textAlign && n.attrs.textAlign !== 'left')
      found.add('textAlign')
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
  return [...found]
}

const keepIndex = (n: PmNode): number | null => {
  if (n.type !== 'paragraph' || n.content?.length !== 1) return null
  const t = n.content[0]
  if (t?.type !== 'text' || t.marks?.length) return null
  const m = KEEP_RE.exec((t.text ?? '').trim())
  return m ? Number(m[1]) : null
}

/**
 * 合并：`parsed` 为编辑后 Markdown 解析出的 doc（已按编辑器 schema 过滤）。
 * 返回写回用的 doc 与统计（kept = 沿用原节点数）。
 */
export function mergeSource(
  original: PmNode,
  parsed: PmNode,
): { doc: PmNode; kept: number; changed: number } {
  const orig = original.content ?? []
  const next = parsed.content ?? []
  const origKeys = orig.map((n, i) =>
    SOURCE_KEEP_TYPES.has(n.type) ? keepToken(i, n.type) : blockMd(n),
  )
  const nextKeys = next.map((n) => {
    const k = keepIndex(n)
    return k !== null && orig[k] ? keepToken(k, orig[k].type) : blockMd(n)
  })
  const pairs = lcsPairs(nextKeys, origKeys)
  let kept = 0
  const content = next.map((n, j) => {
    const i = pairs.get(j)
    if (i !== undefined) {
      kept++
      return orig[i] as PmNode
    }
    const k = keepIndex(n)
    if (k !== null && orig[k]) {
      kept++
      return orig[k]
    }
    return n
  })
  const changed = content.length - kept + Math.max(0, orig.length - kept)
  return { doc: { ...parsed, type: 'doc', content }, kept, changed }
}

/** 内容是否真的变了（保存按钮是否需要写回）。 */
export const sameDoc = (a: PmNode, b: PmNode) => keyOf(a.content ?? []) === keyOf(b.content ?? [])

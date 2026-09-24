/**
 * 轻量富文本（liteKit，03 §7）ProseMirror JSON 校验：任务描述与评论用；正文（fullKit）走 Yjs 不经此。
 * 只约束节点 / 标记类型与结构，不校验 attrs 语义（由编辑器 schema 保证）。
 */
import { z } from 'zod'

export const LITE_NODES = [
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'image',
  'mention',
  'entryLink',
  'callout',
  'hardBreak',
] as const
export const LITE_MARKS = ['bold', 'italic', 'strike', 'code', 'link', 'underline'] as const
/** 评论：去掉 heading / callout / image */
/** 正文 fullKit 节点清单（03 §3.1，REQ-EDITOR-001）；unknownBlock 为 §3.3 占位。 */
export const FULL_NODES = [
  'doc',
  'paragraph',
  'text',
  'hardBreak',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'details',
  'detailsSummary',
  'detailsContent',
  'mathBlock',
  'mathInline',
  'callout',
  'mermaid',
  'entryCard',
  'attachment',
  'toc',
  'mention',
  'entryLink',
  'unknownBlock',
] as const
export const FULL_MARKS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'highlight',
  'link',
  'subscript',
  'superscript',
  'comment',
] as const

export const COMMENT_NODES = LITE_NODES.filter(
  (n) => !['heading', 'callout', 'image'].includes(n),
) as unknown as readonly (typeof LITE_NODES)[number][]

const MAX_JSON_BYTES = 100 * 1024

export interface PmNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

function pmSchema(nodes: readonly string[], marks: readonly string[]) {
  const node: z.ZodType<PmNode> = z.lazy(() =>
    z
      .object({
        type: z.enum(nodes as [string, ...string[]]),
        attrs: z.record(z.string(), z.unknown()).optional(),
        content: z.array(node).max(2000).optional(),
        marks: z
          .array(
            z.object({
              type: z.enum(marks as [string, ...string[]]),
              attrs: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .optional(),
        text: z.string().optional(),
      })
      .refine(
        (n) =>
          n.type === 'text'
            ? typeof n.text === 'string' && n.text.length > 0
            : n.text === undefined,
        {
          message: 'text 节点必须有 text，其余节点不得有',
          path: ['text'],
        },
      )
      .refine(
        (n) =>
          n.type !== 'image' ||
          String((n.attrs as { src?: unknown } | undefined)?.src ?? '').startsWith(
            'xz:attachment/',
          ),
        {
          message: 'image.src 只接受 xz:attachment/<id>（07 §2.5）',
          path: ['attrs', 'src'],
        },
      ),
  )
  return z
    .object({ type: z.literal('doc'), content: z.array(node).max(2000).default([]) })
    .refine((d) => JSON.stringify(d).length <= MAX_JSON_BYTES, {
      message: `文档超过 ${MAX_JSON_BYTES} 字节`,
    })
}

export const liteDocSchema = pmSchema(LITE_NODES, LITE_MARKS)
export const commentDocSchema = pmSchema(COMMENT_NODES, LITE_MARKS)
export type LiteDoc = z.infer<typeof liteDocSchema>

/** 纯文本派生（description_plain / body_plain，01 §3.2 §3.9）：与 rebuild-derived 共用。 */
export function pmToPlain(doc: PmNode): string {
  const out: string[] = []
  const walk = (n: PmNode) => {
    if (n.type === 'text') out.push(n.text ?? '')
    else if (n.type === 'hardBreak') out.push('\n')
    else if (n.type === 'mention')
      out.push(`@${String((n.attrs as { label?: unknown } | undefined)?.label ?? '')}`)
    else if (n.type === 'entryLink')
      out.push(String((n.attrs as { title?: unknown } | undefined)?.title ?? ''))
    for (const c of n.content ?? []) walk(c)
    if (['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock', 'callout'].includes(n.type))
      out.push('\n')
  }
  walk(doc)
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 正文内 @ 提及的 userId 抽取（mentions 表来源，01 §3.9）。 */
export function pmMentionUserIds(doc: PmNode): string[] {
  const ids = new Set<string>()
  const walk = (n: PmNode) => {
    if (n.type === 'mention') {
      const id = (n.attrs as { id?: unknown } | undefined)?.id
      if (typeof id === 'string' && id) ids.add(id)
    }
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
  return [...ids]
}

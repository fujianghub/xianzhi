/**
 * liteKit（03 §7、REQ-TASK-015）：任务描述与评论用的轻量富文本，不走 Yjs，存 PM JSON（descriptionPm / bodyPm）。
 * 节点 / 标记与服务端校验（shared/schemas/pm.ts LITE_NODES / COMMENT_NODES）一一对应：
 * - 描述：段落、标题、列表、任务列表、代码块、图片（xz:attachment/）、提及、记录链接、callout、换行
 * - 评论：去掉标题 / callout / 图片（REQ-COMMENT-004）
 * 无表格、mermaid、公式、引用、分割线。
 */
import type { AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mention } from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extension-placeholder'
import { StarterKit } from '@tiptap/starter-kit'
import { AttachmentImage, Callout, EntryLink } from './nodes.ts'

export type LiteVariant = 'description' | 'comment'

export function liteKit(opts: {
  variant: LiteVariant
  placeholder?: string
  mention?: Partial<Parameters<typeof Mention.configure>[0]>
}): AnyExtension[] {
  const comment = opts.variant === 'comment'
  const exts: AnyExtension[] = [
    StarterKit.configure({
      blockquote: false,
      horizontalRule: false,
      heading: comment ? false : { levels: [2, 3] },
      undoRedo: {},
      link: { openOnClick: false, autolink: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Mention.configure({
      HTMLAttributes: { class: 'xz-mention' },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      ...opts.mention,
    }),
    EntryLink,
  ]
  if (!comment) exts.push(AttachmentImage, Callout)
  if (opts.placeholder) exts.push(Placeholder.configure({ placeholder: opts.placeholder }))
  return exts
}

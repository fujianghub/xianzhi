/**
 * liteKit（03 §7、REQ-TASK-015）：任务描述与评论用的轻量富文本，不走 Yjs，存 PM JSON（descriptionPm / bodyPm）。
 * 节点 / 标记与服务端校验（shared/schemas/pm.ts LITE_NODES / COMMENT_NODES）一一对应：
 * - 描述：段落、标题、列表、任务列表、代码块、图片（xz:attachment/）、提及、记录链接、callout、换行
 * - 评论：去掉标题 / callout / 图片（REQ-COMMENT-004）
 * 无表格、mermaid、公式、引用、分割线。
 */
import { type AnyExtension, Extension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mention } from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'
import { AttachmentImage, Callout, EntryLink } from './nodes.ts'
import { UploadPlaceholder } from './upload.ts'

/** 拖入 / 粘贴文件（任务描述贴图，ADR-0043）：只接文件，其余粘贴照 StarterKit 默认 */
function liteFiles(onFiles: (files: File[], at: number) => void) {
  return Extension.create({
    name: 'xzLiteFiles',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('xzLiteFiles'),
          props: {
            handleDrop(view, event) {
              const files = Array.from(event.dataTransfer?.files ?? [])
              if (!files.length) return false
              event.preventDefault()
              const at =
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                view.state.selection.from
              onFiles(files, at)
              return true
            },
            handlePaste(view, event) {
              const files = Array.from(event.clipboardData?.files ?? [])
              if (!files.length) return false
              onFiles(files, view.state.selection.from)
              return true
            },
          },
        }),
      ]
    },
  })
}

export type LiteVariant = 'description' | 'comment'

export function liteKit(opts: {
  variant: LiteVariant
  placeholder?: string
  mention?: Partial<Parameters<typeof Mention.configure>[0]>
  /** 描述可贴图：给出即启用拖入 / 粘贴与上传占位 */
  onFiles?: (files: File[], at: number) => void
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
  if (!comment && opts.onFiles) exts.push(UploadPlaceholder, liteFiles(opts.onFiles))
  if (opts.placeholder) exts.push(Placeholder.configure({ placeholder: opts.placeholder }))
  return exts
}

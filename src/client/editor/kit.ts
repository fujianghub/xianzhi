/**
 * fullKit（03 §3.1 · §4.3，T1-014）：StarterKit（协同下关闭 undoRedo，撤销走 Yjs 栈）+ Collaboration / Caret
 * + 全部官方与自定义节点（节点视图见 views.tsx）+ 行为扩展（快捷键 / 粘贴 / 上传占位 / 斜杠菜单 / 未知节点兜底）。
 * 不提供字体 / 字号 / 颜色标记（03 §3.1、REQ-EDITOR-001）。
 */
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type { AnyExtension } from '@tiptap/core'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mention } from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TextAlign } from '@tiptap/extension-text-align'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import type * as Y from 'yjs'
import { isAllowedLink } from '../../shared/editor/links.ts'
import { CalloutView } from './CalloutView.tsx'
import {
  createEntryLinkTrigger,
  createPastePlugin,
  GiKeymap,
  HeadingNumbers,
  UnknownGuard,
} from './extensions.ts'
import { lowlight } from './lowlight.ts'
import { TextColor, XzHighlight } from './marks.ts'
import {
  AttachmentImage,
  AttachmentNode,
  Callout,
  CommentMark,
  EntryCard,
  EntryLink,
  EntryQuery,
  LinkCard,
  MathBlock,
  MathInline,
  Mermaid,
  Toc,
  UnknownBlock,
} from './nodes.ts'
import { createSlash, type SlashCtx } from './slash.tsx'
import { UploadPlaceholder } from './upload.ts'
import { LinkCardView } from './views/LinkCardView.tsx'
import { MathBlockView, MathInlineView } from './views/MathView.tsx'
import { MermaidView } from './views/MermaidView.tsx'

/** 节点视图内的源码编辑区（data-stop-pm）与表单控件自己处理事件，不交给 ProseMirror。 */
const stopInEditor = ({ event }: { event: Event }) => {
  const el = event.target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('[data-stop-pm]') || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)
}

import { EntryQueryView } from './EntryQueryView.tsx'
import {
  AttachmentView,
  CodeBlockView,
  EntryCardView,
  ImageView,
  TocView,
  UnknownBlockView,
} from './views.tsx'

export const YDOC_FIELD = 'default'

/** 纯 schema 部分（无协同 / 无 DOM 行为），单测与 fullKit 共用。 */
export function schemaKit(opts: { placeholder?: string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ['xz'],
        defaultProtocol: 'https',
        isAllowedUri: (url) => isAllowedLink(url),
        shouldAutoLink: (url) => isAllowedLink(url),
      },
    }),
    CodeBlockLowlight.extend({
      addNodeView: () => ReactNodeViewRenderer(CodeBlockView),
    }).configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    XzHighlight,
    TextColor,
    Subscript,
    Superscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Mention.configure({
      HTMLAttributes: { class: 'xz-mention' },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    }),
    AttachmentImage.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
    AttachmentNode.extend({ addNodeView: () => ReactNodeViewRenderer(AttachmentView) }),
    EntryLink,
    EntryCard.extend({ addNodeView: () => ReactNodeViewRenderer(EntryCardView) }),
    // 网页卡片（ADR-0054 §D）：网址输入框与模式菜单的按键 / 点击交给节点视图
    LinkCard.extend({
      addNodeView: () => ReactNodeViewRenderer(LinkCardView, { stopEvent: stopInEditor }),
    }),
    // 查询块（ADR-0033）：标题栏的按钮 / 下拉交给节点视图，不交给 ProseMirror
    EntryQuery.extend({
      addNodeView: () => ReactNodeViewRenderer(EntryQueryView, { stopEvent: stopInEditor }),
    }),
    Callout.extend({ addNodeView: () => ReactNodeViewRenderer(CalloutView) }),
    // 图表 / 公式（ADR-0025 §8）：视图内部再懒加载 mermaid / katex / CodeMirror；编辑区里的按键不交给 ProseMirror
    Mermaid.extend({
      addNodeView: () => ReactNodeViewRenderer(MermaidView, { stopEvent: stopInEditor }),
    }),
    MathBlock.extend({
      addNodeView: () => ReactNodeViewRenderer(MathBlockView, { stopEvent: stopInEditor }),
    }),
    MathInline.extend({
      addNodeView: () =>
        ReactNodeViewRenderer(MathInlineView, { as: 'span', stopEvent: stopInEditor }),
    }),
    Toc.extend({ addNodeView: () => ReactNodeViewRenderer(TocView) }),
    UnknownBlock.extend({ addNodeView: () => ReactNodeViewRenderer(UnknownBlockView) }),
    CommentMark,
    UnknownGuard,
    GiKeymap,
    Placeholder.configure({ placeholder: opts.placeholder ?? '' }),
  ]
}

export function fullKit(opts: {
  ydoc: Y.Doc
  provider: HocuspocusProvider | null
  user: { name: string; color: string }
  placeholder: string
  slash: () => SlashCtx
  onFiles: (files: File[], at: number) => void
}): AnyExtension[] {
  const exts: AnyExtension[] = [
    ...schemaKit({ placeholder: opts.placeholder }),
    Collaboration.configure({ document: opts.ydoc, field: YDOC_FIELD }),
    UploadPlaceholder,
    HeadingNumbers,
    createPastePlugin({ onFiles: opts.onFiles }),
    createSlash(opts.slash),
    createEntryLinkTrigger((at) => opts.slash().pickEntry('link', at)),
  ]
  if (opts.provider)
    exts.push(CollaborationCaret.configure({ provider: opts.provider, user: opts.user }))
  return exts
}

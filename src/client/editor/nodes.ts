/**
 * 编辑器自定义节点（03 §3.1 §3.2，Phase 0 最小集）：与服务端模板 / seed 产出的节点一一对应，保证 y-prosemirror 不丢弃内容。
 * entryLink（行内原子）、callout（块）、mermaid / mathBlock（原子占位，渲染在 Phase 2）、image（只接受 xz:attachment/，07 §2.5）。
 */
import { Mark, mergeAttributes, Node } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'

export const EntryLink = Node.create({
  name: 'entryLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ id: { default: null }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'a[data-entry-link]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'a',
    mergeAttributes(HTMLAttributes, {
      'data-entry-link': node.attrs.id,
      href: `/entries/${node.attrs.id}`,
      class: 'xz-entry-link',
    }),
    `[[${node.attrs.title || node.attrs.id}]]`,
  ],
  renderText: ({ node }) => String(node.attrs.title ?? ''),
})

export const CALLOUT_KINDS = ['info', 'tip', 'warn', 'danger'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({
    kind: {
      default: 'info',
      // 03 §3.2：info / tip / warn / danger，其他值回退 info
      parseHTML: (el: HTMLElement) => {
        const k = el.getAttribute('data-callout') ?? 'info'
        return CALLOUT_KINDS.includes(k as CalloutKind) ? k : 'info'
      },
    },
  }),
  parseHTML: () => [{ tag: 'aside[data-callout]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'aside',
    mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs.kind, class: 'xz-callout' }),
    0,
  ],
})

export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  // 解析：渲染时 code 写成文本子节点，粘贴 / Markdown 导入时从 textContent 取回
  addAttributes: () => ({
    code: { default: '', parseHTML: (el: HTMLElement) => el.textContent ?? '' },
  }),
  parseHTML: () => [{ tag: 'pre[data-mermaid]', priority: 60 }], // 先于 codeBlock 的 pre 规则
  renderHTML: ({ node, HTMLAttributes }) => [
    'pre',
    mergeAttributes(HTMLAttributes, { 'data-mermaid': '', class: 'xz-atom' }),
    node.attrs.code,
  ],
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    latex: { default: '', parseHTML: (el: HTMLElement) => el.textContent ?? '' },
  }),
  parseHTML: () => [{ tag: 'div[data-math]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-math': '', class: 'xz-atom' }),
    node.attrs.latex,
  ],
})

/** image.src 只接受 xz:attachment/<id>；渲染时解析为 /api/v1/attachments/<id>/md（02 §7）。 */
export const AttachmentImage = Image.extend({
  // 解析 HTML 只认 xz:attachment/（自家复制 data-src 或 src），外域 / data: 图片在 schema 层被拒（03 §3.2、07 §2.5）
  parseHTML() {
    return [
      {
        tag: 'img[data-src^="xz:attachment/"]',
        getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('data-src') }),
      },
      { tag: 'img[src^="xz:attachment/"]' },
    ]
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
      blurhash: { default: null },
      // 展示（REQ-EDITOR-021）：宽度百分比（null = 原始尺寸，不超过正文宽）、对齐、图注
      displayWidth: { default: null },
      align: { default: null },
      caption: { default: '' },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? '')
    const resolved = src.startsWith('xz:attachment/')
      ? `/api/v1/attachments/${src.slice('xz:attachment/'.length)}/md`
      : ''
    return [
      'img',
      mergeAttributes(HTMLAttributes, { src: resolved, 'data-src': src, loading: 'lazy' }),
    ]
  },
}).configure({ inline: false, allowBase64: false })

/** 非图片附件卡片（03 §3.2）：名称 / 大小 / 下载；视图见 views.tsx。 */
export const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    attachmentId: { default: null },
    name: { default: '' },
    size: { default: 0 },
    mime: { default: '' },
  }),
  parseHTML: () => [{ tag: 'div[data-attachment]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      'data-attachment': node.attrs.attachmentId,
      class: 'xz-atom',
    }),
    String(node.attrs.name ?? ''),
  ],
})

/** 记录卡片（03 §3.2 entryCard）：数据来自 GET /entries/:id/preview。 */
export const EntryCard = Node.create({
  name: 'entryCard',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ entryId: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-entry-card]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-entry-card': node.attrs.entryId }),
  ],
})

/** 目录（03 §3.2 toc）：atom，渲染时读当前文档标题。 */
export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  parseHTML: () => [{ tag: 'nav[data-toc]' }],
  renderHTML: ({ HTMLAttributes }) => ['nav', mergeAttributes(HTMLAttributes, { 'data-toc': '' })],
})

/** 行内公式（03 §3.1 mathInline）：KaTeX 渲染属 Phase 2，一期显示源码。 */
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-math-inline]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-math-inline': '', class: 'xz-atom-inline' }),
    `$${node.attrs.latex}$`,
  ],
})

/** 未知节点占位（03 §3.3、REQ-EDITOR-016）：raw 保存原 JSON，落库派生时还原。 */
export const UnknownBlock = Node.create({
  name: 'unknownBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ raw: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-unknown-block]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      'data-unknown-block': '',
      'data-raw': node.attrs.raw,
      class: 'xz-atom',
    }),
  ],
})

/** 评论锚点标记（03 §3.2）：只存 threadId；正文在 comments 表（T1-023 接入侧栏）。 */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes: () => ({ threadId: { default: null } }),
  parseHTML: () => [
    {
      tag: 'span[data-comment]',
      getAttrs: (el) => ({ threadId: (el as HTMLElement).getAttribute('data-comment') }),
    },
  ],
  renderHTML: ({ HTMLAttributes, mark }) => [
    'span',
    mergeAttributes(HTMLAttributes, {
      'data-comment': mark.attrs.threadId,
      class: 'xz-comment-mark',
    }),
    0,
  ],
})

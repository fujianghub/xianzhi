/**
 * 编辑器行为扩展（03 §11.2 · §11.3 · §3.3）：
 * - GiKeymap：Mod+Shift+1..4 / 0 标题与正文、Mod+S 吞掉、Mod+K 链接、Mod+Alt+↑/↓ 块移动；`:::kind ` 转 callout。
 *   其余快捷键（Mod+B/I/U/E、Mod+Shift+7/8/9、Mod+Alt+C、Mod+Shift+H）由 StarterKit / 官方扩展默认提供。
 * - UnknownGuard：包装 schema.node，未知节点建成 unknownBlock{raw}，防止 y-tiptap 解析失败时删除 Y 元素（REQ-EDITOR-016）。
 * - GiPaste：Markdown 启发式、HTML 净化、外部图片提示、2MB 截断、文件交给上传流程（REQ-EDITOR-005）。
 * 所有自定义 inputRule 走 Tiptap InputRule（内部已判 view.composing，03 §12 IME）。
 */
import { type Editor, Extension, InputRule } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import i18n from 'i18next'
import { toast } from 'sonner'
import { UNKNOWN_BLOCK } from '../../shared/editor/unknown.ts'
import { CALLOUT_KINDS } from './nodes.ts'
import {
  externalImages,
  looksLikeMarkdown,
  markdownToHtml,
  PASTE_MAX_CHARS,
  sanitizePastedHtml,
} from './paste.ts'

/** Mod+K 与浮动工具条共享：打开链接输入框。 */
export const LINK_EVENT = 'xz:editor-link'

/** 把当前顶层块与相邻块交换（Mod+Alt+↑/↓）。 */
function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor
  const $from = state.selection.$from
  if ($from.depth < 1) return false
  const index = $from.index(0)
  const target = index + dir
  if (target < 0 || target >= state.doc.childCount) return false
  const start = $from.before(1)
  const node = state.doc.child(index)
  const other = state.doc.child(target)
  const offset = state.selection.from - start
  const tr = state.tr
  if (dir === -1) {
    const otherStart = start - other.nodeSize
    tr.delete(start, start + node.nodeSize).insert(otherStart, node)
    tr.setSelection(
      TextSelection.create(tr.doc, Math.min(otherStart + offset, tr.doc.content.size)),
    )
  } else {
    tr.delete(start, start + node.nodeSize)
    const insertAt = start + other.nodeSize
    tr.insert(insertAt, node)
    tr.setSelection(TextSelection.create(tr.doc, Math.min(insertAt + offset, tr.doc.content.size)))
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

export const GiKeymap = Extension.create({
  name: 'giKeymap',
  addKeyboardShortcuts() {
    const heading = (level: 1 | 2 | 3 | 4) => () =>
      this.editor.chain().focus().toggleHeading({ level }).run()
    return {
      'Mod-Shift-1': heading(1),
      'Mod-Shift-2': heading(2),
      'Mod-Shift-3': heading(3),
      'Mod-Shift-4': heading(4),
      'Mod-Shift-0': () => this.editor.chain().focus().setParagraph().run(),
      // 自动保存：吞掉浏览器「另存为」，提示已同步（03 §11.2）
      'Mod-s': () => {
        toast.success(i18n.t('ui.statusPill.synced'), { duration: 1000 })
        return true
      },
      'Mod-k': () => {
        const { from, to, empty } = this.editor.state.selection
        if (empty) return false
        const text = this.editor.state.doc.textBetween(from, to).trim()
        if (/^(https?:\/\/|mailto:)\S+$/i.test(text)) {
          this.editor.chain().focus().setLink({ href: text }).run()
          return true
        }
        window.dispatchEvent(new CustomEvent(LINK_EVENT))
        return true
      },
      'Mod-Alt-ArrowUp': () => moveBlock(this.editor, -1),
      'Mod-Alt-ArrowDown': () => moveBlock(this.editor, 1),
    }
  },
  addInputRules() {
    // `:::warn ` → callout（03 §11.2、REQ-EDITOR-009）
    return [
      new InputRule({
        find: new RegExp(`^:::(${CALLOUT_KINDS.join('|')})\\s$`),
        handler: ({ range, match, chain }) => {
          chain().deleteRange(range).wrapIn('callout', { kind: match[1] }).run()
        },
      }),
    ]
  },
})

/** schema.node 包装：未知类型 → unknownBlock{raw}。y-tiptap 以此建节点，之后会把 Y 元素替换为占位（raw 保留原 JSON）。 */
export function guardUnknownNodes(schema: Schema) {
  const s = schema as Schema & { __giGuard?: boolean }
  if (s.__giGuard || !schema.nodes[UNKNOWN_BLOCK]) return
  s.__giGuard = true
  const orig = schema.node.bind(schema)
  schema.node = ((type, attrs, content, marks) => {
    if (typeof type === 'string' && !schema.nodes[type]) {
      const kids = Array.isArray(content)
        ? content
        : content && 'forEach' in content
          ? (() => {
              const a: unknown[] = []
              ;(content as { forEach: (f: (n: unknown) => void) => void }).forEach((n) => {
                a.push(n)
              })
              return a
            })()
          : content
            ? [content]
            : []
      const raw = JSON.stringify({
        type,
        ...(attrs && Object.keys(attrs).length ? { attrs } : {}),
        ...(kids.length
          ? { content: kids.map((k) => (k as { toJSON: () => unknown }).toJSON()) }
          : {}),
      })
      return orig(UNKNOWN_BLOCK, { raw })
    }
    return orig(type, attrs, content, marks)
  }) as Schema['node']
}

export const UnknownGuard = Extension.create({
  name: 'giUnknownGuard',
  onBeforeCreate() {
    guardUnknownNodes(this.editor.schema)
  },
})

export function createPastePlugin(opts: { onFiles: (files: File[], at: number) => void }) {
  return Extension.create({
    name: 'giPaste',
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          key: new PluginKey('giPaste'),
          props: {
            transformPastedHTML(html) {
              if (externalImages(html).length) toast(i18n.t('editor.externalImageDropped'))
              return sanitizePastedHtml(html)
            },
            handleDrop(view, event) {
              const files = Array.from(event.dataTransfer?.files ?? [])
              if (!files.length) return false
              event.preventDefault()
              const at =
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                view.state.selection.from
              opts.onFiles(files, at)
              return true
            },
            handlePaste(view, event) {
              const cd = event.clipboardData
              if (!cd) return false
              const files = Array.from(cd.files ?? [])
              if (files.length) {
                opts.onFiles(files, view.state.selection.from)
                return true
              }
              const html = cd.getData('text/html')
              let text = cd.getData('text/plain')
              if (text.length > PASTE_MAX_CHARS) {
                text = text.slice(0, PASTE_MAX_CHARS)
                toast(i18n.t('editor.pasteTruncated'))
                if (!html) {
                  editor.commands.insertContent(
                    text.split(/\n{2,}/).map((p) => ({
                      type: 'paragraph',
                      content: p ? [{ type: 'text', text: p }] : [],
                    })),
                  )
                  return true
                }
              }
              // 在代码块内原样粘贴
              if (view.state.selection.$from.parent.type.spec.code) return false
              if (!html && looksLikeMarkdown(text)) {
                editor.commands.insertContent(markdownToHtml(text), {
                  parseOptions: { preserveWhitespace: false },
                })
                return true
              }
              return false
            },
          },
        }),
      ]
    },
  })
}

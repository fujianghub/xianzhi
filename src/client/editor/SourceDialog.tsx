/**
 * Markdown 源码编辑（ADR-0011 §1、REQ-EDITOR-020）：CodeMirror 6 编辑本篇正文的 Markdown 源码，保存时一次性导入。
 * - 打开时按块序列化（shared/editor/source.ts），Markdown 表达不了的块以 `⟦xz-keep:…⟧` 占位行出现；
 * - 保存：先打「源码编辑前」标记快照（可在历史里恢复），再解析 → 与原块 LCS 合并 → setContent（y-prosemirror 只改变化的块）；
 * - 有其他协作者在线时不可用（一次整体写回会与他人并发编辑交错），由调用方禁用入口。
 * CodeMirror 随本组件懒加载；@codemirror/state、view 已在 vite dedupe（简斋多实例崩溃教训，03 §12）。
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { DOMParser as PmDOMParser } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { lossyMarks, mergeSource, sameDoc, toSource } from '../../shared/editor/source.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { api, unwrap } from '../lib/api.ts'
import { markdownToHtml } from './paste.ts'

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--xz-palette-blue-fg)', fontWeight: '600' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '600' },
  { tag: [tags.link, tags.url], color: 'var(--xz-primary-text)' },
  { tag: [tags.monospace], color: 'var(--xz-palette-orange-fg)' },
  { tag: [tags.quote], color: 'var(--xz-fg-muted)', fontStyle: 'italic' },
  {
    tag: [tags.processingInstruction, tags.meta, tags.list, tags.contentSeparator],
    color: 'var(--xz-fg-muted)',
  },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
])

const theme = EditorView.theme({
  '&': { color: 'var(--xz-fg)', backgroundColor: 'transparent', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--xz-font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--xz-fg)', padding: '12px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--xz-fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--xz-primary-soft)',
  },
  '.cm-placeholder': { color: 'var(--xz-fg-faint)' },
})

/** 编辑后 Markdown → 编辑器 schema 下的 PM JSON（与粘贴同一条 markdown-it 管线，schema 过滤非法内容）。 */
function parseMarkdown(editor: Editor, src: string): PmNode {
  const dom = document.createElement('div')
  dom.innerHTML = markdownToHtml(src)
  return PmDOMParser.fromSchema(editor.schema).parse(dom).toJSON() as PmNode
}

export default function SourceDialog({
  editor,
  entryId,
  open,
  onOpenChange,
}: {
  editor: Editor
  entryId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [busy, setBusy] = useState(false)
  const original = useMemo(
    () => (open && !editor.isDestroyed ? (editor.getJSON() as PmNode) : null),
    [open, editor],
  )
  const lossy = useMemo(() => (original ? lossyMarks(original) : []), [original])

  useEffect(() => {
    if (!open || !original) return
    // Dialog 内容挂载后才有 host
    const id = requestAnimationFrame(() => {
      if (!host.current) return
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: toSource(original),
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            markdown(),
            syntaxHighlighting(highlight),
            EditorView.lineWrapping,
            placeholder(t('editor.source.placeholder')),
            theme,
          ],
        }),
      })
      view.current.focus()
    })
    return () => {
      cancelAnimationFrame(id)
      view.current?.destroy()
      view.current = null
    }
  }, [open, original, t])

  const save = async () => {
    const v = view.current
    if (!v || !original || editor.isDestroyed) return
    const parsed = parseMarkdown(editor, v.state.doc.toString())
    const merged = mergeSource(original, parsed)
    if (sameDoc(merged.doc, original)) {
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      await unwrap(
        api.entries[':id'].snapshots.$post({
          param: { id: entryId },
          json: { label: t('editor.source.snapshotLabel') },
        }),
      )
      editor.commands.setContent(merged.doc, { emitUpdate: true })
      toast.success(t('editor.source.saved'))
      onOpenChange(false)
    } catch {
      toast.error(t('editor.source.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[88vh] w-[min(96vw,64rem)] flex-col"
        data-testid="source-dialog"
      >
        <DialogTitle>{t('editor.source.title')}</DialogTitle>
        <DialogDescription className="mt-1 text-fg-muted text-xs">
          {t('editor.source.hint')}
        </DialogDescription>
        {lossy.length ? (
          <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-xs" role="note">
            {t('editor.source.lossy', {
              list: lossy.map((k) => t(`editor.source.lossyKind.${k}`)).join('、'),
            })}
          </p>
        ) : null}
        <div
          ref={host}
          data-testid="source-editor"
          className="mt-3 min-h-0 flex-1 overflow-hidden rounded-md border border-border px-3 text-sm"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('ui.action.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={save} data-testid="source-save">
            {t('editor.source.apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

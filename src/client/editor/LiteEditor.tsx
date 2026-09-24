/**
 * 轻量富文本编辑器（03 §7、REQ-TASK-015）：任务描述 / 评论；不走 Yjs，value / onChange 为 PM JSON。
 * 描述：失焦保存（由调用方决定是否发请求）；评论：Enter 提交、Shift+Enter 换行（REQ-COMMENT-004）。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn.ts'
import { type LiteVariant, liteKit } from './liteKit.ts'
import { type MentionCandidate, mentionSuggestion } from './mention.tsx'

export default function LiteEditor({
  value,
  variant,
  placeholder,
  onBlur,
  onSubmit,
  editable = true,
  className,
  testId,
  autofocus,
  mentionCandidates,
}: {
  value: unknown
  variant: LiteVariant
  placeholder?: string
  onBlur?: (doc: unknown, changed: boolean) => void
  /** 返回 false 表示发送失败，不清空；其余情况（评论）发送后清空输入 */
  onSubmit?: (doc: unknown) => unknown
  editable?: boolean
  className?: string
  testId?: string
  autofocus?: boolean
  /** @ 提及候选（当前空间可读成员，T1-024） */
  mentionCandidates?: MentionCandidate[]
}) {
  const candidates = useRef<MentionCandidate[]>(mentionCandidates ?? [])
  candidates.current = mentionCandidates ?? []
  const suggesting = useRef(false)
  const submit = async () => {
    const ed = editor
    if (!ed || ed.isEmpty || !onSubmit) return
    const r = await onSubmit(ed.getJSON())
    if (r !== false && variant === 'comment' && !ed.isDestroyed) ed.commands.clearContent(true)
  }
  const editor = useEditor({
    extensions: liteKit({
      variant,
      placeholder,
      mention: mentionSuggestion(() => candidates.current, suggesting),
    }),
    content: (value as object | null) ?? '',
    editable,
    autofocus: autofocus ? 'end' : false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn('xz-prose min-h-16 outline-none', className),
        'data-testid': testId ?? 'lite-editor',
      },
      handleKeyDown: (_view, e) => {
        // 候选框打开时 Enter / 方向键交给 suggestion
        if (suggesting.current) return false
        if (variant === 'comment' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault()
          void submit()
          return true
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          void submit()
          return true
        }
        return false
      },
    },
    onBlur: ({ editor: ed }) => {
      const doc = ed.getJSON()
      onBlur?.(ed.isEmpty ? null : doc, JSON.stringify(doc) !== JSON.stringify(value ?? null))
    },
  })
  useEffect(() => {
    if (editor && !editor.isFocused && value !== undefined)
      editor.commands.setContent((value as object | null) ?? '', { emitUpdate: false })
  }, [editor, value])
  useEffect(() => editor?.setEditable(editable), [editor, editable])
  return <EditorContent editor={editor} />
}

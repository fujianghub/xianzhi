/**
 * 轻量富文本编辑器（03 §7、REQ-TASK-015）：任务描述 / 评论；不走 Yjs，value / onChange 为 PM JSON。
 * 描述：失焦保存（由调用方决定是否发请求）；评论：Enter 提交、Shift+Enter 换行（REQ-COMMENT-004）。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import { ImagePlus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_JSON_BYTES } from '../../shared/schemas/pm.ts'
import { cn } from '../lib/cn.ts'
import { type LiteVariant, liteKit } from './liteKit.ts'
import { type MentionCandidate, mentionSuggestion } from './mention.tsx'
import { pickFiles, uploadFiles } from './upload.ts'

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
  uploadTaskId,
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
  /** 任务描述可贴图（ADR-0043、REQ-TASK-028）：拖入 / 粘贴 / 按钮上传为该任务的附件，插入后立即保存 */
  uploadTaskId?: string
}) {
  const { t } = useTranslation()
  const candidates = useRef<MentionCandidate[]>(mentionCandidates ?? [])
  candidates.current = mentionCandidates ?? []
  const suggesting = useRef(false)
  const submit = async () => {
    const ed = editor
    if (!ed || ed.isEmpty || !onSubmit) return
    const r = await onSubmit(ed.getJSON())
    if (r !== false && variant === 'comment' && !ed.isDestroyed) ed.commands.clearContent(true)
  }
  const edRef = useRef<ReturnType<typeof useEditor>>(null)
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  // 上传完成插入图片后立即保存（失焦保存可能早已发生）
  const upload = (files: File[], at: number) => {
    const ed = edRef.current
    if (!ed || ed.isDestroyed || !uploadTaskId) return
    uploadFiles(ed, files, at, {
      taskId: uploadTaskId,
      imagesOnly: true,
      maxJsonBytes: MAX_JSON_BYTES,
      onInserted: () => {
        const cur = edRef.current
        if (cur && !cur.isDestroyed) onBlurRef.current?.(cur.getJSON(), true)
      },
    })
  }
  const editor = useEditor({
    extensions: liteKit({
      variant,
      placeholder,
      mention: mentionSuggestion(() => candidates.current, suggesting),
      ...(uploadTaskId ? { onFiles: upload } : {}),
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
  edRef.current = editor
  useEffect(() => editor?.setEditable(editable), [editor, editable])
  if (!uploadTaskId || !editable) return <EditorContent editor={editor} />
  return (
    <div className="flex flex-col gap-1">
      <EditorContent editor={editor} />
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-fg-muted text-xs hover:bg-hover hover:text-fg"
        onClick={() =>
          pickFiles('image/*', (files) =>
            upload(files, editor?.state.selection.from ?? editor?.state.doc.content.size ?? 0),
          )
        }
        data-testid="lite-insert-image"
      >
        <ImagePlus className="size-3.5" aria-hidden />
        {t('task.insertImage')}
      </button>
    </div>
  )
}

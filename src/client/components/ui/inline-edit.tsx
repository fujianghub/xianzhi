/**
 * 就地编辑（04 §5 InlineEdit、REQ-UI-022）：看起来是文本，点击即编辑；失焦 / Enter 保存（值未变不发请求），Esc 放弃。
 */
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn.ts'

export function InlineEdit({
  value,
  onSave,
  label,
  className,
  multiline = false,
  testId,
}: {
  value: string
  onSave: (v: string) => Promise<unknown> | unknown
  label: string
  className?: string
  multiline?: boolean
  testId?: string
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(value), [value])
  // 自适应高度
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  })
  const commit = async () => {
    const v = draft.trim()
    if (!v || v === value) {
      setDraft(value)
      return
    }
    await onSave(v)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setDraft(value)
      e.currentTarget.blur()
      e.stopPropagation()
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cn(
        'w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-border focus:border-selected-border focus:bg-surface',
        className,
      )}
      data-testid={testId}
    />
  )
}

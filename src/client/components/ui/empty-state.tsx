/**
 * 空状态（04 §6、06 §5.5、REQ-UI-009）：线稿插画（currentColor 随主题）+ 一句话 + 可直接输入的主操作。
 * 隐喻只出现在命名与空状态（glossary）。
 */
import { type FormEvent, type ReactNode, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { Input } from './input.tsx'

export type Illustration = 'today' | 'inbox' | 'board' | 'entries' | 'search' | 'trash'

function Art({ kind }: { kind: Illustration }) {
  // 枝条 + 巢的变体（衔枝筑巢，glossary §2）：不同页面在枝头换一个小物件
  const extra =
    kind === 'search' ? (
      <circle cx="44" cy="22" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : kind === 'inbox' ? (
      <path d="M36 14h16v10H36z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : kind === 'trash' ? (
      <path d="M38 14h12l-2 12h-8z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : kind === 'entries' ? (
      <path
        d="M38 12h12v16H38zM41 17h6M41 21h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ) : null
  return (
    <svg viewBox="0 0 64 64" className="size-24 text-fg-faint" aria-hidden>
      {/* 斜出的枝条与两片叶 */}
      <path d="M6 40C18 36 28 30 40 20" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path d="M18 34c-2-5 1-8 5-8-1 4-2 7-5 8z" fill="currentColor" opacity=".55" />
      <path d="M28 28c0-5 4-7 7-6-2 3-3 5-7 6z" fill="currentColor" opacity=".55" />
      {/* 枝下的半个巢 */}
      <path d="M10 48c4 8 20 8 24 0" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M12 50h20M14 53h16" stroke="currentColor" strokeWidth="1" opacity=".6" />
      {kind === 'board' || kind === 'today' ? (
        <path d="M40 20l6-3" stroke="currentColor" strokeWidth="1.8" />
      ) : null}
      {extra}
    </svg>
  )
}

export function EmptyState({
  illustration,
  title,
  hint,
  input,
  action,
  className,
  testId = 'empty-state',
}: {
  illustration: Illustration
  title: string
  hint?: string
  /** 可直接输入的主操作：回车提交，成功后清空 */
  input?: {
    placeholder: string
    onSubmit: (text: string) => Promise<unknown> | unknown
    label?: string
  }
  action?: ReactNode
  className?: string
  testId?: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (!v || !input) return
    setBusy(true)
    try {
      await input.onSubmit(v)
      setText('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className={cn('mx-auto flex max-w-md flex-col items-center py-10 text-center', className)}
      data-testid={testId}
    >
      <Art kind={illustration} />
      <h2 className="mt-3 font-semibold text-lg">{title}</h2>
      {hint ? <p className="mt-1 text-fg-muted text-sm">{hint}</p> : null}
      {input ? (
        <form onSubmit={submit} className="mt-5 w-full">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={input.placeholder}
            aria-label={input.label ?? input.placeholder}
            disabled={busy}
            data-testid="empty-input"
          />
        </form>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/**
 * 空状态（04 §6、06 §5.5、REQ-UI-009）：线稿插画（currentColor 随主题）+ 一句话 + 可直接输入的主操作。
 * 隐喻只出现在命名与空状态（glossary）。
 */
import { type FormEvent, type ReactNode, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { Input } from './input.tsx'

export type Illustration =
  | 'today'
  | 'inbox'
  | 'board'
  | 'entries'
  | 'search'
  | 'trash'
  | 'spaces'
  | 'tags'
  | 'tree'
  | 'calendar'

function Art({ kind, small }: { kind: Illustration; small?: boolean }) {
  // 枝条 + 巢的变体（衔枝筑巢，glossary §2）：不同页面在枝头换一个小物件
  const extra =
    kind === 'search' ? (
      <circle cx="44" cy="22" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : kind === 'inbox' ? (
      <path d="M36 14h16v10H36z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : kind === 'trash' ? (
      <path d="M38 14h12l-2 12h-8z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : kind === 'spaces' ? (
      // 枝头挂两只小匣（空间）
      <path
        d="M36 14h8v7h-8zM46 18h7v6h-7zM40 14v-3M49.5 18v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ) : kind === 'tags' ? (
      <path
        d="M38 12h8l5 5-6 6-7-7zM41.5 15.5h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    ) : kind === 'tree' ? (
      // 一根枝分三杈（目录）
      <path
        d="M40 20v-8M40 12h8M40 16h6M40 20h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    ) : kind === 'calendar' ? (
      <path
        d="M37 13h14v13H37zM37 17h14M41 11v4M47 11v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ) : kind === 'entries' ? (
      <path
        d="M38 12h12v16H38zM41 17h6M41 21h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ) : null
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('relative text-fg-faint', small ? 'size-14' : 'size-24')}
      aria-hidden
    >
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
  size = 'md',
  testId = 'empty-state',
}: {
  illustration: Illustration
  /** sm：面板 / 设置页 / 侧栏内的紧凑版（ADR-0046） */
  size?: 'sm' | 'md'
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
      className={cn(
        'xz-rise mx-auto flex max-w-md flex-col items-center text-center',
        size === 'sm' ? 'py-6' : 'py-10',
        className,
      )}
      data-testid={testId}
    >
      {/* 06 §4：插画背后静态 glow-1 光晕（径向渐变，不用 filter） */}
      <div className="xz-empty-art">
        <Art kind={illustration} small={size === 'sm'} />
      </div>
      <h2 className={cn('mt-3 font-semibold', size === 'sm' ? 'text-sm' : 'text-lg')}>{title}</h2>
      {hint ? (
        <p className={cn('mt-1 text-fg-muted', size === 'sm' ? 'text-xs' : 'text-sm')}>{hint}</p>
      ) : null}
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

/**
 * @ 提及候选（03 §3.2、T1-024、REQ-EDITOR-010 的评论部分）：候选为当前空间可读成员（调用方传入），
 * 插入 `mention{ id, label }`；服务端写 mentions 并发 mention.created，扇出前 can(read) 过滤。
 * `active` 让宿主编辑器知道候选框打开（评论框此时 Enter 选择候选而非发送）。
 */
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { MentionOptions } from '@tiptap/extension-mention'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../components/ui/avatar.tsx'
import { cn } from '../lib/cn.ts'

export interface MentionCandidate {
  id: string
  label: string
}
interface Handle {
  onKeyDown: (e: KeyboardEvent) => boolean
}
type Props = SuggestionProps<MentionCandidate, { id: string; label: string }>

const List = forwardRef<Handle, Props>(function MentionList({ items, command }, ref) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 候选变化时回到第一项
  useEffect(() => setActive(0), [items])
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        setActive((a) => (a + 1) % Math.max(items.length, 1))
        return true
      }
      if (e.key === 'ArrowUp') {
        setActive((a) => (a - 1 + items.length) % Math.max(items.length, 1))
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = items[active]
        if (it) command({ id: it.id, label: it.label })
        return true
      }
      return false
    },
  }))
  return (
    <div
      role="listbox"
      data-testid="mention-menu"
      className="glass-thick w-56 overflow-hidden rounded-lg p-1 text-fg text-sm"
    >
      {items.length ? (
        items.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              command({ id: m.id, label: m.label })
            }}
            className={cn(
              'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left',
              i === active && 'bg-selected',
            )}
          >
            <Avatar id={m.id} name={m.label} size={20} />
            <span className="truncate">{m.label}</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-2 text-fg-muted">{t('comment.noMember')}</p>
      )}
    </div>
  )
})

export function mentionSuggestion(
  getCandidates: () => MentionCandidate[],
  active: { current: boolean },
): Partial<MentionOptions> {
  return {
    suggestion: {
      char: '@',
      items: ({ query }) => {
        const q = query.trim().toLowerCase()
        return getCandidates()
          .filter((c) => !q || c.label.toLowerCase().includes(q))
          .slice(0, 8)
      },
      render: () => {
        let r: ReactRenderer<Handle, Props> | null = null
        let host: HTMLDivElement | null = null
        const place = (p: Props) => {
          const rect = p.clientRect?.()
          if (!rect || !host) return
          void computePosition({ getBoundingClientRect: () => rect }, host, {
            placement: 'bottom-start',
            strategy: 'fixed',
            middleware: [offset(6), flip(), shift({ padding: 8 })],
          }).then(({ x, y }) => {
            if (host) Object.assign(host.style, { left: `${x}px`, top: `${y}px` })
          })
        }
        const close = () => {
          active.current = false
          r?.destroy()
          host?.remove()
          r = null
          host = null
        }
        return {
          onStart: (p) => {
            active.current = true
            host = document.createElement('div')
            host.style.position = 'fixed'
            host.style.zIndex = 'var(--xz-z-toast)'
            document.body.appendChild(host)
            r = new ReactRenderer(List, { props: p, editor: p.editor })
            host.appendChild(r.element)
            place(p)
          },
          onUpdate: (p) => {
            r?.updateProps(p)
            place(p)
          },
          onKeyDown: ({ event }) => {
            if (event.key === 'Escape') {
              close()
              return true
            }
            return r?.ref?.onKeyDown(event) ?? false
          },
          onExit: close,
        }
      },
    },
  } as Partial<MentionOptions>
}

/** TagPicker（04 §5、REQ-TAG-003）：输入过滤；不存在的名字回车即 POST /tags 并选中；9 色 token 按名字散列。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Tag as TagIcon } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE, PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'

interface Tag {
  id: string
  name: string
  color: string
}
export const tagsQuery = {
  queryKey: ['tags'] as const,
  queryFn: () => unwrap<{ items: Tag[] }>(api.tags.$get()).then((r) => r.items),
  staleTime: 60_000,
}
const colorFor = (name: string): PaletteName =>
  PALETTE[
    [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length
  ] as PaletteName

export function TagPicker({
  value,
  onChange,
  disabled,
}: {
  value: Tag[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: all = [] } = useQuery(tagsQuery)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const selected = new Set(value.map((x) => x.id))
  const matches = all.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()))
  const exact = all.find((x) => x.name === q.trim())
  const create = useMutation({
    mutationFn: (name: string) =>
      unwrap<Tag>(
        api.tags.$post(
          { json: { name, color: colorFor(name) } },
          { headers: { 'idempotency-key': crypto.randomUUID() } },
        ),
      ),
    onSuccess: (tag) => {
      qc.setQueryData<Tag[]>(tagsQuery.queryKey, (old) => [...(old ?? []), tag])
      onChange([...selected, tag.id])
      setQ('')
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('task.saveFailed')),
  })
  const toggle = (id: string) =>
    onChange(selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id])
  const [navigated, setNavigated] = useState(false)
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setNavigated(true)
      setActive((i) =>
        e.key === 'ArrowDown' ? Math.min(matches.length - 1, i + 1) : Math.max(0, i - 1),
      )
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const name = q.trim()
    const picked = navigated ? matches[active] : undefined
    if (picked) toggle(picked.id)
    else if (exact) toggle(exact.id)
    else if (name) create.mutate(name) // 输入即创建（REQ-TAG-003）
  }
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex min-h-8 flex-wrap items-center gap-1 rounded-md px-1 text-left hover:bg-hover"
          data-testid="tag-picker"
        >
          {value.length ? (
            value.map((tag) => (
              <span
                key={tag.id}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  PALETTE_CLASS[tag.color as PaletteName],
                )}
              >
                {tag.name}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1 text-fg-muted text-sm">
              <TagIcon className="size-4" />
              {t('task.tags')}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setNavigated(false)
          }}
          onKeyDown={onKeyDown}
          placeholder={t('task.tagSearch')}
          aria-label={t('task.tagSearch')}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border"
          data-testid="tag-input"
        />
        <ul className="mt-2 max-h-56 overflow-y-auto">
          {matches.map((tag, i) => (
            <li key={tag.id}>
              <button
                type="button"
                onClick={() => toggle(tag.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-hover',
                  i === active && 'bg-hover',
                )}
              >
                <span
                  className={cn('size-3 rounded-full', PALETTE_CLASS[tag.color as PaletteName])}
                  aria-hidden
                />
                <span className="flex-1 truncate text-left">{tag.name}</span>
                {selected.has(tag.id) ? <Check className="size-4 text-primary-text" /> : null}
              </button>
            </li>
          ))}
          {q.trim() && !exact ? (
            <li>
              <button
                type="button"
                onClick={() => create.mutate(q.trim())}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-hover"
                data-testid="tag-create"
              >
                <Plus className="size-4" />
                {t('task.tagCreate', { name: q.trim() })}
              </button>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

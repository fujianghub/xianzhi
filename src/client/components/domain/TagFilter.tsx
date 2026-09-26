/**
 * 标签多选筛选（ADR-0014、REQ-TAG-006）：值 = 标签名 csv（与 02 §9 `tag` 同名同格式，任一命中）。
 * 记录页与搜索页共用。
 */
import { useQuery } from '@tanstack/react-query'
import { Check, Tag as TagIcon, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { csvList } from '../../lib/search.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { tagsQuery } from './TagPicker.tsx'

export function TagFilter({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const { t } = useTranslation()
  const { data: all = [] } = useQuery(tagsQuery)
  const [q, setQ] = useState('')
  const picked = csvList(value)
  const set = new Set(picked)
  const toggle = (name: string) => {
    const next = set.has(name) ? picked.filter((x) => x !== name) : [...picked, name]
    onChange(next.length ? next.join(',') : undefined)
  }
  const matches = all.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={picked.length > 0}
          data-testid="tag-filter"
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm',
            picked.length ? 'border-selected-border bg-selected' : 'border-border hover:bg-hover',
          )}
        >
          <TagIcon className="size-3.5" />
          {picked.length ? picked.map((n) => `#${n}`).join(' ') : t('entry.tagFilter')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('settings.tags.search')}
          aria-label={t('settings.tags.search')}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border"
        />
        <ul className="mt-2 max-h-60 overflow-y-auto" data-testid="tag-filter-list">
          {matches.map((tag) => (
            <li key={tag.id}>
              <button
                type="button"
                aria-pressed={set.has(tag.name)}
                onClick={() => toggle(tag.name)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-hover"
              >
                <span
                  aria-hidden
                  className={cn('size-3 rounded-full', PALETTE_CLASS[tag.color as PaletteName])}
                />
                <span className="flex-1 truncate text-left">{tag.name}</span>
                {set.has(tag.name) ? <Check className="size-4 text-primary-text" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {picked.length ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-fg-muted text-sm hover:bg-hover"
          >
            <X className="size-4" />
            {t('entry.tagFilterClear')}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

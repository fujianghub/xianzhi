/**
 * 记录列表（08 §2.8、REQ-ENTRY-002 · 006）：卡片流；固定项置顶（先查 pinned=1，再查 pinned=0）；
 * 筛选 kind / 只看我的 / 标题 q / 排序，参数与 02 §9 同名、全部进 URL。`/entries` 与空间记录页共用。
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDelayedFlag } from '../../hooks/useDelayedFlag.ts'
import { cn } from '../../lib/cn.ts'
import {
  ENTRY_KINDS,
  ENTRY_SORTS,
  type EntryKind,
  type EntryListParams,
  entriesInfiniteQuery,
  flattenEntries,
} from '../../lib/entry-queries.ts'
import { useNewEntry } from '../../lib/stores.ts'
import { Button } from '../ui/button.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { Input } from '../ui/input.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { EntryCard } from './EntryCard.tsx'

export interface EntriesSearch {
  kind?: string
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1'
  sort?: string
}

export function EntriesPage({
  search,
  setSearch,
  spaceId,
  title,
  header,
}: {
  search: EntriesSearch
  setSearch: (patch: Partial<EntriesSearch>) => void
  spaceId?: string
  title: string
  header?: React.ReactNode
}) {
  const { t } = useTranslation()
  const openNew = useNewEntry((s) => s.setOpen)
  const setDefaults = useNewEntry((s) => s.setDefaults)
  const kind = search.kind?.includes(',') ? undefined : (search.kind as EntryKind | undefined)
  useEffect(() => {
    setDefaults({ spaceId, kind })
    return () => setDefaults({})
  }, [spaceId, kind, setDefaults])

  // 标题筛选输入防抖 300ms 后写入 URL
  const [q, setQ] = useState(search.q ?? '')
  useEffect(() => setQ(search.q ?? ''), [search.q])
  useEffect(() => {
    const h = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setSearch({ q: q.trim() || undefined })
    }, 300)
    return () => clearTimeout(h)
  }, [q, search.q, setSearch])

  const base: EntryListParams = {
    spaceId,
    kind: search.kind,
    authorId: search.authorId,
    tag: search.tag,
    q: search.q,
    sort: search.sort ?? '-updatedAt',
  }
  const pinned = useInfiniteQuery(entriesInfiniteQuery({ ...base, pinned: '1' }, 50))
  const rest = useInfiniteQuery({
    ...entriesInfiniteQuery({ ...base, pinned: '0' }),
    enabled: search.pinned !== '1',
  })
  const pinnedItems = flattenEntries(pinned.data)
  const restItems = search.pinned === '1' ? [] : flattenEntries(rest.data)
  const items = [...pinnedItems, ...restItems]
  const loading = pinned.isPending || (search.pinned !== '1' && rest.isPending)
  const skeleton = useDelayedFlag(loading)
  const chip = (active: boolean) =>
    cn(
      'h-8 shrink-0 rounded-full border px-3 text-sm',
      active ? 'border-selected-border bg-selected' : 'border-border hover:bg-hover',
    )

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="entries-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {header}
        <Button
          className="ml-auto"
          variant="primary"
          size="sm"
          onClick={() => openNew(true, { spaceId, kind })}
          data-testid="new-entry"
        >
          <Plus className="size-4" />
          {t('entry.new')}
        </Button>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <fieldset className="flex gap-1.5 overflow-x-auto">
          <legend className="sr-only">{t('entry.props.kind')}</legend>
          <button
            type="button"
            className={chip(!search.kind)}
            onClick={() => setSearch({ kind: undefined })}
          >
            {t('entry.allKinds')}
          </button>
          {ENTRY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={search.kind === k}
              className={chip(search.kind === k)}
              onClick={() => setSearch({ kind: search.kind === k ? undefined : k })}
            >
              {t(`entry.kind.${k}`)}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          aria-pressed={search.authorId === 'me'}
          className={chip(search.authorId === 'me')}
          onClick={() => setSearch({ authorId: search.authorId === 'me' ? undefined : 'me' })}
        >
          {t('entry.mine')}
        </button>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('entry.searchPlaceholder')}
          aria-label={t('entry.searchPlaceholder')}
          className="h-8 w-48"
        />
        <select
          value={search.sort ?? '-updatedAt'}
          onChange={(e) =>
            setSearch({ sort: e.target.value === '-updatedAt' ? undefined : e.target.value })
          }
          aria-label={t('entry.sortLabel')}
          className="h-8 rounded-full border border-border bg-surface px-3 text-sm"
        >
          {ENTRY_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`entry.sort.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {skeleton ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : !loading && !items.length ? (
        <EmptyState
          illustration="entries"
          title={t(`entry.empty.${kind ?? 'all'}`)}
          action={
            <Button variant="primary" onClick={() => openNew(true, { spaceId, kind })}>
              {t('entry.new')}
            </Button>
          }
        />
      ) : (
        <>
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="entry-grid"
          >
            {items.map((e, i) => (
              <EntryCard key={e.id} entry={e} showSpace={!spaceId} index={i} />
            ))}
          </div>
          {rest.hasNextPage ? (
            <div className="mt-6 flex justify-center">
              <Button
                variant="ghost"
                loading={rest.isFetchingNextPage}
                onClick={() => void rest.fetchNextPage()}
              >
                {t('entry.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

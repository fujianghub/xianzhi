/**
 * 记录列表（08 §2.8、REQ-ENTRY-002 · 006、REQ-KB-004）：卡片 / 表格两种视图；固定项置顶（先查 pinned=1，再查 pinned=0）；
 * 类型可多选（`kind=bug,iteration`）；只选一种类型时按其 fields 给出下拉过滤（`fields=status=open,severity=high`）；
 * 表格视图列 = 该类型的 fields，点列头在已加载的数据内排序（枚举按定义顺序），一次最多加载 200 条。
 * 参数与 02 §9 同名、全部进 URL。`/entries` 与分类记录页共用。
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { LayoutGrid, Plus, Table2 } from 'lucide-react'
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
import { csvList } from '../../lib/search.ts'
import { useNewEntry } from '../../lib/stores.ts'
import { Button } from '../ui/button.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { Input } from '../ui/input.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { EntryCard } from './EntryCard.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'
import { EntryTable } from './EntryTable.tsx'

export interface EntriesSearch {
  kind?: string
  fields?: string
  view?: 'table'
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1'
  sort?: string
}

/** `status=open|fixed,severity=high` ⇄ { status: 'open|fixed', severity: 'high' } */
export const parseFieldsParam = (s: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (s ?? '')
      .split(',')
      .map((p) => p.split('='))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  )
export const stringifyFieldsParam = (m: Record<string, string>): string | undefined => {
  const parts = Object.entries(m)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
  return parts.length ? parts.join(',') : undefined
}

export function EntriesPage({
  search,
  setSearch,
  spaceId,
  title,
  header,
  hideTitle,
}: {
  search: EntriesSearch
  setSearch: (patch: Partial<EntriesSearch>) => void
  spaceId?: string
  title: string
  header?: React.ReactNode
  /** 分类页签内：页头已由 KbHeader 提供 */
  hideTitle?: boolean
}) {
  const { t } = useTranslation()
  const openNew = useNewEntry((s) => s.setOpen)
  const setDefaults = useNewEntry((s) => s.setDefaults)
  const kinds = csvList(search.kind) as EntryKind[]
  const kind = kinds.length === 1 ? kinds[0] : undefined
  const table = search.view === 'table'
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
    fields: search.fields,
    authorId: search.authorId,
    tag: search.tag,
    q: search.q,
    sort: search.sort ?? '-updatedAt',
  }
  const pageSize = table ? 200 : 30
  const pinned = useInfiniteQuery(entriesInfiniteQuery({ ...base, pinned: '1' }, 50))
  const rest = useInfiniteQuery({
    ...entriesInfiniteQuery({ ...base, pinned: '0' }, pageSize),
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
  const toggleKind = (k: EntryKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]
    // 类型变了，字段过滤可能不再适用：清空
    setSearch({ kind: next.length ? next.join(',') : undefined, fields: undefined })
  }
  const fieldFilters = kind ? fieldSpecs(kind).filter((f) => f.kind === 'select') : []
  const fieldValues = parseFieldsParam(search.fields)

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="entries-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {hideTitle ? null : <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>}
        {header}
        <div className="ml-auto flex items-center gap-2">
          <fieldset className="flex rounded-full border border-border p-0.5">
            <legend className="sr-only">{t('kb.view')}</legend>
            <button
              type="button"
              aria-pressed={!table}
              aria-label={t('kb.viewCards')}
              title={t('kb.viewCards')}
              onClick={() => setSearch({ view: undefined })}
              className={cn(
                'grid h-7 w-8 place-items-center rounded-full',
                !table ? 'bg-selected' : 'text-fg-muted',
              )}
              data-testid="view-cards"
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              aria-pressed={table}
              aria-label={t('kb.viewTable')}
              title={t('kb.viewTable')}
              onClick={() => setSearch({ view: 'table' })}
              className={cn(
                'grid h-7 w-8 place-items-center rounded-full',
                table ? 'bg-selected' : 'text-fg-muted',
              )}
              data-testid="view-table"
            >
              <Table2 className="size-4" />
            </button>
          </fieldset>
          <Button
            variant="primary"
            size="sm"
            onClick={() => openNew(true, { spaceId, kind })}
            data-testid="new-entry"
          >
            <Plus className="size-4" />
            {t('entry.new')}
          </Button>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <fieldset className="flex gap-1.5 overflow-x-auto">
          <legend className="sr-only">{t('entry.props.kind')}</legend>
          <button
            type="button"
            className={chip(!kinds.length)}
            onClick={() => setSearch({ kind: undefined, fields: undefined })}
          >
            {t('entry.allKinds')}
          </button>
          {ENTRY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kinds.includes(k)}
              className={chip(kinds.includes(k))}
              onClick={() => toggleKind(k)}
              data-kind-filter={k}
            >
              {t(`entry.kind.${k}`)}
            </button>
          ))}
        </fieldset>
        {fieldFilters.map((f) =>
          f.kind === 'select' ? (
            <select
              key={f.name}
              value={fieldValues[f.name] ?? ''}
              onChange={(e) =>
                setSearch({
                  fields: stringifyFieldsParam({ ...fieldValues, [f.name]: e.target.value }),
                })
              }
              aria-label={t(`entry.field.${f.name}`)}
              className="h-8 rounded-full border border-border bg-surface px-3 text-sm"
              data-testid={`field-filter-${f.name}`}
            >
              <option value="">
                {t(`entry.field.${f.name}`)}：{t('entry.allKinds')}
              </option>
              {f.options.map((o) => (
                <option key={String(o)} value={String(o)}>
                  {t(`entry.fieldValue.${o}`, { defaultValue: String(o) })}
                </option>
              ))}
            </select>
          ) : null,
        )}
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
          title={t(`entry.empty.${kind ?? 'all'}`, { defaultValue: t('entry.empty.all') })}
          action={
            <Button variant="primary" onClick={() => openNew(true, { spaceId, kind })}>
              {t('entry.new')}
            </Button>
          }
        />
      ) : table ? (
        <EntryTable items={items} kinds={kinds} showSpace={!spaceId} />
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

/**
 * 搜索页（08 §2.11、T1-026、REQ-SEARCH-001 ~ 006）：任务 / 记录两组，各自游标「加载更多」，`<mark>` 高亮；
 * 空 q 显示最近访问；Enter 打开首项；429 提示稍后再试；行悬停 Peek。参数与 02 §4 `/search` 一致。
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { CheckSquare, FileText, Search as SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Highlight } from '../components/ui/highlight.tsx'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useHoverIntent } from '../hooks/useHoverIntent.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { recentIds } from '../lib/recent.ts'
import { optCsvOf, optString, optUuid } from '../lib/search.ts'
import { type Hit, hitLink, type SearchResult } from '../lib/search-queries.ts'
import { usePeek } from '../lib/stores.ts'

type Search = { q?: string; types?: string; spaceId?: string }
type GroupKey = 'tasks' | 'entries'

export const Route = createFileRoute('/_app/search')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: optString(s.q)?.slice(0, 200),
    types: optCsvOf(['task', 'entry'])(s.types),
    spaceId: optUuid(s.spaceId),
  }),
  component: SearchPage,
})

function useGroup(group: GroupKey, search: Search, recent: string[]) {
  const type = group === 'tasks' ? 'task' : 'entry'
  const enabled = !search.types || search.types.split(',').includes(type)
  return useInfiniteQuery({
    queryKey: ['search', 'page', group, search, recent] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap<SearchResult>(
        api.search.$get({
          query: {
            types: type,
            limit: '20',
            ...(search.q ? { q: search.q } : { recent: recent.join(',') }),
            ...(search.spaceId ? { spaceId: search.spaceId } : {}),
            ...(pageParam
              ? { [group === 'tasks' ? 'cursorTasks' : 'cursorEntries']: pageParam }
              : {}),
          } as never,
        }),
      ).then((r) => r.groups[group] ?? { items: [], nextCursor: null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    enabled: enabled && (!!search.q || recent.length > 0),
    retry: false,
  })
}

function SearchPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/search' })
  const [q, setQ] = useState(search.q ?? '')
  const input = useRef<HTMLInputElement>(null)
  const [recent] = useState(() => recentIds())
  useEffect(() => input.current?.focus(), [])
  useEffect(() => setQ(search.q ?? ''), [search.q])
  useEffect(() => {
    const h = setTimeout(() => {
      if ((search.q ?? '') !== q.trim())
        void nav({ search: (s) => ({ ...s, q: q.trim() || undefined }), replace: true })
    }, 250)
    return () => clearTimeout(h)
  }, [q, search.q, nav])

  const tasks = useGroup('tasks', search, recent)
  const entries = useGroup('entries', search, recent)
  const all = [
    ...(tasks.data?.pages.flatMap((p) => p.items) ?? []),
    ...(entries.data?.pages.flatMap((p) => p.items) ?? []),
  ]
  const loading = (tasks.isFetching || entries.isFetching) && !all.length
  const skeleton = useDelayedFlag(loading)
  const limited = [tasks.error, entries.error].some(
    (e) => e instanceof ApiError && e.status === 429,
  )
  const typeChip = (v: string | undefined, label: string) => (
    <button
      type="button"
      aria-pressed={search.types === v}
      onClick={() => void nav({ search: (s) => ({ ...s, types: v }), replace: true })}
      className={cn(
        'h-8 rounded-full border px-3 text-sm',
        search.types === v ? 'border-selected-border bg-selected' : 'border-border hover:bg-hover',
      )}
    >
      {label}
    </button>
  )

  return (
    <section className="mx-auto max-w-3xl" data-testid="search-page">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const first = all[0]
          if (first) void nav(hitLink(first))
        }}
        className="relative mb-4"
      >
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
        <Input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ui.search.placeholder')}
          aria-label={t('ui.page.search')}
          className="h-11 pl-9 text-base"
          data-testid="search-input"
        />
      </form>
      <div className="mb-5 flex gap-2">
        {typeChip(undefined, t('search.all'))}
        {typeChip('task', t('task.tasks'))}
        {typeChip('entry', t('ui.page.entries'))}
      </div>
      {limited ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm" role="status">
          {t('search.limited')}
        </p>
      ) : null}
      {!search.q && !recent.length ? (
        <p className="text-fg-muted text-sm">{t('search.hint')}</p>
      ) : skeleton ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : !loading && !all.length && search.q ? (
        <EmptyState illustration="search" title={t('search.empty')} />
      ) : (
        <div className="flex flex-col gap-8">
          {!search.q ? <h2 className="text-fg-muted text-xs">{t('search.recent')}</h2> : null}
          <Group title={t('task.tasks')} q={tasks} />
          <Group title={t('ui.page.entries')} q={entries} />
        </div>
      )}
    </section>
  )
}

function Group({ title, q }: { title: string; q: ReturnType<typeof useGroup> }) {
  const { t } = useTranslation()
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (!items.length) return null
  return (
    <section data-testid="search-group">
      <h2 className="mb-2 font-medium text-fg-muted text-sm">{title}</h2>
      <ul className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider">
        {items.map((h) => (
          <HitRow key={h.id} hit={h} />
        ))}
      </ul>
      {q.hasNextPage ? (
        <button
          type="button"
          className="mt-2 text-primary text-sm hover:underline"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {t('entry.loadMore')}
        </button>
      ) : null}
    </section>
  )
}

function HitRow({ hit }: { hit: Hit }) {
  const { t } = useTranslation()
  const openPeek = usePeek((s) => s.open)
  const hover = useHoverIntent(() =>
    openPeek(
      hit.type === 'task'
        ? { kind: 'task', id: hit.id, spaceSlug: hit.spaceSlug }
        : { kind: 'entry', id: hit.id },
    ),
  )
  return (
    <li {...hover}>
      <Link
        {...hitLink(hit)}
        className="flex items-start gap-3 px-4 py-3 hover:bg-hover"
        data-testid="search-hit"
      >
        {hit.type === 'task' ? (
          <CheckSquare className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        ) : (
          <FileText className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{hit.title}</span>
          {hit.highlight ? (
            <Highlight html={hit.highlight} className="line-clamp-2 text-fg-muted text-sm" />
          ) : null}
        </span>
        <span className="shrink-0 text-fg-muted text-xs">
          {hit.type === 'entry' && hit.kind
            ? t(`entry.kind.${hit.kind}`)
            : hit.status
              ? t(`task.status.${hit.status}`)
              : ''}
        </span>
      </Link>
    </li>
  )
}

/**
 * 空间任务（08 §2.6；REQ-TASK-003 · 004 · 020 · REQ-UI-017 · 019）：`view=board` 看板 / `view=list` 虚拟列表；
 * 筛选参数与 API 同名（08 §2 约定），全部可分享；详情 Sheet 为子路由（Outlet）。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, Outlet, useNavigate } from '@tanstack/react-router'
import { Archive } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Board } from '../components/domain/Board.tsx'
import { SpaceIcon } from '../components/domain/SpaceIcon.tsx'
import { TaskList } from '../components/domain/TaskList.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useTaskActions } from '../hooks/useTasks.ts'
import { ApiError } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { optCsvOf, optOneOf, optString, optUuid } from '../lib/search.ts'
import { spaceQuery } from '../lib/space-queries.ts'
import { useCommandContext, useNewTask } from '../lib/stores.ts'
import {
  flattenPages,
  TASK_STATUSES,
  type Task,
  type TaskListParams,
  tasksInfiniteQuery,
} from '../lib/task-queries.ts'

type Search = {
  view?: 'board' | 'list'
  status?: string
  assigneeId?: string
  due?: 'today' | 'week' | 'overdue'
  cycleId?: string
  tag?: string
  q?: string
  sort?: string
  task?: string
}
const SORTS =
  /^-?(updatedAt|createdAt|dueAt|priority|title)(,-?(updatedAt|createdAt|dueAt|priority|title))*$/

export const Route = createFileRoute('/_app/spaces/$spaceSlug')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: optOneOf(['board', 'list'] as const)(s.view),
    status: optCsvOf(TASK_STATUSES)(s.status),
    assigneeId: s.assigneeId === 'me' ? 'me' : optUuid(s.assigneeId),
    due: optOneOf(['today', 'week', 'overdue'] as const)(s.due),
    cycleId: optUuid(s.cycleId),
    tag: optString(s.tag),
    q: optString(s.q)?.slice(0, 200),
    sort: typeof s.sort === 'string' && SORTS.test(s.sort) ? s.sort : undefined,
    task: optUuid(s.task),
  }),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(spaceQuery(params.spaceSlug))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) throw notFound()
      throw err
    }
  },
  component: SpacePage,
})

function SpacePage() {
  const { t } = useTranslation()
  const { spaceSlug } = Route.useParams()
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/spaces/$spaceSlug' })
  const { data: space } = useQuery(spaceQuery(spaceSlug))
  const actions = useTaskActions()
  const setDefaults = useNewTask((s) => s.setDefaults)
  const view = search.view ?? 'board'
  useEffect(() => {
    if (space) setDefaults({ spaceId: space.id, status: 'todo' })
    return () => setDefaults({})
  }, [space, setDefaults])
  // ⌘K 底层上下文：空间（REQ-UI-005）
  const setCmdBase = useCommandContext((s) => s.setBase)
  useEffect(() => {
    if (space) setCmdBase({ kind: 'space', id: space.id, slug: space.slug })
    return () => setCmdBase(null)
  }, [space, setCmdBase])

  const filters: TaskListParams = {
    assigneeId: search.assigneeId,
    due: search.due,
    cycleId: search.cycleId,
    tag: search.tag,
    q: search.q,
  }
  const listParams: TaskListParams & { spaceId: string } = {
    ...filters,
    spaceId: space?.id ?? '',
    // 列表默认不含已完成 / 取消（完成后折叠移出，08 §2.6）
    status: search.status ?? 'inbox,todo,doing,blocked',
    sort: search.sort ?? '-updatedAt',
  }
  const list = useInfiniteQuery({
    ...tasksInfiniteQuery(listParams),
    enabled: !!space && view === 'list',
  })
  const skeleton = useDelayedFlag(list.isPending && view === 'list')
  const open = (task: Task) =>
    nav({
      to: '/spaces/$spaceSlug/tasks/$taskId',
      params: { spaceSlug, taskId: task.id },
      search: (s) => s,
    })
  const setSearch = (patch: Partial<Search>) =>
    nav({ search: (s) => ({ ...s, ...patch }), replace: true })

  if (!space) return null
  const name = space.isPersonal ? t('space.personal') : space.name
  const chip = (active: boolean) =>
    cn(
      'h-8 rounded-full border px-3 text-sm',
      active ? 'border-selected-border bg-selected' : 'border-border hover:bg-hover',
    )
  return (
    <section className="mx-auto max-w-[100rem]" data-testid="space-page">
      {space.archivedAt ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg bg-warning-soft px-4 py-2 text-sm text-warning"
          role="status"
          data-testid="space-archived-banner"
        >
          <Archive className="size-4" />
          {t('space.archivedBanner')}
        </div>
      ) : null}
      <header className="flex flex-wrap items-center gap-3">
        <SpaceIcon
          icon={space.icon}
          kind={space.kind}
          color={space.color}
          isPersonal={space.isPersonal}
          className="size-9 text-base"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-xl">{name}</h1>
          <p className="text-fg-muted text-xs">
            {t(`space.kind.${space.kind}`)} · {t(`space.visibility.${space.visibility}`)} ·{' '}
            {t('space.members', { count: space.memberCount })}
          </p>
        </div>
        <div
          className="flex rounded-full border border-border p-0.5"
          role="tablist"
          aria-label={t('task.view.board')}
        >
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setSearch({ view: v === 'board' ? undefined : v })}
              className={cn(
                'h-8 rounded-full px-3 text-sm',
                view === v ? 'bg-selected font-medium' : 'text-fg-muted hover:text-fg',
              )}
              data-testid={`view-${v}`}
            >
              {t(`task.view.${v}`)}
            </button>
          ))}
        </div>
        <Link
          to="/spaces/$spaceSlug/entries"
          params={{ spaceSlug }}
          search={{}}
          className="h-8 rounded-full border border-border px-3 text-sm leading-8 hover:bg-hover"
          data-testid="space-entries-link"
        >
          {t('ui.page.entries')}
        </Link>
      </header>
      <div className="my-4 flex flex-wrap items-center gap-2" data-testid="task-filters">
        <button
          type="button"
          className={chip(search.assigneeId === 'me')}
          onClick={() => setSearch({ assigneeId: search.assigneeId === 'me' ? undefined : 'me' })}
        >
          {t('task.filter.mine')}
        </button>
        {(['today', 'week', 'overdue'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={chip(search.due === d)}
            onClick={() => setSearch({ due: search.due === d ? undefined : d })}
          >
            {t(`task.filter.${d}`)}
          </button>
        ))}
        <input
          defaultValue={search.q ?? ''}
          placeholder={t('task.filter.search')}
          aria-label={t('task.filter.search')}
          className="h-8 w-48 rounded-full border border-border bg-surface px-3 text-sm outline-none focus:border-selected-border"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSearch({ q: e.currentTarget.value.trim() || undefined })
          }}
        />
        {view === 'list' ? (
          <button
            type="button"
            className={chip(!!search.status?.includes('done'))}
            onClick={() =>
              setSearch({
                status: search.status?.includes('done') ? undefined : TASK_STATUSES.join(','),
              })
            }
          >
            {search.status?.includes('done') ? t('task.hideDone') : t('task.showDone')}
          </button>
        ) : null}
      </div>
      {view === 'board' ? (
        <Board params={{ ...filters, spaceId: space.id }} onOpen={open} />
      ) : list.isError ? (
        <div className="paper rounded-lg p-6 text-center" role="alert">
          <button type="button" className="text-sm underline" onClick={() => void list.refetch()}>
            {t('ui.action.retry')}
          </button>
        </div>
      ) : list.isPending ? (
        skeleton ? (
          <div className="flex flex-col gap-1" aria-busy="true">
            {Array.from({ length: 10 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
              <Skeleton key={i} className="h-(--xz-row-h)" />
            ))}
          </div>
        ) : null
      ) : (
        <TaskList
          tasks={flattenPages(list.data)}
          label={name}
          onOpen={open}
          hasMore={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          empty={
            <EmptyState
              illustration="board"
              title={t('ui.empty.board')}
              hint={t('ui.empty.boardHint')}
              input={{
                placeholder: t('ui.empty.newTaskPlaceholder'),
                onSubmit: (title) => actions.create({ title, spaceId: space.id, status: 'todo' }),
              }}
            />
          }
        />
      )}
      <Outlet />
    </section>
  )
}

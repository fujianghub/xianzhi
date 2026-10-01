/**
 * 任务页 2.0（ADR-0043 → ADR-0044、REQ-TASK-025 · 027 · 033 · 034 · 035）：滴答清单式三栏。
 * - 左：清单栏（智能清单 · 我的清单 · 标签，带计数）；窄屏收为页头下的横向胶囊条。
 * - 中：页头（清单名 + 未完成数 + 分组方式）→ 快速添加（带当前清单 / 日期预设）→ 分组列表（组内悬停「+ 添加」就地建）。
 * - 右：≥ 1440 常驻详情栏（`?task=`，列表不离开）；更窄用覆盖式 Sheet。
 * search：`view`（智能清单）| `list`（清单 id）| `tag`（标签名）· `group=date|priority|none` · `task` · `spaceId`。
 * 分组边界按用户时区（与今日同口径）；子任务不单列（「今天」除外，与今日页一致）。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, localDateOf, zonedMidnight } from '../../shared/tz.ts'
import { type QuickAddPreset, QuickAddTask } from '../components/domain/QuickAddTask.tsx'
import { SelectModeButton, TaskSelectionScope } from '../components/domain/TaskBatchBar.tsx'
import { TaskDetailSheet } from '../components/domain/TaskDetailSheet.tsx'
import {
  TaskDndProvider,
  type TaskDropTarget,
  useDraggingTask,
  useTaskDrop,
} from '../components/domain/TaskDnd.tsx'
import { TaskList } from '../components/domain/TaskList.tsx'
import { ListDot } from '../components/domain/TaskListDot.tsx'
import { smartCount, TaskListsRail, type TaskScope } from '../components/domain/TaskListsRail.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useLinger } from '../hooks/useLinger.ts'
import type { Me } from '../hooks/useMe.ts'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'
import { useSpaces } from '../hooks/useSpaces.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf, optString, optUuid } from '../lib/search.ts'
import { useNewTask } from '../lib/stores.ts'
import { groupByPriority, groupTasks, PRIORITY_GROUPS, TASK_GROUPS } from '../lib/task-groups.ts'
// 路由的 validateSearch 在主包：SMART_VIEWS 从轻模块取，不经组件文件（首屏预算）
import {
  flatLists,
  SMART_VIEWS,
  type SmartView,
  taskCountsQuery,
  taskListsQuery,
} from '../lib/task-list-queries.ts'
import {
  flattenPages,
  type Task,
  type TaskListParams,
  tasksInfiniteQuery,
} from '../lib/task-queries.ts'

const GROUP_MODES = ['date', 'priority', 'none'] as const
type GroupMode = (typeof GROUP_MODES)[number]

interface TasksSearch {
  view?: SmartView
  list?: string
  tag?: string
  group?: GroupMode
  task?: string
  spaceId?: string
}

export const Route = createFileRoute('/_app/tasks')({
  validateSearch: (s: Record<string, unknown>): TasksSearch => ({
    view: optOneOf(SMART_VIEWS)(s.view),
    list: optUuid(s.list),
    tag: optString(s.tag),
    group: optOneOf(GROUP_MODES)(s.group),
    task: optUuid(s.task),
    spaceId: optUuid(s.spaceId),
  }),
  component: TasksPage,
})

const OPEN = 'inbox,todo,doing,blocked'

const scopeOf = (s: TasksSearch): TaskScope =>
  s.list
    ? { kind: 'list', id: s.list }
    : s.tag
      ? { kind: 'tag', name: s.tag }
      : { kind: 'smart', view: s.view ?? 'all' }

/** 各范围的列表查询（服务端按用户时区算边界） */
function paramsOf(scope: TaskScope, spaceId?: string): TaskListParams {
  const base = { spaceId }
  if (scope.kind === 'list')
    return { ...base, view: 'mine', listId: scope.id, status: OPEN, sort: 'dueAt' }
  if (scope.kind === 'tag')
    return { ...base, view: 'mine', tag: scope.name, status: OPEN, sort: 'dueAt' }
  switch (scope.view) {
    case 'today':
      return { ...base, view: 'today', sort: 'dueAt' }
    case 'tomorrow':
      return { ...base, view: 'mine', due: 'tomorrow', status: OPEN, sort: 'dueAt' }
    case 'next7':
      return { ...base, view: 'mine', due: 'next7', status: OPEN, sort: 'dueAt' }
    case 'unlisted':
      return { ...base, view: 'mine', listId: 'none', status: OPEN, sort: 'dueAt' }
    case 'done':
      return { ...base, view: 'mine', status: 'done', sort: '-updatedAt' }
    default:
      return { ...base, view: 'mine', status: OPEN, sort: 'dueAt' }
  }
}

const COLLAPSED_KEY = 'xz.tasks.collapsed'
function useCollapsed() {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggle = (g: string) =>
    setSet((cur) => {
      const next = new Set(cur)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // 无痕 / 禁用存储：只在本次会话记住
      }
      return next
    })
  return [set, toggle] as const
}

function TasksPage() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/tasks' })
  const spaces = useSpaces()
  const lists = useQuery(taskListsQuery)
  const counts = useQuery(taskCountsQuery(search.spaceId))
  const setDefaults = useNewTask((s) => s.setDefaults)
  const [collapsed, toggle] = useCollapsed()
  const [adding, setAdding] = useState<string | null>(null)
  const wide = useMediaQuery('(min-width: 90rem)')
  const scope = scopeOf(search)
  const groupMode: GroupMode =
    search.group ?? (scope.kind === 'smart' && scope.view === 'done' ? 'none' : 'date')
  const currentList =
    scope.kind === 'list' ? (lists.data?.items ?? []).find((l) => l.id === scope.id) : undefined

  // 时间边界（用户时区）：组内就地添加的日期预设
  const edges = useMemo(() => {
    const today = localDateOf(me.timezone, new Date())
    const end = (n: number) =>
      new Date(zonedMidnight(me.timezone, addDays(today, n + 1)).getTime() - 60_000).toISOString()
    return { today: end(0), tomorrow: end(1) }
  }, [me.timezone])
  const scopePreset: QuickAddPreset = {
    ...(scope.kind === 'list' ? { listId: scope.id } : {}),
    ...(scope.kind === 'smart' && scope.view === 'today' ? { dueAt: edges.today } : {}),
    ...(scope.kind === 'smart' && scope.view === 'tomorrow' ? { dueAt: edges.tomorrow } : {}),
  }
  useEffect(() => {
    setDefaults({ status: 'todo', ...(search.spaceId ? { spaceId: search.spaceId } : {}) })
    return () => setDefaults({})
  }, [setDefaults, search.spaceId])

  const q = useInfiniteQuery(tasksInfiniteQuery(paramsOf(scope, search.spaceId)))
  const skeleton = useDelayedFlag(q.isPending)
  const tasks = flattenPages(q.data)
  // 视图里最后一条被完成 / 移走后，先别换成空状态：留 8 秒给淡出与「撤销」
  const pageKeep = useLinger(tasks.length)
  const groups = useMemo((): [string, Task[], GroupMeta][] => {
    if (groupMode === 'none') return [['all', tasks, { drop: null }]]
    if (groupMode === 'priority') {
      const by = groupByPriority(tasks)
      return PRIORITY_GROUPS.map((g) => [
        g,
        by.get(g) ?? [],
        { drop: { kind: 'priority', p: Number(g.slice(1)) } },
      ])
    }
    const by = groupTasks(tasks, me.timezone, new Date())
    return TASK_GROUPS.map((g) => [
      g,
      by.get(g) ?? [],
      {
        tone: g === 'overdue' ? 'overdue' : undefined,
        // 拖进「今天 / 明天」改截止，拖进「无日期」清空截止（ADR-0044）
        drop:
          g === 'today'
            ? { kind: 'day', offset: 0 }
            : g === 'tomorrow'
              ? { kind: 'day', offset: 1 }
              : g === 'noDate'
                ? { kind: 'noDate' }
                : null,
        preset:
          g === 'today'
            ? { dueAt: edges.today }
            : g === 'tomorrow'
              ? { dueAt: edges.tomorrow }
              : g === 'noDate'
                ? { dueAt: null }
                : undefined,
      },
    ])
  }, [tasks, groupMode, me.timezone, edges])

  const pick = (s: TaskScope) =>
    nav({
      search: (p) => ({
        spaceId: p.spaceId,
        group: p.group,
        ...(s.kind === 'list'
          ? { list: s.id }
          : s.kind === 'tag'
            ? { tag: s.name }
            : s.view === 'all'
              ? {}
              : { view: s.view }),
      }),
    })
  const open = (task: Task) => nav({ search: (p) => ({ ...p, task: task.id }) })
  const close = () => nav({ search: (p) => ({ ...p, task: undefined }) })

  const title =
    scope.kind === 'list'
      ? (currentList?.name ?? t('taskLists.list'))
      : scope.kind === 'tag'
        ? `#${scope.name}`
        : t(`taskLists.smart.${scope.view}`)
  const total =
    scope.kind === 'list'
      ? counts.data?.lists[scope.id]
      : scope.kind === 'smart'
        ? smartCount(counts.data, scope.view)
        : undefined
  const isDone = scope.kind === 'smart' && scope.view === 'done'

  const groupLabel = (g: string) =>
    groupMode === 'priority'
      ? t(`task.priority.${g.slice(1)}`)
      : groupMode === 'none'
        ? title
        : t(`tasksPage.group.${g}`)

  // 选择随视图清空（换清单 / 智能清单 / 分组 / 空间筛选）
  const selectionKey = JSON.stringify([scope, groupMode, search.spaceId ?? ''])
  return (
    <TaskSelectionScope scopeKey={selectionKey}>
      <TaskDndProvider>
        <section
          data-testid="tasks-page"
          className="-mx-4 -my-6 flex min-h-[calc(100dvh-var(--xz-topbar-h))] lg:-mx-10 lg:-mt-8 lg:-mb-10"
        >
          <aside className="hidden w-60 shrink-0 overflow-y-auto border-divider border-e px-2 py-5 lg:block">
            <TaskListsRail scope={scope} counts={counts.data} onPick={pick} droppable />
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8">
            <div className="mx-auto flex max-w-3xl flex-col">
              <MobileScopes scope={scope} onPick={pick} />
              <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="flex min-w-0 items-center gap-2 font-display font-semibold text-2xl">
                  {currentList ? <ListDot list={currentList} className="size-3" /> : null}
                  <span className="truncate" data-testid="tasks-title">
                    {title}
                  </span>
                </h1>
                {total !== undefined ? (
                  <span className="xz-group-count" data-testid="tasks-count">
                    {total}
                  </span>
                ) : null}
                <div className="ms-auto flex items-center gap-2">
                  <SelectModeButton />
                  <select
                    value={search.spaceId ?? ''}
                    onChange={(e) =>
                      nav({
                        search: (p) => ({ ...p, spaceId: e.target.value || undefined }),
                        replace: true,
                      })
                    }
                    aria-label={t('tasksPage.space')}
                    className="h-8 max-w-40 rounded-full border border-border bg-surface px-3 text-xs"
                    data-testid="tasks-space-filter"
                  >
                    <option value="">{t('tasksPage.allSpaces')}</option>
                    {(spaces.data ?? [])
                      .filter((s) => !s.archivedAt)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.isPersonal ? t('space.personal') : s.name}
                        </option>
                      ))}
                  </select>
                  <select
                    value={groupMode}
                    onChange={(e) =>
                      nav({
                        search: (p) => ({ ...p, group: e.target.value as GroupMode }),
                        replace: true,
                      })
                    }
                    aria-label={t('tasksPage.groupBy')}
                    className="h-8 rounded-full border border-border bg-surface px-3 text-xs"
                    data-testid="tasks-group-mode"
                  >
                    {GROUP_MODES.map((g) => (
                      <option key={g} value={g}>
                        {t(`tasksPage.groupMode.${g}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </header>

              {isDone ? null : <QuickAddTask className="mb-5" preset={scopePreset} />}

              {q.isError ? (
                <div className="paper rounded-lg p-6 text-center" role="alert">
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => void q.refetch()}
                  >
                    {t('ui.action.retry')}
                  </button>
                </div>
              ) : q.isPending ? (
                skeleton ? (
                  <div className="flex flex-col gap-1" aria-busy="true">
                    {[0, 1, 2, 3, 4].map((r) => (
                      <Skeleton key={r} className="h-(--xz-row-h)" />
                    ))}
                  </div>
                ) : null
              ) : !tasks.length && !pageKeep ? (
                <EmptyState
                  illustration={
                    isDone
                      ? 'trash'
                      : scope.kind === 'smart' && scope.view === 'today'
                        ? 'today'
                        : 'inbox'
                  }
                  title={t(`tasksPage.empty.${scope.kind === 'smart' ? scope.view : scope.kind}`)}
                  hint={isDone ? undefined : t('tasksPage.emptyHint')}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {groups.map(([g, list, meta], rank) => (
                    <GroupBlock
                      key={g}
                      g={g}
                      rank={rank}
                      list={list}
                      label={groupLabel(g)}
                      tone={meta.tone}
                      drop={meta.drop}
                      showHead={groupMode !== 'none'}
                      shut={collapsed.has(`${groupMode}:${g}`)}
                      onToggle={() => toggle(`${groupMode}:${g}`)}
                      canAdd={
                        !isDone &&
                        meta.tone !== 'overdue' &&
                        (groupMode !== 'date' || !!meta.preset)
                      }
                      adding={adding === g}
                      onAdd={() => setAdding(adding === g ? null : g)}
                      preset={{ ...scopePreset, ...meta.preset }}
                      onOpen={open}
                      showSpace={!search.spaceId}
                      showList={scope.kind !== 'list'}
                    />
                  ))}
                  {q.hasNextPage ? (
                    <button
                      type="button"
                      className="self-start text-primary-text text-sm hover:underline"
                      onClick={() => void q.fetchNextPage()}
                    >
                      {t('task.loadMore')}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {search.task ? (
            wide ? (
              <TaskDetailSheet
                key={search.task}
                taskId={search.task}
                variant="panel"
                onClose={close}
                onOpenTask={open}
              />
            ) : (
              <TaskDetailSheet taskId={search.task} onClose={close} onOpenTask={open} />
            )
          ) : null}
          <NewTaskFab />
        </section>
      </TaskDndProvider>
    </TaskSelectionScope>
  )
}

interface GroupMeta {
  tone?: string
  preset?: QuickAddPreset
  /** 拖放落点（ADR-0044）；null = 不接收 */
  drop: TaskDropTarget | null
}

/** 一个分组：组头（折叠 · 计数 · + 添加）+ 列表 + 组内添加；也是拖放落点（空组在拖动中也露出来） */
function GroupBlock({
  g,
  rank,
  list,
  label,
  tone,
  drop,
  showHead,
  shut,
  onToggle,
  canAdd,
  adding,
  onAdd,
  preset,
  onOpen,
  showSpace,
  showList,
}: {
  g: string
  /** 组序：页面级 Shift 连选按它跨组排（ADR-0045） */
  rank: number
  list: Task[]
  label: string
  tone?: string
  drop: TaskDropTarget | null
  showHead: boolean
  shut: boolean
  onToggle: () => void
  canAdd: boolean
  adding: boolean
  onAdd: () => void
  preset: QuickAddPreset
  onOpen: (t: Task) => void
  showSpace: boolean
  showList: boolean
}) {
  const { t } = useTranslation()
  const dragging = useDraggingTask()
  // 组里最后一条被完成 / 移走后，组再留 8 秒（淡出与「撤销」走完）
  const keep = useLinger(list.length)
  const { setNodeRef, isOver } = useTaskDrop(drop, ':group')
  if (!list.length && !adding && !keep && !(dragging && drop)) return null
  return (
    <div
      ref={setNodeRef}
      className={cn('xz-group rounded-lg', isOver && 'xz-drop-over')}
      data-testid={`tasks-group-${g}`}
      data-drop-over={isOver ? '' : undefined}
    >
      {showHead ? (
        <div className="xz-group-head" data-tone={tone}>
          <button
            type="button"
            aria-expanded={!shut}
            onClick={onToggle}
            className="flex items-center gap-1.5"
          >
            <ChevronDown className="xz-group-chevron size-4" aria-hidden />
            {label}
          </button>
          <span className="xz-group-count">{list.length}</span>
          {canAdd ? (
            <button
              type="button"
              className="xz-group-add ms-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-normal text-fg-muted text-xs hover:bg-hover hover:text-fg"
              onClick={onAdd}
              data-testid="group-add"
            >
              <Plus className="size-3.5" aria-hidden />
              {t('tasksPage.add')}
            </button>
          ) : null}
        </div>
      ) : null}
      {shut ? null : (
        <div className="xz-group-body flex flex-col gap-1.5">
          {list.length || keep ? (
            <TaskList
              tasks={list}
              label={label}
              onOpen={onOpen}
              showSpace={showSpace}
              showList={showList}
              draggable
              groupKey={`tasks:${g}`}
              groupRank={rank}
              testId={`tasks-list-${g}`}
            />
          ) : dragging && drop ? (
            <p className="xz-drop-hint">{t('taskDnd.dropHere')}</p>
          ) : null}
          {adding ? (
            <QuickAddTask variant="compact" autoFocus preset={preset} testId="group-quick-add" />
          ) : null}
        </div>
      )}
    </div>
  )
}

/** 窄屏（< lg）：页头上方横向可滚的范围胶囊（智能清单 + 我的清单） */
function MobileScopes({ scope, onPick }: { scope: TaskScope; onPick: (s: TaskScope) => void }) {
  const { t } = useTranslation()
  const lists = useQuery(taskListsQuery)
  const chip = (key: string, on: boolean, label: ReactNode, s: TaskScope) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      onClick={() => onPick(s)}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm',
        on ? 'border-selected-border bg-selected font-medium' : 'border-border text-fg-muted',
      )}
    >
      {label}
    </button>
  )
  return (
    <div
      className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden"
      data-testid="tasks-scopes"
    >
      {SMART_VIEWS.map((v) =>
        chip(v, scope.kind === 'smart' && scope.view === v, t(`taskLists.smart.${v}`), {
          kind: 'smart',
          view: v,
        }),
      )}
      {flatLists(lists.data?.items ?? []).map((l) =>
        chip(
          l.id,
          scope.kind === 'list' && scope.id === l.id,
          <>
            <ListDot list={l} />
            {l.name}
          </>,
          { kind: 'list', id: l.id },
        ),
      )}
    </div>
  )
}

/** 窄屏浮动「+」：打开全局新任务对话框（同 `c`） */
function NewTaskFab() {
  const { t } = useTranslation()
  const setOpen = useNewTask((s) => s.setOpen)
  return (
    <button
      type="button"
      className="xz-fab lg:hidden"
      aria-label={t('task.newTask')}
      onClick={() => setOpen(true)}
      data-testid="tasks-fab"
    >
      <Plus className="size-6" />
    </button>
  )
}

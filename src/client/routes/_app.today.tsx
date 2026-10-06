/**
 * 今日（08 §2.3；REQ-TASK-005 · 017 · REQ-UI-009）：三段——逾期（dueAt < 今日 00:00）、今日到期、今日开始；
 * 段内按优先级降序、sortKey。边界由服务端按用户时区算（view=today）；前端分段用同一份 src/shared/tz.ts。
 * `done=1` 追加「今天完成的」折叠区；空态可直接输入（默认截止今天）。
 * 宽屏（REQ-UI-034）：顶部四枚计数卡（逾期 / 今日到期 / 今日开始 / 今日日程），右侧速览栏（GlanceRail）。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { dayRange } from '../../shared/tz.ts'
import { QuickAddTask } from '../components/domain/QuickAddTask.tsx'
import { SelectModeButton, TaskSelectionScope } from '../components/domain/TaskBatchBar.tsx'
import { TaskDetailSheet } from '../components/domain/TaskDetailSheet.tsx'
import { TaskList } from '../components/domain/TaskList.tsx'
import { WithRail } from '../components/layout/WithRail.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useLinger } from '../hooks/useLinger.ts'
import type { Me } from '../hooks/useMe.ts'
import { useTaskActions } from '../hooks/useTasks.ts'
import { occurrencesQuery } from '../lib/calendar-queries.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf, optUuid } from '../lib/search.ts'
import { useNewTask } from '../lib/stores.ts'
import { flattenPages, type Task, tasksInfiniteQuery } from '../lib/task-queries.ts'

export const Route = createFileRoute('/_app/today')({
  // `task`：详情就地打开（ADR-0053，原先跳到空间页）
  validateSearch: (s: Record<string, unknown>): { done?: '1'; task?: string } => ({
    done: optOneOf(['1'] as const)(s.done),
    task: optUuid(s.task),
  }),
  component: Today,
})

const byPriority = (a: Task, b: Task) => b.priority - a.priority || (a.sortKey < b.sortKey ? -1 : 1)

function Today() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  const { done, task: openTaskId } = Route.useSearch()
  const nav = useNavigate({ from: '/today' })
  const actions = useTaskActions()
  const setDefaults = useNewTask((s) => s.setDefaults)
  const range = useMemo(() => dayRange(me.timezone, new Date()), [me.timezone])
  const endOfToday = new Date(range.end.getTime() - 60_000).toISOString()
  useEffect(() => {
    setDefaults({ status: 'todo', dueAt: endOfToday })
    return () => setDefaults({})
  }, [setDefaults, endOfToday])

  const q = useInfiniteQuery(tasksInfiniteQuery({ view: 'today', sort: '-priority' }))
  const doneQ = useInfiniteQuery({
    ...tasksInfiniteQuery({
      status: 'done',
      dueAfter: range.start.toISOString(),
      dueBefore: range.end.toISOString(),
    }),
    enabled: done === '1',
  })
  const todayEvents = useQuery(occurrencesQuery(range.start.toISOString(), range.end.toISOString()))
  const skeleton = useDelayedFlag(q.isPending)
  const tasks = flattenPages(q.data)
  // 最后一条完成后先别换成空状态：留 8 秒给淡出与「撤销」（ADR-0045）
  const keepList = useLinger(tasks.length)
  const sections = useMemo(() => {
    const start = range.start.getTime()
    const end = range.end.getTime()
    const overdue = tasks
      .filter((x) => x.dueAt && new Date(x.dueAt).getTime() < start)
      .sort(byPriority)
    const dueToday = tasks
      .filter(
        (x) => x.dueAt && new Date(x.dueAt).getTime() >= start && new Date(x.dueAt).getTime() < end,
      )
      .sort(byPriority)
    const ids = new Set([...overdue, ...dueToday].map((x) => x.id))
    const scheduled = tasks.filter((x) => !ids.has(x.id)).sort(byPriority)
    return [
      ['overdue', overdue],
      ['dueToday', dueToday],
      ['scheduledToday', scheduled],
    ] as const
  }, [tasks, range])
  // 题记：本地时区的「9月25日 · 星期五」；摘要：各段计数，空时一句话
  const dateLine = useMemo(() => {
    const now = new Date()
    const fmt = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(me.locale || 'zh-CN', { ...o, timeZone: me.timezone }).format(now)
    return `${fmt({ month: 'long', day: 'numeric' })} · ${fmt({ weekday: 'long' })}`
  }, [me.locale, me.timezone])
  const summary = sections
    .filter(([, l]) => l.length)
    .map(([key, l]) => t(`task.summary.${key}`, { count: l.length }))
    .join(' · ')
  // 详情就地打开（ADR-0053）：留在今日，关闭回到原处
  const open = (task: Task) => nav({ search: (p) => ({ ...p, task: task.id }) })
  const closeTask = () => nav({ search: (p) => ({ ...p, task: undefined }) })
  const createToday = (title: string) =>
    actions.create({ title, status: 'todo', dueAt: endOfToday })

  const stats = [
    ...sections.map(([key, l]) => ({ key, n: l.length })),
    { key: 'events' as const, n: todayEvents.data?.length ?? 0 },
  ]

  return (
    <TaskSelectionScope scopeKey="today">
      <WithRail tz={me.timezone} weekStartsOn={me.weekStartsOn} testId="today-layout">
        <section data-testid="today">
          <PageHeader
            title={t('ui.page.today')}
            eyebrow={dateLine}
            description={summary || undefined}
          />
          {!q.isPending && !q.isError ? (
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="today-stats">
              {stats.map(({ key, n }) => (
                <div
                  key={key}
                  className={cn(
                    'paper flex flex-col gap-1 rounded-xl px-4 py-3',
                    key === 'overdue' && n > 0 && 'ring-1 ring-danger/30',
                  )}
                >
                  <span className="text-fg-muted text-xs">{t(`task.stat.${key}`)}</span>
                  <span
                    className={cn(
                      'font-display text-3xl tabular-nums leading-none',
                      key === 'overdue' && n > 0 && 'text-danger',
                    )}
                  >
                    {n}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mb-6 flex items-start gap-2">
            <QuickAddTask className="min-w-0 flex-1" />
            <SelectModeButton />
          </div>
          {q.isError ? (
            <div className="paper rounded-lg p-6 text-center" role="alert">
              <button type="button" className="text-sm underline" onClick={() => void q.refetch()}>
                {t('ui.action.retry')}
              </button>
            </div>
          ) : q.isPending ? (
            skeleton ? (
              <div className="flex flex-col gap-6" aria-busy="true">
                {[0, 1, 2].map((s) => (
                  <div key={s} className="flex flex-col gap-1">
                    {[0, 1, 2, 3].map((r) => (
                      <Skeleton key={r} className="h-(--xz-row-h)" />
                    ))}
                  </div>
                ))}
              </div>
            ) : null
          ) : !tasks.length && !keepList ? (
            <EmptyState
              illustration="today"
              title={t('ui.empty.today')}
              hint={t('ui.empty.todayHint')}
              input={{ placeholder: t('ui.empty.newTaskPlaceholder'), onSubmit: createToday }}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {sections.map(([key, list], rank) => (
                <TodaySection key={key} sectionKey={key} list={list} rank={rank} onOpen={open} />
              ))}
            </div>
          )}
          <div className="mt-8">
            <button
              type="button"
              className="flex items-center gap-1 font-medium text-fg-muted text-sm hover:text-fg"
              aria-expanded={done === '1'}
              onClick={() => nav({ search: done === '1' ? {} : { done: '1' }, replace: true })}
            >
              <Disclosure open={done === '1'} />
              {t('task.section.done')}
            </button>
            {done === '1' ? (
              <div className="mt-2">
                <TaskList
                  tasks={flattenPages(doneQ.data)}
                  label={t('task.section.done')}
                  onOpen={open}
                  showSpace
                  groupKey="today:done"
                  groupRank={9}
                  testId="list-done"
                />
              </div>
            ) : null}
          </div>
        </section>
      </WithRail>
      {openTaskId ? (
        <TaskDetailSheet taskId={openTaskId} onClose={closeTask} onOpenTask={open} />
      ) : null}
    </TaskSelectionScope>
  )
}

/** 今日的一个分段：最后一条被完成后再留 8 秒，「撤销」才不会随分段一起消失（ADR-0045） */
function TodaySection({
  sectionKey,
  list,
  rank,
  onOpen,
}: {
  sectionKey: string
  list: Task[]
  rank: number
  onOpen: (t: Task) => void
}) {
  const { t } = useTranslation()
  const keep = useLinger(list.length)
  if (!list.length && !keep) return null
  return (
    <div data-testid={`today-${sectionKey}`}>
      <h2
        className={cn(
          'mb-2 font-medium text-sm',
          sectionKey === 'overdue' ? 'text-danger' : 'text-fg-muted',
        )}
      >
        {t(`task.section.${sectionKey}`)} · {list.length}
      </h2>
      <TaskList
        tasks={list}
        label={t(`task.section.${sectionKey}`)}
        onOpen={onOpen}
        showSpace
        groupKey={`today:${sectionKey}`}
        groupRank={rank}
        testId={`list-${sectionKey}`}
      />
    </div>
  )
}

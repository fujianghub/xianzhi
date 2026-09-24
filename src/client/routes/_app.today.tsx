/**
 * 今日（08 §2.3；REQ-TASK-005 · 017 · REQ-UI-009）：三段——逾期（dueAt < 今日 00:00）、今日到期、今日开始；
 * 段内按优先级降序、sortKey。边界由服务端按用户时区算（view=today）；前端分段用同一份 src/shared/tz.ts。
 * `done=1` 追加「今天完成的」折叠区；空态可直接输入（默认截止今天）。
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { dayRange } from '../../shared/tz.ts'
import { TaskList } from '../components/domain/TaskList.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import type { Me } from '../hooks/useMe.ts'
import { useTaskActions } from '../hooks/useTasks.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'
import { useNewTask } from '../lib/stores.ts'
import { flattenPages, type Task, tasksInfiniteQuery } from '../lib/task-queries.ts'

export const Route = createFileRoute('/_app/today')({
  validateSearch: (s: Record<string, unknown>): { done?: '1' } => ({
    done: optOneOf(['1'] as const)(s.done),
  }),
  component: Today,
})

const byPriority = (a: Task, b: Task) => b.priority - a.priority || (a.sortKey < b.sortKey ? -1 : 1)

function Today() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  const { done } = Route.useSearch()
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
  const skeleton = useDelayedFlag(q.isPending)
  const tasks = flattenPages(q.data)
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
  const open = (task: Task) =>
    nav({
      to: '/spaces/$spaceSlug/tasks/$taskId',
      params: { spaceSlug: task.spaceSlug, taskId: task.id },
    })
  const createToday = (title: string) =>
    actions.create({ title, status: 'todo', dueAt: endOfToday })

  return (
    <section className="mx-auto max-w-3xl" data-testid="today">
      <h1 className="mb-6 font-semibold text-xl">{t('ui.page.today')}</h1>
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
      ) : !tasks.length ? (
        <EmptyState
          illustration="today"
          title={t('ui.empty.today')}
          hint={t('ui.empty.todayHint')}
          input={{ placeholder: t('ui.empty.newTaskPlaceholder'), onSubmit: createToday }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map(([key, list]) =>
            list.length ? (
              <div key={key} data-testid={`today-${key}`}>
                <h2
                  className={cn(
                    'mb-2 font-medium text-sm',
                    key === 'overdue' ? 'text-danger' : 'text-fg-muted',
                  )}
                >
                  {t(`task.section.${key}`)} · {list.length}
                </h2>
                <TaskList
                  tasks={list}
                  label={t(`task.section.${key}`)}
                  onOpen={open}
                  showSpace
                  testId={`list-${key}`}
                />
              </div>
            ) : null,
          )}
        </div>
      )}
      <div className="mt-8">
        <button
          type="button"
          className="flex items-center gap-1 font-medium text-fg-muted text-sm hover:text-fg"
          aria-expanded={done === '1'}
          onClick={() => nav({ search: done === '1' ? {} : { done: '1' }, replace: true })}
        >
          <ChevronRight
            className={cn(
              'size-4 transition-transform duration-(--xz-dur-fast)',
              done === '1' && 'rotate-90',
            )}
          />
          {t('task.section.done')}
        </button>
        {done === '1' ? (
          <div className="mt-2">
            <TaskList
              tasks={flattenPages(doneQ.data)}
              label={t('task.section.done')}
              onOpen={open}
              showSpace
              testId="list-done"
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

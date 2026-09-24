/**
 * 收件箱（08 §2.4；REQ-TASK-006 · REQ-UI-009）：status=inbox 且创建者或指派人为我，按创建时间倒序；
 * 每行可就地改空间 / 状态 / 截止，把它「衔回巢里」。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { TaskRow } from '../components/domain/TaskRow.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useTaskActions } from '../hooks/useTasks.ts'
import { spacesQuery } from '../lib/space-queries.ts'
import { useNewTask } from '../lib/stores.ts'
import { flattenPages, TASK_STATUSES, type Task, tasksInfiniteQuery } from '../lib/task-queries.ts'

export const Route = createFileRoute('/_app/inbox')({ component: Inbox })

function Inbox() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const actions = useTaskActions()
  const setDefaults = useNewTask((s) => s.setDefaults)
  useEffect(() => {
    setDefaults({ status: 'inbox' })
    return () => setDefaults({})
  }, [setDefaults])
  const q = useInfiniteQuery(tasksInfiniteQuery({ view: 'inbox', sort: '-createdAt' }))
  const { data: spaces = [] } = useQuery(spacesQuery())
  const skeleton = useDelayedFlag(q.isPending)
  const tasks = flattenPages(q.data)
  const open = (task: Task) =>
    nav({
      to: '/spaces/$spaceSlug/tasks/$taskId',
      params: { spaceSlug: task.spaceSlug, taskId: task.id },
    })
  const writable = spaces.filter((s) => s.myRole === 'admin' || s.myRole === 'member')
  const selectCls = 'h-7 rounded-md border border-border bg-surface px-1 text-xs'
  return (
    <section className="mx-auto max-w-3xl" data-testid="inbox">
      <h1 className="mb-6 font-semibold text-xl">{t('ui.page.inbox')}</h1>
      {q.isPending ? (
        skeleton ? (
          <div className="flex flex-col gap-1" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
              <Skeleton key={i} className="h-(--xz-row-h)" />
            ))}
          </div>
        ) : null
      ) : !tasks.length ? (
        <EmptyState
          illustration="inbox"
          title={t('ui.empty.inbox')}
          hint={t('ui.empty.inboxHint')}
          input={{
            placeholder: t('ui.empty.newTaskPlaceholder'),
            onSubmit: (title) => actions.create({ title, status: 'inbox' }),
          }}
        />
      ) : (
        <ul className="paper overflow-hidden rounded-lg" aria-label={t('ui.page.inbox')}>
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 border-divider border-b pr-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <TaskRow
                  asRow={false}
                  task={task}
                  onToggle={(x) => void actions.complete(x).catch(() => undefined)}
                  onOpen={open}
                />
              </div>
              <select
                aria-label={t('task.moveToSpace')}
                className={selectCls}
                value={task.spaceId}
                onChange={(e) =>
                  void actions.patch(task, { spaceId: e.target.value }).catch(() => undefined)
                }
              >
                {writable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isPersonal ? t('space.personal') : s.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('task.statusLabel')}
                className={selectCls}
                value={task.status}
                onChange={(e) =>
                  void actions
                    .patch(task, { status: e.target.value as Task['status'] })
                    .catch(() => undefined)
                }
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`task.status.${s}`)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

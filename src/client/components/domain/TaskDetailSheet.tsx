/**
 * 任务详情 Sheet（08 §2.7、04 §6；REQ-TASK-012 · 014 · REQ-UI-022）：
 * 无保存按钮，就地编辑失焦即 PATCH（带 ifUpdatedAt，经 optimisticPatch：409 用 current 覆盖、失败回滚）；
 * 保存成功显示「已保存 · 刚刚」。属性：状态 / 优先级 / 指派 / 截止 / 计划 / 标签 / 预估；描述 liteKit；子任务；关注者。
 * Esc 关闭回到列表（焦点恢复由列表负责）。评论线程随 T1-023 接入。
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useMe } from '../../hooks/useMe.ts'
import { useSpaceCandidates } from '../../hooks/useMembers.ts'
import { type TaskPatch, useTaskActions } from '../../hooks/useTasks.ts'
import { api, unwrap } from '../../lib/api.ts'
import { pushRecent } from '../../lib/recent.ts'
import { spaceQuery } from '../../lib/space-queries.ts'
import { useCommandContext } from '../../lib/stores.ts'
import {
  flattenPages,
  TASK_STATUSES,
  type Task,
  taskQuery,
  tasksInfiniteQuery,
} from '../../lib/task-queries.ts'
import { Button } from '../ui/button.tsx'
import { InlineEdit } from '../ui/inline-edit.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { Comments } from './Comments.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'
import { TagPicker } from './TagPicker.tsx'
import { TaskRow } from './TaskRow.tsx'

const LiteEditor = lazy(() => import('../../editor/LiteEditor.tsx'))

interface Watcher {
  userId: string
  displayName: string
}

/** datetime-local 与 ISO 互转（按浏览器本地时区；显示用用户时区的场景见 lib/time）。 */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const selectCls =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-selected-border focus:bg-surface outline-none'

export function TaskDetailSheet({
  taskId,
  onClose,
  onOpenTask,
}: {
  taskId: string
  onClose: () => void
  onOpenTask: (t: Task) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const actions = useTaskActions()
  const { data: task, isPending, isError } = useQuery(taskQuery(taskId))
  // ⌘K：详情打开时上下文为该任务
  const setCmdFocus = useCommandContext((s) => s.setFocus)
  useEffect(() => {
    setCmdFocus({ kind: 'task', id: taskId })
    pushRecent(taskId)
    return () => setCmdFocus(null)
  }, [taskId, setCmdFocus])
  const { data: space } = useQuery({ ...spaceQuery(task?.spaceId ?? ''), enabled: !!task })
  const subtasks = useInfiniteQuery({
    ...tasksInfiniteQuery({ parentId: taskId, sort: 'createdAt' }, 50),
    enabled: !!task && !task.parentId,
  })
  const watchers = useQuery({
    queryKey: ['task', taskId, 'watchers'],
    queryFn: () =>
      unwrap<{ items: Watcher[] }>(api.tasks[':id'].watchers.$get({ param: { id: taskId } })).then(
        (r) => r.items,
      ),
    enabled: !!task,
  })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [sub, setSub] = useState('')

  const save = async (change: TaskPatch) => {
    if (!task) return
    try {
      await actions.patch(task, change)
      setSavedAt(Date.now())
    } catch {
      /* optimisticPatch 已提示并回滚 / 覆盖 */
    }
  }
  const canWrite = space?.myRole === 'admin' || space?.myRole === 'member'
  const candidates = useSpaceCandidates(task?.spaceId)
  const watching = (watchers.data ?? []).some((w) => w.userId === me?.id)
  const toggleWatch = async () => {
    if (!me) return
    try {
      if (watching)
        await unwrap(
          api.tasks[':id'].watchers[':userId'].$delete({ param: { id: taskId, userId: me.id } }),
        )
      else
        await unwrap(
          api.tasks[':id'].watchers.$post({ param: { id: taskId }, json: { userId: me.id } }),
        )
      await qc.invalidateQueries({ queryKey: ['task', taskId, 'watchers'] })
    } catch {
      toast.error(t('task.saveFailed'))
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(100vw,36rem)] overflow-y-auto p-0"
        data-testid="task-sheet"
      >
        {isError ? (
          <div className="p-6">
            <SheetTitle>{t('task.notFound')}</SheetTitle>
            <SheetDescription className="sr-only">{t('task.notFound')}</SheetDescription>
          </div>
        ) : isPending || !task ? (
          <div className="flex flex-col gap-3 p-6" aria-busy="true">
            <SheetTitle className="sr-only">{t('ui.loading')}</SheetTitle>
            <SheetDescription className="sr-only">{t('ui.loading')}</SheetDescription>
            <Skeleton className="h-8 w-3/4" />
            {Array.from({ length: 6 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        ) : (
          <div className="paper min-h-full p-6">
            <SheetTitle className="sr-only">{task.title}</SheetTitle>
            <SheetDescription className="sr-only">{t('task.task')}</SheetDescription>
            <div className="flex items-start gap-2 pr-8">
              <PriorityIcon priority={task.priority} className="mt-2" />
              <InlineEdit
                value={task.title}
                onSave={(v) => save({ title: v })}
                label={t('task.task')}
                className="font-semibold text-xl"
                testId="task-title"
                multiline
              />
            </div>
            <div
              className="mt-1 flex h-5 items-center gap-2 px-1 text-fg-muted text-xs"
              aria-live="polite"
            >
              {savedAt ? (
                <span data-testid="saved-hint">{t('task.savedJustNow')}</span>
              ) : (
                <RelativeTime date={task.updatedAt} />
              )}
            </div>
            <fieldset disabled={!canWrite} className="mt-4 border-divider border-y py-2">
              <legend className="sr-only">{t('task.task')}</legend>
              <Field label={t('task.statusLabel')}>
                <select
                  className={selectCls}
                  value={task.status}
                  onChange={(e) => save({ status: e.target.value as Task['status'] })}
                  data-testid="field-status"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`task.status.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('task.priorityLabel')}>
                <select
                  className={selectCls}
                  value={task.priority}
                  onChange={(e) => save({ priority: Number(e.target.value) })}
                  data-testid="field-priority"
                >
                  {[0, 1, 2, 3, 4].map((p) => (
                    <option key={p} value={p}>
                      {t(`task.priority.${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('task.assignee')}>
                <select
                  className={selectCls}
                  value={task.assigneeId ?? ''}
                  onChange={(e) => save({ assigneeId: e.target.value || null })}
                  data-testid="field-assignee"
                >
                  <option value="">{t('task.unassigned')}</option>
                  {candidates.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName || m.name}
                    </option>
                  ))}
                  {task.assignee && !candidates.some((m) => m.userId === task.assigneeId) ? (
                    <option value={task.assignee.id}>{task.assignee.displayName}</option>
                  ) : null}
                </select>
              </Field>
              <Field label={t('task.dueAt')}>
                <input
                  type="datetime-local"
                  className={selectCls}
                  defaultValue={toLocalInput(task.dueAt)}
                  key={`due-${task.updatedAt}`}
                  onBlur={(e) =>
                    fromLocalInput(e.target.value) !== task.dueAt &&
                    save({ dueAt: fromLocalInput(e.target.value) })
                  }
                  data-testid="field-due"
                />
              </Field>
              <Field label={t('task.scheduledAt')}>
                <input
                  type="datetime-local"
                  className={selectCls}
                  defaultValue={toLocalInput(task.scheduledAt)}
                  key={`sch-${task.updatedAt}`}
                  onBlur={(e) =>
                    fromLocalInput(e.target.value) !== task.scheduledAt &&
                    save({ scheduledAt: fromLocalInput(e.target.value) })
                  }
                />
              </Field>
              <Field label={t('task.tags')}>
                <TagPicker
                  value={task.tags}
                  onChange={(ids) => save({ tagIds: ids })}
                  disabled={!canWrite}
                />
              </Field>
              <Field label={t('task.estimate')}>
                <input
                  type="number"
                  min={0}
                  className={selectCls}
                  defaultValue={task.estimateMinutes ?? ''}
                  key={`est-${task.updatedAt}`}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value)
                    if (v !== task.estimateMinutes) void save({ estimateMinutes: v })
                  }}
                />
              </Field>
            </fieldset>
            <section className="mt-5">
              <h3 className="mb-2 font-medium text-fg-muted text-sm">{t('task.description')}</h3>
              <Suspense fallback={<Skeleton className="h-16" />}>
                <LiteEditor
                  value={task.descriptionPm ?? null}
                  variant="description"
                  placeholder={t('task.descriptionPlaceholder')}
                  editable={canWrite}
                  onBlur={(doc, changed) => {
                    if (changed) void save({ descriptionPm: doc })
                  }}
                />
              </Suspense>
            </section>
            {!task.parentId ? (
              <section className="mt-6">
                <h3 className="mb-2 font-medium text-fg-muted text-sm">{t('task.subtask')}</h3>
                <div className="overflow-hidden rounded-md border border-divider">
                  {flattenPages(subtasks.data).map((s) => (
                    <TaskRow
                      asRow={false}
                      key={s.id}
                      task={s}
                      onToggle={(x) =>
                        void (
                          x.status === 'done' ? actions.uncomplete(x) : actions.complete(x)
                        ).catch(() => undefined)
                      }
                      onOpen={onOpenTask}
                    />
                  ))}
                </div>
                {canWrite ? (
                  <form
                    className="mt-2"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const v = sub.trim()
                      if (!v) return
                      await actions
                        .create({
                          title: v,
                          spaceId: task.spaceId,
                          parentId: task.id,
                          status: 'todo',
                        })
                        .catch(() => toast.error(t('task.saveFailed')))
                      setSub('')
                    }}
                  >
                    <input
                      value={sub}
                      onChange={(e) => setSub(e.target.value)}
                      placeholder={t('task.addSubtask')}
                      aria-label={t('task.addSubtask')}
                      className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border"
                      data-testid="subtask-input"
                    />
                  </form>
                ) : null}
              </section>
            ) : null}
            <section className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium text-fg-muted text-sm">{t('task.watchers')}</h3>
                <Button size="sm" variant="ghost" onClick={toggleWatch} data-testid="watch-toggle">
                  {watching ? <EyeOff /> : <Eye />}
                  {watching ? t('task.unfollow') : t('task.follow')}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5 text-sm" data-testid="watchers">
                {(watchers.data ?? []).map((w) => (
                  <li key={w.userId} className="rounded-full bg-surface-2 px-2 py-0.5">
                    {w.displayName}
                  </li>
                ))}
              </ul>
            </section>
            {me ? (
              <section className="mt-6" data-testid="task-comments">
                <h3 className="mb-2 font-medium text-fg-muted text-sm">{t('comment.title')}</h3>
                <Comments
                  targetType="task"
                  targetId={task.id}
                  spaceId={task.spaceId}
                  me={me}
                  canResolveAll={
                    task.creatorId === me.id ||
                    me.workspaceRole === 'owner' ||
                    me.workspaceRole === 'admin'
                  }
                />
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

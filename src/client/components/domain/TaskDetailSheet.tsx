/**
 * 任务详情 Sheet（08 §2.7、04 §6；REQ-TASK-012 · 014 · REQ-UI-022）：
 * 无保存按钮，就地编辑失焦即 PATCH（带 ifUpdatedAt，经 optimisticPatch：409 用 current 覆盖、失败回滚）；
 * 保存成功显示「已保存 · 刚刚」。属性：状态 / 优先级 / 指派 / 截止 / 计划 / 标签 / 预估；描述 liteKit；子任务；关注者。
 * Esc 关闭回到列表（焦点恢复由列表负责）。评论线程随 T1-023 接入。
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, EyeOff, X } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ALL_DAY_MINUTES } from '../../../shared/quick-add.ts'
import { localDateTimeOf, zonedMidnight } from '../../../shared/tz.ts'
import { useMe } from '../../hooks/useMe.ts'
import { useMediaQuery } from '../../hooks/useMediaQuery.ts'
import { useSpaceCandidates } from '../../hooks/useMembers.ts'
import { useSharedTarget } from '../../hooks/useSharedElement.ts'
import { type TaskPatch, useTaskActions } from '../../hooks/useTasks.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { pushRecent } from '../../lib/recent.ts'
import { spaceQuery } from '../../lib/space-queries.ts'
import { useCommandContext } from '../../lib/stores.ts'
import { flattenPages, type Task, taskQuery, tasksInfiniteQuery } from '../../lib/task-queries.ts'
import { dueLabel } from '../../lib/time.ts'
import { DetailDock } from '../layout/DetailDock.tsx'
import { Avatar } from '../ui/avatar.tsx'
import { Button } from '../ui/button.tsx'
import { InlineEdit } from '../ui/inline-edit.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { RelativeTime, useUserTimeZone } from '../ui/relative-time.tsx'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { Comments } from './Comments.tsx'
import { PriorityChip } from './PriorityIcon.tsx'
import { TagPicker } from './TagPicker.tsx'
import {
  DuePicker,
  type DueValue,
  ListDot,
  ListPicker,
  PriorityPicker,
  StatusPicker,
} from './TaskPickers.tsx'
import { TaskRow } from './TaskRow.tsx'

const LiteEditor = lazy(() => import('../../editor/LiteEditor.tsx'))

interface Watcher {
  userId: string
  displayName: string
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * 截止 / 计划（ADR-0050 · 0053）：与快速添加 / 任务行同一个日期选择器（含相对日期快选），按**用户时区**；弹层关闭时一次提交。
 * 不选时间 = 全天：截止落 23:59，计划落当天 00:00（计划是开始时刻）。fieldset disabled 会一并禁用触发按钮。
 */
function DateField({
  iso,
  kind,
  onSave,
  testId,
}: {
  iso: string | null
  kind: 'due' | 'scheduled'
  onSave: (v: string | null) => void
  testId: string
}) {
  const { t } = useTranslation()
  const { tz, locale } = useUserTimeZone()
  const allDay = kind === 'due' ? ALL_DAY_MINUTES : 0
  const pending = useRef<{ v: DueValue | null } | null>(null)
  const local = iso ? localDateTimeOf(tz, new Date(iso)) : null
  const value: DueValue | null = local
    ? { date: local.date, minutes: local.minutes === allDay ? null : local.minutes }
    : null
  const overdue =
    kind === 'due' && iso && new Date(iso).getTime() < Date.now() ? 'text-danger' : undefined
  return (
    <DuePicker
      value={value}
      onChange={(v) => {
        pending.current = { v }
      }}
      onOpenChange={(o) => {
        if (o || !pending.current) return
        const v = pending.current.v
        pending.current = null
        const next = v
          ? new Date(
              zonedMidnight(tz, v.date).getTime() + (v.minutes ?? allDay) * 60_000,
            ).toISOString()
          : null
        if (next !== iso) onSave(next)
      }}
      trigger={
        <button
          type="button"
          className={cn(selectCls, 'text-start', !iso && 'text-fg-faint', overdue)}
          data-testid={testId}
        >
          {iso && value
            ? `${dueLabel(new Date(iso), new Date(), locale, tz)}${value.minutes != null ? ` ${hhmm(value.minutes)}` : ''}`
            : t('picker.due.none')}
        </button>
      }
    />
  )
}

/** 指派选择器（ADR-0053）：替代原生 select；头像 + 名字，当前值打勾 */
function AssigneePicker({
  value,
  current,
  candidates,
  onChange,
}: {
  value: string | null
  current: { id: string; displayName: string } | null
  candidates: { userId: string; displayName?: string | null; name: string }[]
  onChange: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const people = [
    ...candidates.map((m) => ({ id: m.userId, name: m.displayName || m.name })),
    ...(current && !candidates.some((m) => m.userId === current.id)
      ? [{ id: current.id, name: current.displayName }]
      : []),
  ]
  const pick = (id: string | null) => {
    if (id !== value) onChange(id)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            selectCls,
            'flex items-center gap-2 text-start',
            !current && 'text-fg-faint',
          )}
          data-testid="field-assignee"
        >
          {current ? (
            <>
              <Avatar id={current.id} name={current.displayName} size={20} />
              <span className="truncate">{current.displayName}</span>
            </>
          ) : (
            t('task.unassigned')
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1" data-testid="assignee-picker">
        <div className="max-h-64 overflow-y-auto">
          <button type="button" className="xz-picker-item" onClick={() => pick(null)}>
            <span className="grid size-5 place-items-center rounded-full border border-border border-dashed" />
            <span className="flex-1 text-fg-muted">{t('task.unassigned')}</span>
            {value === null ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
          </button>
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              className="xz-picker-item"
              onClick={() => pick(m.id)}
              data-user-id={m.id}
            >
              <Avatar id={m.id} name={m.name} size={20} />
              <span className="flex-1 truncate">{m.name}</span>
              {value === m.id ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const selectCls =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-selected-border focus:bg-surface outline-none'

export function TaskDetailSheet({
  taskId,
  onClose,
  onOpenTask,
  variant = 'auto',
}: {
  taskId: string
  onClose: () => void
  onOpenTask: (t: Task) => void
  /**
   * panel = 右侧详情坞（ADR-0054 §B：滴答清单式常驻右栏，不遮挡列表）；sheet = 覆盖式抽屉；
   * auto（默认）= ≥ lg 用坞、更窄用抽屉——今日 / 收件箱 / 空间 / 日历 / 任务页一致
   */
  variant?: 'sheet' | 'panel' | 'auto'
}) {
  const wide = useMediaQuery('(min-width: 64rem)')
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const actions = useTaskActions()
  const { data: task, isPending, isError } = useQuery(taskQuery(taskId))
  const sharedTarget = useSharedTarget(taskId)
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

  // 保存排队：前一次未回来就发下一次会带旧 ifUpdatedAt 撞 409（失焦保存紧跟插图保存，
  // debug/2026-10-02-task-image-upload-lost-on-save）；每次从缓存取最新的 updatedAt
  const saving = useRef<Promise<void>>(Promise.resolve())
  const save = (change: TaskPatch) => {
    saving.current = saving.current.then(async () => {
      const cur = qc.getQueryData<Task>(taskQuery(taskId).queryKey) ?? task
      if (!cur) return
      try {
        await actions.patch(cur, change)
        setSavedAt(Date.now())
      } catch {
        /* optimisticPatch 已提示并回滚 / 覆盖 */
      }
    })
    return saving.current
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

  const panel = variant === 'panel' || (variant === 'auto' && wide)
  // 常驻栏 Esc 关闭（同 Sheet，ADR-0053）：按键来自栏内或焦点落在 body（如改完标题后）时关；
  // 来自列表、别处输入框、弹层（渲染在 body 里的 Radix 内容，自己处理 Esc）的不管
  const panelRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!panel) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      const target = e.target as Node | null
      const fromPanel = !!target && !!panelRef.current?.contains(target)
      if (!fromPanel && target !== document.body && target !== document.documentElement) return
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [panel])
  const Title = panel ? PanelTitle : SheetTitle
  const Description = panel ? PanelDescription : SheetDescription
  const body = (
    <>
      {isError ? (
        <div className="p-6">
          <Title>{t('task.notFound')}</Title>
          <Description className="sr-only">{t('task.notFound')}</Description>
        </div>
      ) : isPending || !task ? (
        <div className="flex flex-col gap-3 p-6" aria-busy="true">
          <Title className="sr-only">{t('ui.loading')}</Title>
          <Description className="sr-only">{t('ui.loading')}</Description>
          <Skeleton className="h-8 w-3/4" />
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : (
        <div className="paper min-h-full p-6">
          <Title className="sr-only">{task.title}</Title>
          <Description className="sr-only">{t('task.task')}</Description>
          <div ref={sharedTarget} className="flex items-start gap-2 pr-8">
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
            <span className="xz-status-pill" data-status={task.status}>
              {t(`task.status.${task.status}`)}
            </span>
            <PriorityChip priority={task.priority} />
            {savedAt ? (
              <span data-testid="saved-hint">{t('task.savedJustNow')}</span>
            ) : (
              <RelativeTime date={task.updatedAt} />
            )}
          </div>
          <div className="mt-4 border-divider border-t pt-2">
            {/* 清单是本人的私人分类（ADR-0044）：只读成员也能归 */}
            <Field label={t('taskLists.list')}>
              <ListPicker
                value={task.list?.id ?? null}
                onChange={(listId) => void save({ listId })}
                trigger={
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-hover"
                    data-testid="field-list"
                  >
                    {task.list ? (
                      <>
                        <ListDot list={task.list} />
                        {task.list.name}
                      </>
                    ) : (
                      <span className="text-fg-muted">{t('taskLists.unlisted')}</span>
                    )}
                  </button>
                }
              />
            </Field>
          </div>
          <fieldset disabled={!canWrite} className="border-divider border-b py-2">
            <legend className="sr-only">{t('task.task')}</legend>
            <Field label={t('task.statusLabel')}>
              <StatusPicker
                value={task.status}
                onChange={(status) => void save({ status })}
                trigger={
                  <button
                    type="button"
                    className={cn(selectCls, 'flex items-center text-start')}
                    data-testid="field-status"
                  >
                    <span className="xz-status-pill" data-status={task.status}>
                      {t(`task.status.${task.status}`)}
                    </span>
                  </button>
                }
              />
            </Field>
            <Field label={t('task.priorityLabel')}>
              <PriorityPicker
                value={task.priority}
                onChange={(priority) => {
                  if (priority !== task.priority) void save({ priority })
                }}
                trigger={
                  <button
                    type="button"
                    className={cn(selectCls, 'flex items-center text-start')}
                    data-testid="field-priority"
                  >
                    {task.priority ? (
                      <PriorityChip priority={task.priority} />
                    ) : (
                      <span className="text-fg-faint">{t('task.priority.0')}</span>
                    )}
                  </button>
                }
              />
            </Field>
            <Field label={t('task.assignee')}>
              <AssigneePicker
                value={task.assigneeId}
                current={task.assignee}
                candidates={candidates}
                onChange={(assigneeId) => void save({ assigneeId })}
              />
            </Field>
            <Field label={t('task.dueAt')}>
              <DateField
                iso={task.dueAt}
                kind="due"
                onSave={(dueAt) => void save({ dueAt })}
                testId="field-due"
              />
            </Field>
            <Field label={t('task.scheduledAt')}>
              <DateField
                iso={task.scheduledAt}
                kind="scheduled"
                onSave={(scheduledAt) => void save({ scheduledAt })}
                testId="field-scheduled"
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
                uploadTaskId={task.id}
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
    </>
  )
  if (panel)
    return (
      <DetailDock
        ref={panelRef}
        label={task?.title ?? t('task.task')}
        testId="task-sheet"
        variant="panel"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('task.close')}
          className="absolute top-3 right-3 z-10 grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          data-testid="task-panel-close"
        >
          <X className="size-4" />
        </button>
        {body}
      </DetailDock>
    )
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(100vw,36rem)] overflow-y-auto p-0"
        data-testid="task-sheet"
      >
        {body}
      </SheetContent>
    </Sheet>
  )
}

const PanelTitle = ({ className, children }: { className?: string; children: ReactNode }) => (
  <h2 className={className}>{children}</h2>
)
const PanelDescription = ({ className, children }: { className?: string; children: ReactNode }) => (
  <p className={className}>{children}</p>
)

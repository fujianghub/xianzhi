/**
 * 看板（08 §2.6 board、04 §6、06 §4；REQ-TASK-003 · 009 · REQ-UI-019）：
 * - 六列 = 六个状态，每列独立请求（一列失败不影响其他列，列级重试）；done / cancelled 默认折叠。
 * - 拖动：拾起倾斜 1.5° 放大、经过的列变亮、放下弹簧归位；放在列外 → 弹回并晃动。
 * - 放下即本地更新（≤ 200ms），只发一条 POST /tasks/batch（status + sortKey + ifUpdatedAt）；失败 / 409 → 回原列并提示。
 */
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { generateKeyBetween } from 'fractional-indexing'
import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useHoverIntent } from '../../hooks/useHoverIntent.ts'
import { markSharedSource } from '../../hooks/useSharedElement.ts'
import { useTaskActions } from '../../hooks/useTasks.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { useCommandContext, usePeek } from '../../lib/stores.ts'
import {
  flattenPages,
  TASK_STATUSES,
  type Task,
  type TaskListParams,
  type TaskStatus,
  tasksInfiniteQuery,
} from '../../lib/task-queries.ts'
import { dueLabel } from '../../lib/time.ts'
import { AnimatedCount } from '../ui/animated-count.tsx'
import { Avatar } from '../ui/avatar.tsx'
import { Button } from '../ui/button.tsx'
import { Disclosure } from '../ui/disclosure.tsx'
import { useUserTimeZone } from '../ui/relative-time.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'

type Override = { status: TaskStatus; sortKey: string }

function Card({ task, dragging, shaking }: { task: Task; dragging?: boolean; shaking?: boolean }) {
  const { tz, locale } = useUserTimeZone()
  return (
    <div
      className={cn(
        'paper flex cursor-grab flex-col gap-2 rounded-lg p-3 text-sm shadow-(--xz-shadow-soft) active:cursor-grabbing',
        dragging && 'rotate-[1.5deg] scale-[1.03] shadow-(--xz-shadow-float)',
        shaking && 'animate-[xz-shake_var(--xz-dur-slow)_var(--xz-ease-out)]',
      )}
      data-testid="kanban-card"
      data-task-id={task.id}
    >
      <span className="text-left">{task.title}</span>
      <div className="flex items-center gap-2 text-fg-muted text-xs">
        <PriorityIcon priority={task.priority} />
        {task.dueAt ? (
          <span className="tabular-nums">
            {dueLabel(new Date(task.dueAt), new Date(), locale, tz)}
          </span>
        ) : null}
        <span className="flex-1" />
        {task.assignee ? (
          <Avatar id={task.assignee.id} name={task.assignee.displayName} size={20} />
        ) : null}
      </div>
    </div>
  )
}

function SortableCard({
  task,
  shaking,
  onOpen,
}: {
  task: Task
  shaking: boolean
  onOpen: (t: Task) => void
}) {
  const setCmdFocus = useCommandContext((st) => st.setFocus)
  const openPeek = usePeek((st) => st.open)
  const hover = useHoverIntent(() =>
    openPeek({ kind: 'task', id: task.id, spaceSlug: task.spaceSlug }),
  )
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  })
  // 整张卡片是唯一的可交互元素（axe nested-interactive）：点击 / 回车打开，空格拿起 / 放下
  return (
    // biome-ignore lint/a11y/useSemanticElements: dnd-kit 的可排序节点需要块级容器承载卡片内容，<button> 不允许内含块级元素
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--xz-focus-color)',
        isDragging && 'opacity-30',
      )}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={(e) => {
        markSharedSource(e.currentTarget)
        onOpen(task)
      }}
      onFocus={() => setCmdFocus({ kind: 'task', id: task.id })}
      {...hover}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          markSharedSource(e.currentTarget)
          onOpen(task)
          return
        }
        if (e.key === 'p') {
          e.preventDefault()
          openPeek({ kind: 'task', id: task.id, spaceSlug: task.spaceSlug })
          return
        }
        listeners?.onKeyDown?.(e)
      }}
    >
      <Card task={task} shaking={shaking} />
    </div>
  )
}

function Column({
  status,
  tasks,
  loading,
  error,
  retry,
  over,
  collapsed,
  toggle,
  shakeId,
  onOpen,
  onCreate,
}: {
  status: TaskStatus
  tasks: Task[]
  loading: boolean
  error: boolean
  retry: () => void
  over: boolean
  collapsed: boolean
  toggle: () => void
  shakeId: string | null
  onOpen: (t: Task) => void
  onCreate: (status: TaskStatus, title: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const { setNodeRef } = useDroppable({ id: `col:${status}`, data: { status } })
  const [text, setText] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    await onCreate(status, v)
    setText('')
  }
  return (
    <section
      ref={setNodeRef}
      aria-label={t(`task.status.${status}`)}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg bg-surface-2/60 p-2 transition-colors duration-(--xz-dur-fast)',
        over && 'bg-selected',
        collapsed && 'w-12',
      )}
      data-testid="kanban-column"
      data-status={status}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 px-1.5 py-1 text-left font-medium text-sm"
        aria-expanded={!collapsed}
      >
        <Disclosure open={!collapsed} />
        {collapsed ? null : <span className="flex-1">{t(`task.status.${status}`)}</span>}
        <AnimatedCount value={tasks.length} className="text-fg-muted text-xs" />
      </button>
      {collapsed ? null : (
        <>
          <form onSubmit={submit} className="px-1 pt-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('task.newTaskPlaceholder')}
              aria-label={`${t('task.newTask')} · ${t(`task.status.${status}`)}`}
              className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none placeholder:text-fg-muted focus:border-selected-border focus:bg-surface"
              data-testid="column-add"
            />
          </form>
          {error ? (
            <div className="p-2 text-danger text-xs" role="alert">
              <Button size="sm" variant="ghost" onClick={retry}>
                {t('ui.action.retry')}
              </Button>
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-2 p-1" aria-busy="true">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : (
            <SortableContext
              id={status}
              items={tasks.map((x) => x.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex min-h-16 flex-col gap-2 p-1">
                {tasks.map((task) => (
                  <SortableCard
                    key={task.id}
                    task={task}
                    shaking={shakeId === task.id}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </>
      )}
    </section>
  )
}

/** 碰撞：指针所在的可放置区优先；指针不在任何区时退回矩形相交——拖到列外即无落点（REQ-UI-019 弹回）。 */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  return within.length ? within : rectIntersection(args)
}

/** 放下的弹簧归位：dnd-kit 用 WAAPI，不认 CSS 变量，运行时从 tokens 取值（不变量 5）。 */
function dropAnimation() {
  const css = getComputedStyle(document.documentElement)
  const duration = Number.parseFloat(css.getPropertyValue('--xz-dur-slow')) || 0
  const easing = css.getPropertyValue('--xz-ease-spring').trim() || 'ease-out'
  return { duration, easing }
}

export function Board({
  params,
  onOpen,
}: {
  params: TaskListParams & { spaceId: string }
  onOpen: (t: Task) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const actions = useTaskActions()
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(new Set(['done', 'cancelled']))
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map())
  const [active, setActive] = useState<Task | null>(null)
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null)
  const [shakeId, setShakeId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // 键盘：空格拿起 / 放下（回车留给「打开」）
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
  const cols = TASK_STATUSES.map((s) =>
    // biome-ignore lint/correctness/useHookAtTopLevel: 固定六列，调用次数与顺序恒定
    useInfiniteQuery(tasksInfiniteQuery({ ...params, status: s, sort: 'sortKey' }, 100)),
  )
  const all = useMemo(() => cols.flatMap((c) => flattenPages(c.data)), [cols])
  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>(TASK_STATUSES.map((s) => [s, []]))
    for (const task of all) {
      const o = overrides.get(task.id)
      const x = o ? { ...task, ...o } : task
      m.get(x.status)?.push(x)
    }
    for (const list of m.values())
      list.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    return m
  }, [all, overrides])

  const shake = (id: string) => {
    setShakeId(id)
    setTimeout(() => setShakeId(null), 500)
  }
  const statusOf = (id: string | number | undefined): TaskStatus | null => {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4) as TaskStatus
    const task = all.find((x) => x.id === id)
    return task ? (overrides.get(task.id)?.status ?? task.status) : null
  }
  const onDragStart = (e: DragStartEvent) =>
    setActive(all.find((x) => x.id === e.active.id) ?? null)
  const onDragOver = (e: DragOverEvent) => setOverStatus(statusOf(e.over?.id))
  const onDragEnd = async (e: DragEndEvent) => {
    const task = all.find((x) => x.id === e.active.id)
    setActive(null)
    setOverStatus(null)
    if (!task) return
    const target = statusOf(e.over?.id)
    if (!target || collapsed.has(target)) {
      shake(task.id) // 放不下：弹回并晃动（REQ-UI-019）
      return
    }
    const list = (byStatus.get(target) ?? []).filter((x) => x.id !== task.id)
    let index = list.length
    if (e.over && !String(e.over.id).startsWith('col:')) {
      const i = list.findIndex((x) => x.id === e.over?.id)
      if (i >= 0) index = i + (e.delta.y > 0 ? 1 : 0)
    }
    const before = list[index - 1]?.sortKey ?? null
    const after = list[index]?.sortKey ?? null
    let sortKey: string
    try {
      sortKey = generateKeyBetween(before, after)
    } catch {
      sortKey = generateKeyBetween(before, null)
    }
    const cur = overrides.get(task.id) ?? { status: task.status, sortKey: task.sortKey }
    if (
      cur.status === target &&
      list[index - 1]?.id === byStatus.get(target)?.[index - 1]?.id &&
      cur.sortKey === sortKey
    )
      return
    setOverrides((m) => new Map(m).set(task.id, { status: target, sortKey }))
    try {
      await actions.batch([
        {
          op: 'update',
          id: task.id,
          patch: { status: target, sortKey, ifUpdatedAt: task.updatedAt },
        },
      ])
    } catch (err) {
      setOverrides((m) => {
        const n = new Map(m)
        n.delete(task.id)
        return n
      })
      shake(task.id)
      toast.error(
        err instanceof ApiError && err.status === 409 ? t('task.conflict') : t('task.moveFailed'),
      )
      await qc.invalidateQueries({ queryKey: ['tasks'] })
      return
    }
    // 服务端已生效：等列表重取后撤掉本地覆盖
    await qc.invalidateQueries({ queryKey: ['tasks'] })
    setOverrides((m) => {
      const n = new Map(m)
      n.delete(task.id)
      return n
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        if (active) shake(active.id)
        setActive(null)
        setOverStatus(null)
      }}
    >
      {cols.every((c) => c.isSuccess) && all.length === 0 ? (
        <div className="mb-4 text-center" data-testid="board-empty">
          <p className="font-semibold text-lg">{t('ui.empty.board')}</p>
          <p className="mt-1 text-fg-muted text-sm">{t('ui.empty.boardHint')}</p>
        </div>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-4" data-testid="board">
        {TASK_STATUSES.map((s, i) => {
          const q = cols[i]
          return (
            <Column
              key={s}
              status={s}
              tasks={byStatus.get(s) ?? []}
              loading={!!q?.isPending}
              error={!!q?.isError}
              retry={() => void q?.refetch()}
              over={overStatus === s}
              collapsed={collapsed.has(s)}
              toggle={() =>
                setCollapsed((c) => {
                  const n = new Set(c)
                  n.has(s) ? n.delete(s) : n.add(s)
                  return n
                })
              }
              shakeId={shakeId}
              onOpen={onOpen}
              onCreate={(status, title) =>
                actions
                  .create({ title, spaceId: params.spaceId, status })
                  .catch(() => toast.error(t('task.saveFailed')))
              }
            />
          )
        })}
      </div>
      <DragOverlay dropAnimation={dropAnimation()}>
        {active ? <Card task={active} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}

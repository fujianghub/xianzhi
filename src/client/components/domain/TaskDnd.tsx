/**
 * 任务页拖拽（ADR-0044 §C、REQ-TASK-036）：把任务行拖到
 * - 左栏清单 → 归进该清单（只改本人的归类）；「未归类」→ 移出清单；
 * - 左栏「今天 / 明天」或列表的「今天 / 明天」组 → 截止改到那天（原有时刻保留，没有则 23:59）；「无日期」组 → 清空截止；
 * - 按优先级分组时的某组 → 改优先级。
 * 只用鼠标（MouseSensor，移动 6px 才算拖），触屏手势与键盘操作不受影响；不支持拖拽时，详情栏的「清单」/ 截止 / 优先级字段即可做同样的事。
 */
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ALL_DAY_MINUTES } from '../../../shared/quick-add.ts'
import { addDays, localDateOf, localDateTimeOf, zonedMidnight } from '../../../shared/tz.ts'
import { useMe } from '../../hooks/useMe.ts'
import { type TaskPatch, useTaskActions } from '../../hooks/useTasks.ts'
import { cn } from '../../lib/cn.ts'
import type { Task } from '../../lib/task-queries.ts'

const DraggingCtx = createContext<Task | null>(null)
/** 正在拖的任务（拖动中让空的落点分组也显示出来） */
export const useDraggingTask = () => useContext(DraggingCtx)

/** 落点 */
export type TaskDropTarget =
  | { kind: 'list'; id: string; name: string }
  | { kind: 'unlisted' }
  | { kind: 'day'; offset: 0 | 1 }
  | { kind: 'noDate' }
  | { kind: 'priority'; p: number }

const dropId = (t: TaskDropTarget) =>
  t.kind === 'list'
    ? `drop:list:${t.id}`
    : t.kind === 'day'
      ? `drop:day:${t.offset}`
      : t.kind === 'priority'
        ? `drop:prio:${t.p}`
        : `drop:${t.kind}`

/** 某元素成为落点；`isOver` 用于高亮 */
export function useTaskDrop(target: TaskDropTarget | null, scope = '') {
  const d = useDroppable({
    id: `${dropId(target ?? { kind: 'noDate' })}${scope}`,
    data: { target },
    disabled: !target,
  })
  return { setNodeRef: d.setNodeRef, isOver: d.isOver && !!target }
}

/** 落点高亮外壳（清单栏行 / 分组） */
export function DropZone({
  target,
  scope,
  className,
  children,
  testId,
}: {
  target: TaskDropTarget | null
  scope?: string
  className?: string
  children: ReactNode
  testId?: string
}) {
  const { setNodeRef, isOver } = useTaskDrop(target, scope)
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'xz-drop-over')}
      data-drop-over={isOver ? '' : undefined}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

/** 截止改到「今天起第 n 天」，保留原有时刻（无则全天 23:59） */
function dueOnDay(task: Task, offset: number, tz: string): string {
  const today = localDateOf(tz, new Date())
  const minutes = task.dueAt ? localDateTimeOf(tz, new Date(task.dueAt)).minutes : ALL_DAY_MINUTES
  return new Date(
    zonedMidnight(tz, addDays(today, offset)).getTime() + (minutes || ALL_DAY_MINUTES) * 60_000,
  ).toISOString()
}

export function TaskDndProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const actions = useTaskActions()
  const [dragging, setDragging] = useState<Task | null>(null)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }))
  const tz = me?.timezone ?? 'Asia/Shanghai'

  const onStart = (e: DragStartEvent) => setDragging((e.active.data.current?.task as Task) ?? null)
  const onEnd = (e: DragEndEvent) => {
    setDragging(null)
    const task = e.active.data.current?.task as Task | undefined
    const target = e.over?.data.current?.target as TaskDropTarget | null | undefined
    if (!task || !target) return
    let change: TaskPatch | null = null
    let msg = ''
    switch (target.kind) {
      case 'list':
        if (task.list?.id === target.id) return
        change = { listId: target.id }
        msg = t('taskDnd.toList', { name: target.name })
        break
      case 'unlisted':
        if (!task.list) return
        change = { listId: null }
        msg = t('taskDnd.unlisted')
        break
      case 'day': {
        const dueAt = dueOnDay(task, target.offset, tz)
        if (dueAt === task.dueAt) return
        change = { dueAt }
        msg = t(target.offset ? 'taskDnd.tomorrow' : 'taskDnd.today')
        break
      }
      case 'noDate':
        if (!task.dueAt) return
        change = { dueAt: null }
        msg = t('taskDnd.noDate')
        break
      case 'priority':
        if (task.priority === target.p) return
        change = { priority: target.p }
        msg = t('taskDnd.priority', { p: t(`task.priority.${target.p}`) })
        break
    }
    if (!change) return
    void actions
      .patch(task, change)
      .then(() => toast.success(`「${task.title}」${msg}`))
      .catch(() => undefined)
  }
  return (
    <DndContext
      sensors={sensors}
      // 按指针所在落点判定：被拖的是整行宽的任务行，按矩形相交会被列表里的大分组抢走
      collisionDetection={pointerWithin}
      onDragStart={onStart}
      onDragEnd={onEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        screenReaderInstructions: { draggable: t('taskDnd.instructions') },
      }}
    >
      <DraggingCtx.Provider value={dragging}>{children}</DraggingCtx.Provider>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="xz-drag-chip" data-testid="task-drag-overlay">
            {dragging.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

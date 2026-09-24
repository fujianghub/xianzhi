/**
 * 任务行（06 §5 · §5.3、REQ-TASK-020 · 021 · REQ-UI-011）：高度取 --xz-row-h（密度）；
 * 键盘焦点 / 选中：左侧 3px 主色条 + selected-bg；完成：文字转 fg-muted + 删除线，400ms 后由列表折叠移出。
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useHoverIntent } from '../../hooks/useHoverIntent.ts'
import { markSharedSource } from '../../hooks/useSharedElement.ts'
import { useSwipeRow } from '../../hooks/useSwipeRow.ts'
import { cn } from '../../lib/cn.ts'
import type { Task } from '../../lib/task-queries.ts'
import { dueLabel } from '../../lib/time.ts'
import { Avatar } from '../ui/avatar.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { useUserTimeZone } from '../ui/relative-time.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'

/** grid 模式下的单元格（04 §5：列表内可交互元素须在 gridcell 里，axe nested-interactive）。 */
function Cell({
  asRow,
  className,
  children,
}: {
  asRow: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role={asRow ? 'gridcell' : undefined}
      className={className ?? 'flex shrink-0 items-center'}
    >
      {children}
    </div>
  )
}

export const TaskRow = memo(function TaskRow({
  task,
  focused,
  selected,
  completing,
  onToggle,
  onOpen,
  onFocus,
  onPeek,
  onReschedule,
  onLongPress,
  showSpace,
  asRow = true,
}: {
  task: Task
  focused?: boolean
  selected?: boolean
  /** 刚完成、等待折叠的阶段（06 §5.3） */
  completing?: boolean
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  onFocus?: (task: Task) => void
  /** 悬停 600ms 打开 Peek（04 §6、REQ-UI-007） */
  onPeek?: (task: Task) => void
  /** 触摸右滑改期 / 长按多选（REQ-MOBILE-002；左滑完成复用 onToggle） */
  onReschedule?: (task: Task) => void
  onLongPress?: (task: Task) => void
  showSpace?: boolean
  /** 在 TaskList（role=grid）里渲染为 row / gridcell；单独使用（收件箱、子任务）时不带网格角色 */
  asRow?: boolean
}) {
  const { t } = useTranslation()
  const { tz, locale } = useUserTimeZone()
  const hover = useHoverIntent(() => onPeek?.(task))
  const swipe = useSwipeRow({
    onLeft: () => {
      if (task.status !== 'done') onToggle(task)
    },
    onRight: onReschedule ? () => onReschedule(task) : undefined,
    onLong: onLongPress ? () => onLongPress(task) : undefined,
  })
  const done = task.status === 'done' || completing
  const overdue = !!task.dueAt && !done && new Date(task.dueAt).getTime() < Date.now()
  // 网格行属性：只在 TaskList（role=grid）里带 row / aria-selected
  const rowProps = asRow
    ? { role: 'row' as const, tabIndex: -1, 'aria-selected': !!(selected || focused) }
    : {}
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 网格行（asRow）的鼠标按下只同步键盘焦点位置；键盘操作由外层 grid 处理
    <div
      {...rowProps}
      id={`task-row-${task.id}`}
      data-testid="task-row"
      data-task-id={task.id}
      data-focused={focused ? 'true' : undefined}
      onMouseDown={() => onFocus?.(task)}
      {...(onPeek ? hover : {})}
      {...swipe.handlers}
      data-swipe={swipe.dx < 0 ? 'left' : swipe.dx > 0 ? 'right' : undefined}
      style={
        swipe.dx
          ? { transform: `translateX(${swipe.dx}px)`, touchAction: 'pan-y' }
          : { touchAction: 'pan-y' }
      }
      className={cn(
        'group relative flex h-(--xz-row-h) items-center gap-3 px-3 text-sm transition-colors duration-(--xz-dur-fast)',
        'hover:bg-hover',
        swipe.dx < 0 && 'bg-success-soft',
        swipe.dx > 0 && 'bg-primary-soft',
        (focused || selected) && 'bg-selected',
        focused &&
          'before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary',
      )}
    >
      <Cell asRow={asRow}>
        <Checkbox
          checked={done}
          onCheckedChange={() => onToggle(task)}
          aria-label={task.title}
          onClick={(e) => e.stopPropagation()}
          data-testid="task-check"
        />
      </Cell>
      <Cell asRow={asRow} className="flex min-w-0 flex-1 items-center gap-3">
        <PriorityIcon priority={task.priority} />
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 truncate text-left transition-colors duration-(--xz-dur-base)',
            done && 'text-fg-muted line-through',
          )}
          onClick={(e) => {
            markSharedSource(e.currentTarget)
            onOpen(task)
          }}
          tabIndex={-1}
        >
          {task.title}
        </button>
        {selected ? <span className="sr-only">{t('task.selected', { count: 1 })}</span> : null}
      </Cell>
      <Cell asRow={asRow} className="flex shrink-0 items-center gap-3">
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className={cn(
                'rounded-full px-2 py-0.5 text-xs',
                PALETTE_CLASS[tag.color as PaletteName] ?? 'bg-surface-2',
              )}
            >
              {tag.name}
            </span>
          ))}
          {showSpace ? <span className="text-fg-muted text-xs">{task.spaceSlug}</span> : null}
        </div>
        {task.dueAt ? (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              overdue ? 'text-danger' : 'text-fg-muted',
            )}
            data-testid="task-due"
          >
            {dueLabel(new Date(task.dueAt), new Date(), locale, tz)}
          </span>
        ) : null}
        {task.assignee ? (
          <Avatar id={task.assignee.id} name={task.assignee.displayName} size={22} />
        ) : null}
      </Cell>
    </div>
  )
})

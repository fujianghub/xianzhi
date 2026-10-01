/**
 * 任务行（06 §5 · §5.3、REQ-TASK-020 · 021 · REQ-UI-011；ADR-0045 行内编辑 · 单个管理 · 页面级选择）：
 * - 高度取 --xz-row-h；键盘焦点 / 选中：左侧 3px 主色条 + selected-bg；完成：删除线，400ms 后由列表折叠移出。
 * - 单击标题 = 行内改名（回车 / 失焦保存，Esc 取消，输入法组词中的回车不提交）；行尾「›」/ 回车键 = 打开详情。
 * - 日期 / 优先级 / 清单 / 标签胶囊点开即改（选择器点开才挂载；日期与标签在弹层关闭时一次提交，避免连续 PATCH 撞乐观锁）。
 * - 行尾 ⋯ 与右键 = 单个管理菜单（TaskRowMenu）；触屏不弹右键菜单（长按是多选）。
 * - 页面级选择（TaskSelectionScope 内）：⌘ / Ctrl+点击切换、Shift+点击连选、选择模式下点行切换、长按切换。
 * - `inline=false`（详情里的子任务）：保持旧行为，点标题打开、无菜单与就地编辑（Esc 会关掉详情，审查 P0-8）。
 * 弹层渲染在 body，但 React 事件仍沿组件树冒泡：行的鼠标 / 右键处理先判断事件是否来自行本身。
 */
import { AlignLeft, ChevronRight, Flag, MoreHorizontal, Plus } from 'lucide-react'
import { type MouseEvent, memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { quickDueIso } from '../../../shared/quick-add.ts'
import { localDateTimeOf } from '../../../shared/tz.ts'
import { useHoverIntent } from '../../hooks/useHoverIntent.ts'
import { markSharedSource } from '../../hooks/useSharedElement.ts'
import { useSwipeRow } from '../../hooks/useSwipeRow.ts'
import type { TaskPatch } from '../../hooks/useTasks.ts'
import { cn } from '../../lib/cn.ts'
import { dueTone } from '../../lib/task-groups.ts'
import type { Task } from '../../lib/task-queries.ts'
import { isMultiKey, useSelectionEnabled, useTaskSelectionStore } from '../../lib/task-selection.ts'
import { dueLabel } from '../../lib/time.ts'
import { Avatar } from '../ui/avatar.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { useUserTimeZone } from '../ui/relative-time.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { SpaceTag } from './SpaceTag.tsx'
import { TagPicker } from './TagPicker.tsx'
import { ListDot } from './TaskListDot.tsx'
import { DuePicker, type DueValue, ListPicker, PriorityPicker } from './TaskPickers.tsx'
import { type RowPicker, TaskRowMenu } from './TaskRowMenu.tsx'

/** 行的界面状态：改名 / 菜单（可带右键位置）/ 某个选择器 */
export type RowUi =
  | { kind: 'edit' }
  | { kind: 'menu'; point?: { x: number; y: number } }
  | { kind: 'prio' }
  | { kind: RowPicker }

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

const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches

/** 事件是否来自行本身的 DOM（弹层在 body 里，但 React 事件会沿组件树冒泡上来） */
const fromRow = (e: { currentTarget: HTMLElement; target: EventTarget }) =>
  e.currentTarget.contains(e.target as Node)

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
  showList = true,
  asRow = true,
  inline = true,
  ui: uiProp,
  onUi,
  onEditEnd,
  canWrite: canWriteProp = false,
  onPatch,
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
  /** 行尾显示本人清单（ADR-0044；当前就在该清单视图里时不必显示） */
  showList?: boolean
  /** 在 TaskList（role=grid）里渲染为 row / gridcell；单独使用（收件箱、子任务）时不带网格角色 */
  asRow?: boolean
  /** 行内编辑 / 菜单（ADR-0045）；详情里的子任务关掉 */
  inline?: boolean
  /** 受控的行界面状态（TaskList 持有，键盘 r / m 可驱动）；不给则行内自管 */
  ui?: RowUi | null
  onUi?: (task: Task, ui: RowUi | null) => void
  /** 改名结束（保存或取消）：列表把焦点收回网格，j / k 继续可用 */
  onEditEnd?: () => void
  /** 能否写（由列表 / 页面按空间角色统一算好传入，行内不各自订阅空间列表——REQ-UI-017 万行滚动） */
  canWrite?: boolean
  /** 保存改动（列表传入稳定回调；行内不各自建 useTaskActions） */
  onPatch?: (task: Task, change: TaskPatch) => void
}) {
  const { t } = useTranslation()
  const { tz, locale } = useUserTimeZone()
  const canWrite = inline && canWriteProp
  const patch = (change: TaskPatch) => onPatch?.(task, change)
  const [localUi, setLocalUi] = useState<RowUi | null>(null)
  const ui = onUi ? (uiProp ?? null) : localUi
  const setUi = (next: RowUi | null) => (onUi ? onUi(task, next) : setLocalUi(next))
  // 页面级选择
  const selectable = useSelectionEnabled()
  // 一个订阅同时取「本行是否选中」与「选择模式」（逐行订阅，选择变化只重渲染相关行）
  const selBits = useTaskSelectionStore(
    (s) => (s.selected.has(task.id) ? 2 : 0) + (s.selectMode ? 1 : 0),
  )
  const isSelected = (selBits & 2) !== 0
  const selectMode = (selBits & 1) !== 0
  // 悬停 / 聚焦 / 有弹层时才渲染行尾操作与占位（万行列表少挂 DOM）；触屏常显
  const [hovered, setHovered] = useState(false)
  const showActs = hovered || !!focused || !!ui || isTouch
  const store = useTaskSelectionStore.getState
  const lastPointer = useRef<string>('mouse')
  const suppressClickUntil = useRef(0)
  const hover = useHoverIntent(() => {
    if (!ui) onPeek?.(task)
  })
  const swipe = useSwipeRow({
    onLeft: () => {
      if (task.status !== 'done') onToggle(task)
    },
    onRight: onReschedule ? () => onReschedule(task) : undefined,
    onLong: () => {
      // 长按：切换多选；随后松手那一下的 click 不再触发改名 / 打开（审查 P0-3）
      suppressClickUntil.current = Date.now() + 700
      if (selectable) store().toggle(task)
      else onLongPress?.(task)
    },
  })
  const done = task.status === 'done' || completing
  const overdue = !!task.dueAt && !done && new Date(task.dueAt).getTime() < Date.now()
  const sel = selectable ? isSelected : !!selected
  const titleRef = useRef<HTMLElement | null>(null)
  // 网格行属性：只在 TaskList（role=grid）里带 row / aria-selected
  const rowProps = asRow
    ? { role: 'row' as const, tabIndex: -1, 'aria-selected': !!(sel || focused) }
    : {}

  // ---- 行内改名：草稿在 ref 里，行被虚拟滚动卸载时也保存（审查 P1-11）
  const draft = useRef<string | null>(null)
  const editing = ui?.kind === 'edit'
  const commitTitle = (keep: boolean) => {
    const v = draft.current?.trim()
    draft.current = null
    if (keep && v && v !== task.title) patch({ title: v })
  }
  const commitRef = useRef(commitTitle)
  commitRef.current = commitTitle
  useEffect(() => () => commitRef.current(true), [])
  const endEdit = (keep: boolean) => {
    commitTitle(keep)
    setUi(null)
    onEditEnd?.()
  }

  // ---- 日期 / 标签：弹层关闭时一次提交
  const pendingDue = useRef<{ v: DueValue | null } | null>(null)
  const pendingTags = useRef<string[] | null>(null)
  const closePicker = () => {
    if (pendingDue.current) {
      const v = pendingDue.current.v
      pendingDue.current = null
      const dueAt = v ? quickDueIso(v, tz) : null
      if (dueAt !== task.dueAt) patch({ dueAt })
    }
    if (pendingTags.current) {
      const ids = pendingTags.current
      pendingTags.current = null
      const cur = task.tags.map((x) => x.id)
      if (ids.length !== cur.length || ids.some((x) => !cur.includes(x))) patch({ tagIds: ids })
    }
    setUi(null)
  }
  const dueValue: DueValue | null = task.dueAt
    ? (() => {
        const l = localDateTimeOf(tz, new Date(task.dueAt))
        return { date: l.date, minutes: l.minutes === 23 * 60 + 59 ? null : l.minutes }
      })()
    : null

  // ---- 选择手势（捕获阶段，先于标题 / 胶囊的点击）
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!fromRow(e)) return
    if (Date.now() < suppressClickUntil.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!selectable) return
    const target = e.target as HTMLElement
    if (target.closest('[data-select-box]')) return
    if (isMultiKey(e)) store().toggle(task)
    else if (e.shiftKey) store().rangeTo(task)
    else if (selectMode) store().toggle(task)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const open = () => {
    if (titleRef.current) markSharedSource(titleRef.current)
    onOpen(task)
  }
  const titleCls = cn(
    'min-w-0 flex-1 truncate text-left transition-colors duration-(--xz-dur-base)',
    done && 'text-fg-muted line-through',
  )

  const dueBtn = task.dueAt ? (
    <button
      type="button"
      className={cn('xz-due', overdue ? 'text-danger' : 'text-fg-muted', canWrite && 'xz-chip-btn')}
      data-tone={done ? 'done' : dueTone(task.dueAt, tz)}
      data-testid="task-due"
      disabled={!canWrite}
      onClick={() => setUi({ kind: 'due' })}
      aria-label={`${t('task.dueAt')}：${dueLabel(new Date(task.dueAt), new Date(), locale, tz)}`}
    >
      {dueLabel(new Date(task.dueAt), new Date(), locale, tz)}
    </button>
  ) : canWrite && showActs ? (
    <button
      type="button"
      className={cn('xz-row-ghost', ui?.kind === 'due' && 'xz-row-ghost-on')}
      onClick={() => setUi({ kind: 'due' })}
      aria-label={t('taskRow.addDue')}
      data-testid="task-due-add"
    >
      <Plus className="size-3" aria-hidden />
      {t('taskRow.due')}
    </button>
  ) : null

  const prioBtn =
    canWrite && (task.priority || showActs) ? (
      <button
        type="button"
        className={cn(
          'grid size-6 place-items-center rounded-md hover:bg-hover',
          !task.priority && 'xz-row-ghost-icon',
          ui?.kind === 'prio' && 'xz-row-ghost-on',
        )}
        onClick={() => setUi({ kind: 'prio' })}
        aria-label={`${t('task.priorityLabel')}：${t(`task.priority.${task.priority}`)}`}
        data-testid="task-prio"
      >
        {task.priority ? (
          <PriorityIcon priority={task.priority} className="xz-task-prio" />
        ) : (
          <Flag className="size-3.5 text-fg-faint" aria-hidden />
        )}
      </button>
    ) : (
      <PriorityIcon priority={task.priority} className="xz-task-prio" />
    )

  const listBtn =
    showList && task.list ? (
      <button
        type="button"
        className="xz-task-list xz-chip-btn rounded-full px-1"
        data-testid="task-list-tag"
        disabled={!inline}
        onClick={() => setUi({ kind: 'list' })}
      >
        <ListDot list={task.list} />
        {task.list.name}
      </button>
    ) : null

  const tagsBtn = task.tags.length ? (
    <button
      type="button"
      className="flex items-center gap-1 rounded-full xz-chip-btn"
      disabled={!canWrite}
      onClick={() => setUi({ kind: 'tags' })}
      aria-label={`${t('task.tags')}：${task.tags.map((x) => x.name).join('、')}`}
      data-testid="task-tags"
    >
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
    </button>
  ) : canWrite && ui?.kind === 'tags' ? (
    <button type="button" className="xz-row-ghost xz-row-ghost-on">
      {t('task.tags')}
    </button>
  ) : null

  const menuBtn = (
    <button
      type="button"
      className={cn('xz-row-act', ui?.kind === 'menu' && 'xz-row-act-on')}
      aria-label={t('taskRow.menu', { title: task.title })}
      onClick={() => setUi({ kind: 'menu' })}
      data-testid="task-menu-btn"
    >
      <MoreHorizontal className="size-4" />
    </button>
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 网格行（asRow）的鼠标按下只同步键盘焦点位置；键盘操作由外层 grid 处理
    <div
      {...rowProps}
      id={`task-row-${task.id}`}
      data-testid="task-row"
      data-task-id={task.id}
      data-focused={focused ? 'true' : undefined}
      data-selected={sel ? '' : undefined}
      onMouseDown={(e) => {
        if (!fromRow(e)) return
        hover.onMouseLeave() // 按下即取消悬停预览（审查 P1-10）
        if (e.shiftKey && selectable) e.preventDefault() // 不扩展原生文字选区
        onFocus?.(task)
      }}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType
        swipe.handlers.onPointerDown(e)
      }}
      onPointerMove={swipe.handlers.onPointerMove}
      onPointerUp={swipe.handlers.onPointerUp}
      onPointerCancel={swipe.handlers.onPointerCancel}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => {
        if (!inline || !fromRow(e)) return
        // 触屏长按也会触发 contextmenu：交给长按多选，不弹菜单
        if (lastPointer.current === 'touch') return
        e.preventDefault()
        setUi({ kind: 'menu', point: { x: e.clientX, y: e.clientY } })
      }}
      onMouseEnter={() => {
        setHovered(true)
        if (onPeek) hover.onMouseEnter()
      }}
      onMouseLeave={() => {
        setHovered(false)
        hover.onMouseLeave()
      }}
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
        (focused || sel) && 'bg-selected',
        (focused || sel) &&
          'before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary',
      )}
    >
      <Cell asRow={asRow} className="flex shrink-0 items-center gap-2">
        {selectable && selectMode ? (
          <span data-select-box className="inline-flex">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => store().toggle(task)}
              aria-label={t('taskRow.select', { title: task.title })}
              data-testid="task-select"
            />
          </span>
        ) : null}
        {/* 圆形勾选圈，边框按优先级着色（ADR-0044；颜色另有行尾旗标，不单靠颜色） */}
        <Checkbox
          checked={done}
          onCheckedChange={() => onToggle(task)}
          aria-label={task.title}
          onClick={(e) => e.stopPropagation()}
          className="xz-task-check"
          data-check-priority={task.priority}
          data-testid="task-check"
        />
      </Cell>
      <Cell asRow={asRow} className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <input
            ref={(el) => {
              titleRef.current = el
            }}
            // biome-ignore lint/a11y/noAutofocus: 点标题即进入改名
            autoFocus
            defaultValue={task.title}
            maxLength={200}
            aria-label={t('taskRow.rename')}
            className="xz-row-input min-w-0 flex-1"
            data-testid="task-title-input"
            onFocus={(e) => {
              draft.current = e.currentTarget.value
              e.currentTarget.select()
            }}
            onChange={(e) => {
              draft.current = e.target.value
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // 不让列表的 j / k / 空格 / 回车快捷键接到输入框里的按键
              e.stopPropagation()
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                endEdit(true)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                endEdit(false)
              }
            }}
            onBlur={() => {
              if (draft.current !== null) endEdit(true)
            }}
          />
        ) : (
          <button
            ref={(el) => {
              titleRef.current = el
            }}
            type="button"
            className={titleCls}
            onClick={() => {
              if (canWrite) setUi({ kind: 'edit' })
              else open()
            }}
            tabIndex={-1}
            data-testid="task-row-title"
          >
            {task.title}
          </button>
        )}
        {task.hasDescription ? (
          <AlignLeft
            className="size-3.5 shrink-0 text-fg-faint"
            aria-label={t('task.hasDescription')}
          />
        ) : null}
        {sel ? <span className="sr-only">{t('task.selected', { count: 1 })}</span> : null}
      </Cell>
      <Cell asRow={asRow} className="flex shrink-0 items-center gap-2">
        {ui?.kind === 'prio' ? (
          <PriorityPicker
            open
            value={task.priority}
            onChange={(p) => {
              if (p !== task.priority) patch({ priority: p })
            }}
            onOpenChange={(o) => !o && setUi(null)}
            trigger={prioBtn}
          />
        ) : (
          prioBtn
        )}
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {ui?.kind === 'list' ? (
            <ListPicker
              open
              value={task.list?.id ?? null}
              onChange={(listId) => {
                if (listId !== (task.list?.id ?? null)) patch({ listId })
              }}
              onOpenChange={(o) => !o && setUi(null)}
              trigger={
                listBtn ?? (
                  <button type="button" className="xz-row-ghost xz-row-ghost-on">
                    {t('taskLists.list')}
                  </button>
                )
              }
            />
          ) : (
            listBtn
          )}
          {ui?.kind === 'tags' && tagsBtn ? (
            <TagPicker
              open
              value={task.tags}
              onChange={(ids) => {
                pendingTags.current = ids
              }}
              onOpenChange={(o) => !o && closePicker()}
              trigger={tagsBtn}
            />
          ) : (
            tagsBtn
          )}
          {showSpace ? <SpaceTag slug={task.spaceSlug} /> : null}
        </div>
        {ui?.kind === 'due' && dueBtn ? (
          <DuePicker
            open
            value={dueValue}
            onChange={(v) => {
              pendingDue.current = { v }
            }}
            onOpenChange={(o) => !o && closePicker()}
            trigger={dueBtn}
          />
        ) : (
          dueBtn
        )}
        {task.assignee ? (
          <Avatar id={task.assignee.id} name={task.assignee.displayName} size={22} />
        ) : null}
        {inline && showActs ? (
          <>
            {ui?.kind === 'menu' ? (
              <TaskRowMenu
                task={task}
                open
                onOpenChange={(o) => !o && setUi(null)}
                point={ui.point ?? null}
                trigger={menuBtn}
                canWrite={canWrite}
                onToggle={onToggle}
                onOpen={open}
                onPick={(p) => setTimeout(() => setUi({ kind: p }), 0)}
              />
            ) : null}
            {ui?.kind === 'menu' && !ui.point ? null : menuBtn}
            <button
              type="button"
              className="xz-row-act"
              aria-label={t('taskRow.open', { title: task.title })}
              onClick={open}
              data-testid="task-open"
            >
              <ChevronRight className="size-4" />
            </button>
          </>
        ) : null}
      </Cell>
    </div>
  )
})

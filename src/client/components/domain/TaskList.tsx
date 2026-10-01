/**
 * 任务列表（08 §2.6 list、04 §6、06 §5.3；REQ-TASK-020 · 021 · REQ-UI-017）：
 * - 窗口虚拟化（1 万行滚动不掉帧）；行高随密度。
 * - 键盘：j / k（↓ / ↑）移动、x 多选、Space 完成 / 取消、Enter / e 打开、p Peek、Esc 清空选择；`c` 留给全局新任务。
 * - 完成：变灰 + 删除线 → 400ms 后行高折叠移出 → 8s 行内撤销（撤销 = POST /uncomplete 回到 prevStatus）。
 *   淡出 / 折叠期间行由 `leaving` 保住原位：列表查询按状态过滤（不含 done），完成后几十毫秒内的重取就会把它从数据里拿掉，
 *   不保住的话动画被跳过、行直接消失（debug/2026-09-27-task-complete-fade-skipped）。
 * - 多选：底部批量条（改状态 / 删除），一条 POST /tasks/batch。
 * - `draggable`（任务页，ADR-0044）：行可用鼠标拖到清单栏 / 其它分组；页面提供 DndContext。
 *   只挂监听到虚拟行外壳（不加 role / tabIndex，网格语义不变）；触屏不拖，留给左滑完成 / 右滑改期。
 */
import { useDraggable } from '@dnd-kit/core'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { Undo2 } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type TaskPatch, useTaskActions } from '../../hooks/useTasks.ts'
import { cn } from '../../lib/cn.ts'
import { useCommandContext, useLayout, usePeek } from '../../lib/stores.ts'
import type { Task } from '../../lib/task-queries.ts'
import {
  registerSelectable,
  unregisterSelectable,
  useSelectionEnabled,
  useTaskSelectionStore,
} from '../../lib/task-selection.ts'
import { Button } from '../ui/button.tsx'
import { type RowUi, TaskRow } from './TaskRow.tsx'
import { useTaskWritable } from './TaskRowMenu.tsx'

/** 虚拟行外壳；可拖时挂 dnd-kit 的监听（不加 attributes：不改网格语义） */
function RowSlot({
  task,
  draggable,
  index,
  offset,
  className,
  children,
}: {
  task: Task
  draggable: boolean
  index: number
  offset: number
  className: string
  children: ReactNode
}) {
  const drag = useDraggable({ id: `task:${task.id}`, data: { task }, disabled: !draggable })
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 拖拽激活（鼠标按下）挂在虚拟行外壳上；键盘与读屏走网格与行内控件
    <div
      ref={draggable ? drag.setNodeRef : undefined}
      // 只从行本身开始拖：弹层（portal，事件沿组件树冒泡上来）、行内输入框里的按下不算（审查 P0-1）
      onMouseDown={
        draggable
          ? (e) => {
              const t = e.target as HTMLElement
              if (!e.currentTarget.contains(t) || t.closest('input,textarea,[data-no-drag]')) return
              drag.listeners?.onMouseDown?.(e)
            }
          : undefined
      }
      data-index={index}
      data-dragging={drag.isDragging ? '' : undefined}
      className={cn(className, drag.isDragging && 'opacity-40')}
      style={{ transform: `translateY(${offset}px)` }}
    >
      {children}
    </div>
  )
}

const FADE_MS = 400
const UNDO_MS = 8000

interface Pending {
  task: Task
  until: number
}

export function TaskList({
  tasks,
  onOpen,
  onPeek,
  hasMore,
  onLoadMore,
  empty,
  showSpace,
  showList,
  draggable,
  groupKey,
  groupRank = 0,
  label,
  testId = 'task-list',
}: {
  tasks: Task[]
  onOpen: (t: Task) => void
  onPeek?: (t: Task) => void
  hasMore?: boolean
  onLoadMore?: () => void
  empty?: ReactNode
  showSpace?: boolean
  /** 行尾显示本人清单（ADR-0044）；默认显示 */
  showList?: boolean
  /** 行可拖（须在 DndContext 内，ADR-0044） */
  draggable?: boolean
  /** 页面级选择的登记键与组序（Shift 跨组连选按组序，ADR-0045）；缺省用 testId */
  groupKey?: string
  groupRank?: number
  label: string
  testId?: string
}) {
  const { t } = useTranslation()
  const actions = useTaskActions()
  const [focusId, setFocusId] = useState<string | null>(null)
  // ⌘K 上下文：焦点行即当前任务（REQ-UI-005）；失焦不清（打开 ⌘K 会让列表失焦）
  const setCmdFocus = useCommandContext((s) => s.setFocus)
  useEffect(() => {
    setCmdFocus(focusId ? { kind: 'task', id: focusId } : null)
  }, [focusId, setCmdFocus])
  useEffect(() => () => setCmdFocus(null), [setCmdFocus])
  const openPeek = usePeek((s) => s.open)
  const peek = onPeek ?? ((x: Task) => openPeek({ kind: 'task', id: x.id, spaceSlug: x.spaceSlug }))
  // 页面级选择（ADR-0045）：在 TaskSelectionScope 里才启用；本列表按组序登记可见任务供 Shift 连选
  const selectable = useSelectionEnabled()
  const regKey = groupKey ?? testId
  const sel = useTaskSelectionStore.getState
  // 行的界面状态（改名 / 菜单 / 选择器）：同一时刻只一行
  const [rowUi, setRowUi] = useState<{ id: string; ui: RowUi } | null>(null)
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [collapsing, setCollapsing] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  /** 正在淡出 / 折叠的任务：勾选时的快照与所在位置；数据里已没有它时仍按原位显示，折叠完成后移除 */
  const [leaving, setLeaving] = useState<Map<string, { task: Task; index: number }>>(new Map())
  const [undo, setUndo] = useState<Pending[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  const visible = useMemo(() => {
    const list = tasks.filter((x) => !hidden.has(x.id))
    if (!leaving.size) return list
    const ids = new Set(list.map((x) => x.id))
    // 按原位置从小到大插回，前面的插入不会打乱后面的位置
    for (const { task, index } of [...leaving.values()].sort((a, b) => a.index - b.index))
      if (!ids.has(task.id) && !hidden.has(task.id))
        list.splice(Math.min(index, list.length), 0, task)
    return list
  }, [tasks, hidden, leaving])
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const dropLeaving = useCallback(
    (id: string) =>
      setLeaving((m) => {
        if (!m.has(id)) return m
        const n = new Map(m)
        n.delete(id)
        return n
      }),
    [],
  )
  // 服务端列表里已不存在的任务（撤销后又出现等）从 hidden 里去掉，避免永久隐藏
  useEffect(() => {
    setHidden((h) => {
      const ids = new Set(tasks.map((x) => x.id))
      const next = new Set(
        [...h].filter((id) => ids.has(id) && tasks.find((x) => x.id === id)?.status === 'done'),
      )
      return next.size === h.size ? h : next
    })
  }, [tasks])

  useEffect(() => {
    const measure = () =>
      setOffset(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 行高只在密度变化时读一次；estimateSize / getItemKey 必须是稳定引用——引用一变虚拟器会重算全部行的尺寸，
  // 1 万行时每次滚动都要 1 万次 getComputedStyle（REQ-UI-017，debug/2026-09-24-virtualizer-unstable-options）
  const density = useLayout((s) => s.density)
  // biome-ignore lint/correctness/useExhaustiveDependencies: density 切换后 --xz-row-h 变化，需重读
  const rowHeight = useMemo(
    () =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--xz-row-h'),
      ) || 40,
    [density],
  )
  const estimateSize = useCallback(() => rowHeight, [rowHeight])
  const getItemKey = useCallback((i: number) => visible[i]?.id ?? i, [visible])
  const virtualizer = useWindowVirtualizer({
    count: visible.length,
    estimateSize,
    overscan: 8,
    scrollMargin: offset,
    getItemKey,
  })

  // 撤销条到期
  useEffect(() => {
    if (!undo.length) return
    const next = Math.min(...undo.map((u) => u.until)) - Date.now()
    const id = setTimeout(
      () => setUndo((u) => u.filter((x) => x.until > Date.now())),
      Math.max(0, next),
    )
    return () => clearTimeout(id)
  }, [undo])

  const toggle = useCallback(
    async (task: Task) => {
      if (task.status === 'done') {
        await actions.uncomplete(task).catch(() => toast.error(t('task.saveFailed')))
        return
      }
      setCompleting((s) => new Set(s).add(task.id))
      const index = visibleRef.current.findIndex((x) => x.id === task.id)
      // 快照存为已完成态：请求返回后 completing 会清掉，行仍须保持变灰 + 删除线直到折叠
      const done: Task = { ...task, status: 'done', completedAt: new Date().toISOString() }
      setLeaving((m) => new Map(m).set(task.id, { task: done, index: Math.max(0, index) }))
      const req = actions.complete(task)
      setTimeout(() => {
        setCollapsing((s) => new Set(s).add(task.id))
        setTimeout(() => {
          setHidden((s) => new Set(s).add(task.id))
          dropLeaving(task.id)
          setCollapsing((s) => {
            const n = new Set(s)
            n.delete(task.id)
            return n
          })
        }, 200)
      }, FADE_MS)
      setUndo((u) => [
        ...u.filter((x) => x.task.id !== task.id),
        { task, until: Date.now() + UNDO_MS },
      ])
      try {
        await req
      } catch {
        // 失败：optimisticPatch 已回滚并提示，这里把行放回
        dropLeaving(task.id)
        setHidden((s) => {
          const n = new Set(s)
          n.delete(task.id)
          return n
        })
        setUndo((u) => u.filter((x) => x.task.id !== task.id))
      } finally {
        setCompleting((s) => {
          const n = new Set(s)
          n.delete(task.id)
          return n
        })
      }
    },
    [actions, t, dropLeaving],
  )

  const revert = async (p: Pending) => {
    setUndo((u) => u.filter((x) => x.task.id !== p.task.id))
    try {
      await actions.uncomplete(p.task)
      setHidden((s) => {
        const n = new Set(s)
        n.delete(p.task.id)
        return n
      })
      toast.success(t('task.undone'))
    } catch {
      toast.error(t('task.saveFailed'))
    }
  }

  // 传给行的回调保持稳定引用：TaskRow 为 memo，虚拟滚动时只渲染新进入视口的行（REQ-UI-017）
  const reschedule = (x: Task) => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(18, 0, 0, 0)
    void actions
      .patch(x, { dueAt: d.toISOString() })
      .then(() => toast.success(t('task.rescheduled')))
  }
  const latest = useRef({ toggle, onOpen, peek, reschedule, actions })
  latest.current = { toggle, onOpen, peek, reschedule, actions }
  // 写权限按空间统一算一次（行内不各自订阅空间列表，REQ-UI-017）；保存回调保持稳定引用
  const canWriteOf = useTaskWritable()
  const rowPatch = useCallback(
    (x: Task, change: TaskPatch) =>
      void latest.current.actions.patch(x, change).catch(() => undefined),
    [],
  )
  const rowToggle = useCallback((x: Task) => latest.current.toggle(x), [])
  const rowOpen = useCallback((x: Task) => latest.current.onOpen(x), [])
  const rowPeek = useCallback((x: Task) => latest.current.peek(x), [])
  const rowFocus = useCallback((x: Task) => setFocusId(x.id), [])
  // 触摸手势（REQ-MOBILE-002）：右滑改期到明天 18:00；长按切换多选
  const rowReschedule = useCallback((x: Task) => latest.current.reschedule(x), [])
  const rowUiChange = useCallback(
    (x: Task, ui: RowUi | null) => setRowUi(ui ? { id: x.id, ui } : null),
    [],
  )
  const refocus = useCallback(() => listRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    if (!selectable) return
    registerSelectable(regKey, groupRank, visible)
  }, [selectable, regKey, groupRank, visible])
  useEffect(() => {
    if (!selectable) return
    return () => unregisterSelectable(regKey)
  }, [selectable, regKey])

  const focusIndex = Math.max(
    0,
    visible.findIndex((x) => x.id === focusId),
  )
  const move = (d: number) => {
    if (!visible.length) return
    const i = focusId ? Math.min(visible.length - 1, Math.max(0, focusIndex + d)) : 0
    const id = visible[i]?.id ?? null
    setFocusId(id)
    virtualizer.scrollToIndex(i, { align: 'auto' })
    if (hasMore && i >= visible.length - 20) onLoadMore?.()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 只处理网格自身的按键：行内输入框、弹层（portal 但 React 事件沿树冒泡）里的按键一律放过（审查 P0-1）
    if (e.target !== e.currentTarget) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const cur = visible.find((x) => x.id === focusId) ?? null
    // Shift+J/K、Shift+↑↓：扩选（当前行与下一行都选上）
    if (e.shiftKey && selectable && ['J', 'K', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      const d = e.key === 'J' || e.key === 'ArrowDown' ? 1 : -1
      const i = focusId ? Math.min(visible.length - 1, Math.max(0, focusIndex + d)) : 0
      const next = visible[i]
      if (cur) sel().add([cur])
      if (next) sel().add([next])
      move(d)
      e.preventDefault()
      return
    }
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        move(1)
        break
      case 'k':
      case 'ArrowUp':
        move(-1)
        break
      case 'x':
        if (!cur || !selectable) return
        sel().toggle(cur)
        break
      case 'r':
      case 'F2':
        // 改名（ADR-0045）
        if (!cur) return
        setRowUi({ id: cur.id, ui: { kind: 'edit' } })
        break
      case 'm':
      case 'ContextMenu':
        if (!cur) return
        setRowUi({ id: cur.id, ui: { kind: 'menu' } })
        break
      case ' ':
        if (!cur) return
        void toggle(cur)
        break
      case 'Enter':
      case 'e':
        if (!cur) return
        onOpen(cur)
        break
      case 'p':
        if (!cur) return
        peek(cur)
        break
      case 'Escape':
        if (!selectable || !sel().selected.size) return
        sel().clear()
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  if (!visible.length && !undo.length && empty) return <>{empty}</>
  return (
    <div className="relative">
      {/* biome-ignore lint/a11y/useSemanticElements: 虚拟列表靠绝对定位，无法用 <table>；grid + aria-activedescendant 是 APG 的键盘列表模式 */}
      <div
        ref={listRef}
        role="grid"
        aria-rowcount={visible.length}
        aria-label={label}
        aria-multiselectable="true"
        aria-activedescendant={focusId ? `task-row-${focusId}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (!focusId && visible[0]) setFocusId(visible[0].id)
        }}
        className="paper relative overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-(--xz-focus-color)"
        style={{ height: virtualizer.getTotalSize() }}
        data-testid={testId}
        title={t('task.keyboardHint')}
      >
        {virtualizer.getVirtualItems().map((v) => {
          const task = visible[v.index]
          if (!task) return null
          return (
            <RowSlot
              key={v.key}
              task={task}
              draggable={!!draggable}
              index={v.index}
              className={cn(
                'absolute inset-x-0 top-0 overflow-hidden border-divider border-b transition-[height,opacity,transform] duration-(--xz-dur-base) ease-(--xz-ease-out) last:border-b-0',
                collapsing.has(task.id) ? 'h-0 opacity-0' : 'h-(--xz-row-h)',
              )}
              offset={v.start - virtualizer.options.scrollMargin}
            >
              <TaskRow
                task={task}
                focused={focusId === task.id}
                completing={completing.has(task.id)}
                onToggle={rowToggle}
                onOpen={rowOpen}
                onFocus={rowFocus}
                onPeek={rowPeek}
                onReschedule={rowReschedule}
                ui={rowUi?.id === task.id ? rowUi.ui : null}
                canWrite={canWriteOf(task)}
                onPatch={rowPatch}
                onUi={rowUiChange}
                onEditEnd={refocus}
                showSpace={showSpace}
                showList={showList}
              />
            </RowSlot>
          )
        })}
      </div>
      {hasMore ? (
        <div className="mt-2 text-center">
          <Button variant="ghost" size="sm" onClick={onLoadMore}>
            {t('task.loadMore')}
          </Button>
        </div>
      ) : null}
      {undo.length ? (
        <div className="mt-2 flex flex-col gap-1" aria-live="polite" data-testid="undo-bar">
          {undo.map((p) => (
            <div
              key={p.task.id}
              className="paper flex items-center gap-3 rounded-md px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {t('task.completed', { title: p.task.title })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revert(p)}
                data-testid="undo-complete"
              >
                <Undo2 />
                {t('task.undo')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

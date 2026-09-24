/**
 * 任务列表（08 §2.6 list、04 §6、06 §5.3；REQ-TASK-020 · 021 · REQ-UI-017）：
 * - 窗口虚拟化（1 万行滚动不掉帧）；行高随密度。
 * - 键盘：j / k（↓ / ↑）移动、x 多选、Space 完成 / 取消、Enter / e 打开、p Peek、Esc 清空选择；`c` 留给全局新任务。
 * - 完成：变灰 + 删除线 → 400ms 后行高折叠移出 → 8s 行内撤销（撤销 = POST /uncomplete 回到 prevStatus）。
 * - 多选：底部批量条（改状态 / 删除），一条 POST /tasks/batch。
 */
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { Undo2, X } from 'lucide-react'
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
import { useTaskActions } from '../../hooks/useTasks.ts'
import { cn } from '../../lib/cn.ts'
import { useCommandContext, useLayout, usePeek } from '../../lib/stores.ts'
import { TASK_STATUSES, type Task } from '../../lib/task-queries.ts'
import { Button } from '../ui/button.tsx'
import { TaskRow } from './TaskRow.tsx'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [collapsing, setCollapsing] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [undo, setUndo] = useState<Pending[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  const visible = useMemo(() => tasks.filter((x) => !hidden.has(x.id)), [tasks, hidden])
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
      const req = actions.complete(task)
      setTimeout(() => {
        setCollapsing((s) => new Set(s).add(task.id))
        setTimeout(() => {
          setHidden((s) => new Set(s).add(task.id))
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
    [actions, t],
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
  const latest = useRef({ toggle, onOpen, peek, reschedule })
  latest.current = { toggle, onOpen, peek, reschedule }
  const rowToggle = useCallback((x: Task) => latest.current.toggle(x), [])
  const rowOpen = useCallback((x: Task) => latest.current.onOpen(x), [])
  const rowPeek = useCallback((x: Task) => latest.current.peek(x), [])
  const rowFocus = useCallback((x: Task) => setFocusId(x.id), [])
  // 触摸手势（REQ-MOBILE-002）：右滑改期到明天 18:00；长按切换多选
  const rowReschedule = useCallback((x: Task) => latest.current.reschedule(x), [])
  const rowLongPress = useCallback(
    (x: Task) =>
      setSelected((cur) => {
        const n = new Set(cur)
        n.has(x.id) ? n.delete(x.id) : n.add(x.id)
        return n
      }),
    [],
  )

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
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const cur = visible.find((x) => x.id === focusId) ?? null
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
        if (!cur) return
        setSelected((s) => {
          const n = new Set(s)
          n.has(cur.id) ? n.delete(cur.id) : n.add(cur.id)
          return n
        })
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
        if (!selected.size) return
        setSelected(new Set())
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const selectedTasks = visible.filter((x) => selected.has(x.id))
  const batchStatus = async (status: Task['status']) => {
    const r = await actions
      .batch(
        selectedTasks.map((x) => ({
          op: 'update' as const,
          id: x.id,
          patch: { status, ifUpdatedAt: x.updatedAt },
        })),
      )
      .catch(() => null)
    if (r) toast.success(t('task.batchDone', { count: selectedTasks.length }))
    else toast.error(t('task.saveFailed'))
    setSelected(new Set())
  }
  const batchDelete = async () => {
    const r = await actions
      .batch(selectedTasks.map((x) => ({ op: 'delete' as const, id: x.id })))
      .catch(() => null)
    if (r) toast.success(t('task.batchDone', { count: selectedTasks.length }))
    else toast.error(t('task.saveFailed'))
    setSelected(new Set())
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
            <div
              key={v.key}
              data-index={v.index}
              className={cn(
                'absolute inset-x-0 top-0 overflow-hidden border-divider border-b transition-[height,opacity] duration-(--xz-dur-base) ease-(--xz-ease-out) last:border-b-0',
                collapsing.has(task.id) ? 'h-0 opacity-0' : 'h-(--xz-row-h)',
              )}
              style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
            >
              <TaskRow
                task={task}
                focused={focusId === task.id}
                selected={selected.has(task.id)}
                completing={completing.has(task.id)}
                onToggle={rowToggle}
                onOpen={rowOpen}
                onFocus={rowFocus}
                onPeek={rowPeek}
                onReschedule={rowReschedule}
                onLongPress={rowLongPress}
                showSpace={showSpace}
              />
            </div>
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
      {selected.size ? (
        <div
          className="glass-thick-flat fixed inset-x-0 bottom-[calc(var(--xz-bottomnav-h)+1rem)] z-(--xz-z-sticky) mx-auto flex w-fit items-center gap-2 rounded-full px-3 py-2 text-sm lg:bottom-6"
          data-testid="batch-bar"
        >
          <span className="px-1">{t('task.selected', { count: selected.size })}</span>
          <select
            aria-label={t('task.batchStatus')}
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void batchStatus(e.target.value as Task['status'])
            }}
            data-testid="batch-status"
          >
            <option value="" disabled>
              {t('task.batchStatus')}
            </option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`task.status.${s}`)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="destructive" onClick={batchDelete}>
            {t('task.batchDelete')}
          </Button>
          <Button
            size="sm"
            variant="icon"
            aria-label={t('task.clearSelection')}
            onClick={() => setSelected(new Set())}
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

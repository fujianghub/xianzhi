/**
 * 任务行的单个管理菜单（ADR-0045、REQ-TASK-039）：行尾 ⋯ 与右键共用。
 * 完成 / 取消完成 · 打开详情 · 日期（今天 / 明天 / 下周一 / 无日期 / 自选…）· 优先级 · 移到清单… · 移到空间 · 标签… · 状态 · 复制标题 · 删除（可撤销）。
 * 右键锚在指针处：用 Radix 虚拟锚点（行有 transform，position:fixed 的锚会错位，审查 P0-2）。
 * 只读者（不能写该任务）只有「打开详情 · 移到清单 · 复制标题」（清单是私人归类，ADR-0044）。
 */
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  Flag,
  FolderInput,
  ListTodo,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ALL_DAY_MINUTES } from '../../../shared/quick-add.ts'
import {
  addDays,
  dayOfWeek,
  localDateOf,
  localDateTimeOf,
  zonedMidnight,
} from '../../../shared/tz.ts'
import { useMe } from '../../hooks/useMe.ts'
import { useSpaces } from '../../hooks/useSpaces.ts'
import { useTaskActions } from '../../hooks/useTasks.ts'
import { canCreateIn } from '../../lib/space-queries.ts'
import { TASK_STATUSES, type Task } from '../../lib/task-queries.ts'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { DUE_PRESETS, daysBetween } from './TaskPickers.tsx'

/** 该任务当前用户能否写（按所在空间角色；归档空间不可写）：页面内共享一份空间列表 */
export function useTaskWritable() {
  const { data } = useSpaces()
  const map = useMemo(
    () => new Map((data ?? []).map((s) => [s.id, !s.archivedAt && canCreateIn(s)])),
    [data],
  )
  return useCallback((t: Pick<Task, 'spaceId'>) => map.get(t.spaceId) ?? false, [map])
}

/** 「今天起第 n 天」，保留原时刻（无则 23:59） */
export function dueOn(task: Pick<Task, 'dueAt'>, offset: number, tz: string): string {
  const today = localDateOf(tz, new Date())
  const minutes = task.dueAt ? localDateTimeOf(tz, new Date(task.dueAt)).minutes : ALL_DAY_MINUTES
  return new Date(
    zonedMidnight(tz, addDays(today, offset)).getTime() + (minutes || ALL_DAY_MINUTES) * 60_000,
  ).toISOString()
}
/** 到下周一的天数 */
export const daysToNextMonday = (tz: string) => {
  const today = localDateOf(tz, new Date())
  return (8 - dayOfWeek(today)) % 7 || 7
}

export type RowPicker = 'due' | 'list' | 'tags'

export function TaskRowMenu({
  task,
  open,
  onOpenChange,
  point,
  trigger,
  canWrite,
  onToggle,
  onOpen,
  onPick,
}: {
  task: Task
  open: boolean
  onOpenChange: (o: boolean) => void
  /** 右键位置；给了就锚在指针处，否则锚在 trigger 上 */
  point: { x: number; y: number } | null
  trigger?: ReactNode
  canWrite: boolean
  onToggle: (t: Task) => void
  onOpen: (t: Task) => void
  /** 需要完整选择器的项（自选日期 / 清单 / 标签）：关菜单后在行上打开对应选择器 */
  onPick: (p: RowPicker) => void
}) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const actions = useTaskActions()
  const { data: spaces } = useSpaces()
  const [spacesOpen, setSpacesOpen] = useState(false)
  const tz = me?.timezone ?? 'Asia/Shanghai'
  const today = localDateOf(tz, new Date())
  const done = task.status === 'done'
  const close = () => onOpenChange(false)
  const run = (fn: () => unknown) => () => {
    close()
    void fn()
  }
  const patch = (change: Parameters<typeof actions.patch>[1], msg?: string) =>
    run(() =>
      actions
        .patch(task, change)
        .then(() => msg && toast.success(msg))
        .catch(() => undefined),
    )
  const writable = (spaces ?? []).filter(
    (s) => !s.archivedAt && canCreateIn(s) && s.id !== task.spaceId,
  )
  const virtualRef = useMemo(
    () =>
      point
        ? {
            current: {
              getBoundingClientRect: () =>
                DOMRect.fromRect({ x: point.x, y: point.y, width: 0, height: 0 }),
            },
          }
        : undefined,
    [point],
  )
  const item = 'xz-picker-item'
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {point ? (
        <PopoverAnchor virtualRef={virtualRef as never} />
      ) : trigger ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : null}
      <PopoverContent
        align="start"
        className="w-60 p-1"
        data-testid="task-menu"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {canWrite ? (
          <button
            type="button"
            className={item}
            onClick={run(() => onToggle(task))}
            data-testid="task-menu-complete"
          >
            {done ? (
              <Circle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4 text-success" />
            )}
            {t(done ? 'taskMenu.uncomplete' : 'taskMenu.complete')}
          </button>
        ) : null}
        <button
          type="button"
          className={item}
          onClick={run(() => onOpen(task))}
          data-testid="task-menu-open"
        >
          <ExternalLink className="size-4 text-fg-muted" />
          {t('taskMenu.open')}
        </button>
        {canWrite ? (
          <>
            <div className="my-1 border-divider border-t" />
            <p className="flex items-center gap-1.5 px-2 pt-1 text-fg-muted text-xs">
              <CalendarDays className="size-3.5" />
              {t('taskMenu.due')}
            </p>
            <div className="grid grid-cols-5 gap-0.5 px-1 py-1">
              {(
                [
                  ['today', () => dueOn(task, 0, tz)],
                  ['tomorrow', () => dueOn(task, 1, tz)],
                  ['nextMonday', () => dueOn(task, daysToNextMonday(tz), tz)],
                  ['none', () => null],
                ] as const
              ).map(([k, f]) => (
                <button
                  key={k}
                  type="button"
                  className="xz-picker-quick text-[11px]"
                  onClick={patch({ dueAt: f() })}
                  data-testid={`task-menu-due-${k}`}
                >
                  {t(`picker.due.${k}`)}
                </button>
              ))}
              <button
                type="button"
                className="xz-picker-quick text-[11px]"
                onClick={run(() => onPick('due'))}
                data-testid="task-menu-due-pick"
              >
                {t('taskMenu.pickDate')}
              </button>
              {/* 相对日期快选（ADR-0050）：保留原时刻，无则 23:59 */}
              {DUE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="xz-picker-quick whitespace-nowrap text-[11px]"
                  onClick={patch({
                    dueAt: dueOn(task, daysBetween(today, p.at(today)), tz),
                  })}
                  data-testid={`task-menu-due-${p.key}`}
                >
                  {t(`picker.due.${p.key}`)}
                </button>
              ))}
            </div>
            <p className="flex items-center gap-1.5 px-2 pt-1 text-fg-muted text-xs">
              <Flag className="size-3.5" />
              {t('task.priorityLabel')}
            </p>
            <div className="flex gap-0.5 px-1 py-1">
              {[4, 3, 2, 1, 0].map((p) => (
                <button
                  key={p}
                  type="button"
                  className="xz-qa-btn xz-prio-flag flex-1"
                  data-priority={p}
                  aria-pressed={task.priority === p}
                  aria-label={t(`task.priority.${p}`)}
                  title={t(`task.priority.${p}`)}
                  onClick={patch({ priority: p })}
                  data-testid={`task-menu-prio-${p}`}
                >
                  <Flag className="size-4" />
                </button>
              ))}
            </div>
            <div className="my-1 border-divider border-t" />
          </>
        ) : (
          <div className="my-1 border-divider border-t" />
        )}
        <button
          type="button"
          className={item}
          onClick={run(() => onPick('list'))}
          data-testid="task-menu-list"
        >
          <ListTodo className="size-4 text-fg-muted" />
          {t('taskMenu.moveToList')}
        </button>
        {canWrite ? (
          <>
            <button
              type="button"
              className={item}
              onClick={run(() => onPick('tags'))}
              data-testid="task-menu-tags"
            >
              <TagIcon className="size-4 text-fg-muted" />
              {t('task.tags')}…
            </button>
            <button
              type="button"
              className={item}
              aria-expanded={spacesOpen}
              onClick={() => setSpacesOpen((x) => !x)}
              data-testid="task-menu-space"
            >
              <FolderInput className="size-4 text-fg-muted" />
              <span className="flex-1">{t('taskMenu.moveToSpace')}</span>
              <ChevronRight className={spacesOpen ? 'size-4 rotate-90' : 'size-4'} />
            </button>
            {spacesOpen ? (
              <div className="max-h-40 overflow-y-auto ps-6">
                {writable.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={item}
                    onClick={patch(
                      { spaceId: s.id },
                      t('taskMenu.movedToSpace', {
                        name: s.isPersonal ? t('space.personal') : s.name,
                      }),
                    )}
                  >
                    {s.isPersonal ? t('space.personal') : s.name}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="flex items-center gap-2 px-2 py-1 text-sm">
              <span className="w-16 text-fg-muted text-xs">{t('task.statusLabel')}</span>
              <select
                value={task.status}
                onChange={(e) => patch({ status: e.target.value as Task['status'] })()}
                className="h-7 flex-1 rounded-md border border-border bg-surface px-1 text-sm"
                data-testid="task-menu-status"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`task.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <button
          type="button"
          className={item}
          onClick={run(async () => {
            try {
              await navigator.clipboard.writeText(task.title)
              toast.success(t('taskMenu.copied'))
            } catch {
              toast.error(t('taskMenu.copyFailed'))
            }
          })}
        >
          <Copy className="size-4 text-fg-muted" />
          {t('taskMenu.copyTitle')}
        </button>
        {canWrite ? (
          <>
            <div className="my-1 border-divider border-t" />
            <button
              type="button"
              className={`${item} text-danger`}
              onClick={run(() => actions.remove(task, { undo: true }).catch(() => undefined))}
              data-testid="task-menu-delete"
            >
              <Trash2 className="size-4" />
              {t('taskMenu.delete')}
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

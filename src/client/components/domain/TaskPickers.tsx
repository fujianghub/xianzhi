/**
 * 任务的日期 / 优先级 / 清单选择器（ADR-0044、REQ-TASK-032）：快速添加框里的图标按钮与详情共用。
 * 都是 Popover + 自定义触发器；选中即回调并关闭。颜色只取 token（不变量 5）。
 */
import { useQuery } from '@tanstack/react-query'
import {
  type CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Inbox,
  type ListTodo,
  Plus,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_DAY_MINUTES } from '../../../shared/quick-add.ts'
import { addDays, addMonths, dayOfWeek, type LocalDate, localDateOf } from '../../../shared/tz.ts'
import { useMe } from '../../hooks/useMe.ts'
import { useTaskListActions } from '../../hooks/useTaskLists.ts'
import { cn } from '../../lib/cn.ts'
import { flatLists, taskListsQuery } from '../../lib/task-list-queries.ts'
import { MiniMonth } from '../calendar/MiniMonth.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE, type PaletteName } from './SpaceIcon.tsx'
import { ListDot } from './TaskListDot.tsx'

export { ListDot }

export interface DueValue {
  date: LocalDate
  /** null = 全天（23:59） */
  minutes: number | null
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** 下一个周一（今天是周一则取下周一） */
const nextMonday = (today: LocalDate) => addDays(today, (8 - dayOfWeek(today)) % 7 || 7)

export function DuePicker({
  value,
  onChange,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  value: DueValue | null
  onChange: (v: DueValue | null) => void
  trigger: ReactNode
  /** 受控开关（行内就地编辑：点胶囊才挂载并直接打开，ADR-0045） */
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const tz = me?.timezone ?? 'Asia/Shanghai'
  const today = localDateOf(tz, new Date())
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (o: boolean) => {
    setOpenState(o)
    onOpenChange?.(o)
  }
  const [month, setMonth] = useState<LocalDate>(value?.date ?? today)
  const [time, setTime] = useState(value?.minutes != null ? hhmm(value.minutes) : '')
  const pick = (date: LocalDate | null) => {
    if (!date) onChange(null)
    else {
      const [h, m] = time.split(':').map(Number)
      onChange({ date, minutes: time ? (h ?? 0) * 60 + (m ?? 0) : null })
    }
    setOpen(false)
  }
  const quick: { key: string; date: LocalDate | null }[] = [
    { key: 'today', date: today },
    { key: 'tomorrow', date: addDays(today, 1) },
    { key: 'nextMonday', date: nextMonday(today) },
    { key: 'none', date: null },
  ]
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        // 打开时同步当前值（识别出的日期 / 时间可能在挂载后才出现）
        if (o) {
          setMonth(value?.date ?? today)
          setTime(value?.minutes != null ? hhmm(value.minutes) : '')
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2" data-testid="due-picker">
        <div className="grid grid-cols-4 gap-1">
          {quick.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => pick(q.date)}
              className="xz-picker-quick"
              data-testid={`due-quick-${q.key}`}
            >
              {q.date ? (
                <span className="font-semibold text-sm tabular-nums">{q.date.d}</span>
              ) : (
                <X className="size-4" aria-hidden />
              )}
              <span className="text-[11px]">{t(`picker.due.${q.key}`)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 border-divider border-t pt-2">
          <MiniMonth
            month={month}
            weekStartsOn={me?.weekStartsOn ?? 1}
            today={today}
            selected={value?.date ?? null}
            onPick={(d) => pick(d)}
            compact
            header={
              <div className="flex items-center justify-between px-1 text-sm">
                <span className="font-medium">
                  {month.y} / {month.m}
                </span>
                <span className="flex">
                  <button
                    type="button"
                    aria-label={t('picker.due.prevMonth')}
                    onClick={() => setMonth((m) => addMonths(m, -1))}
                    className="grid size-7 place-items-center rounded-md hover:bg-hover"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('picker.due.nextMonth')}
                    onClick={() => setMonth((m) => addMonths(m, 1))}
                    className="grid size-7 place-items-center rounded-md hover:bg-hover"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </span>
              </div>
            }
          />
        </div>
        <label className="mt-2 flex items-center gap-2 border-divider border-t px-1 pt-2 text-fg-muted text-xs">
          {t('picker.due.time')}
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              if (value) {
                const [h, m] = e.target.value.split(':').map(Number)
                onChange({
                  date: value.date,
                  minutes: e.target.value ? (h ?? 0) * 60 + (m ?? 0) : null,
                })
              }
            }}
            className="h-7 flex-1 rounded-md border border-border bg-surface px-2 text-fg text-sm"
            data-testid="due-time"
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}

/** 截止值的短标签：今天 / 明天 / 周X / M/D（+ 时间） */
export function dueShort(v: DueValue, today: LocalDate, t: (k: string) => string): string {
  const diff = Math.round(
    (Date.UTC(v.date.y, v.date.m - 1, v.date.d) - Date.UTC(today.y, today.m - 1, today.d)) /
      86_400_000,
  )
  const day =
    diff === 0
      ? t('picker.due.today')
      : diff === 1
        ? t('picker.due.tomorrow')
        : `${v.date.m}/${v.date.d}`
  return v.minutes != null && v.minutes !== ALL_DAY_MINUTES ? `${day} ${hhmm(v.minutes)}` : day
}

export const PRIORITY_LEVELS = [4, 3, 2, 1, 0] as const

export function PriorityPicker({
  value,
  onChange,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  value: number
  onChange: (p: number) => void
  trigger: ReactNode
  /** 受控开关（行内就地编辑：点胶囊才挂载并直接打开，ADR-0045） */
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  const { t } = useTranslation()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (o: boolean) => {
    setOpenState(o)
    onOpenChange?.(o)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1" data-testid="priority-picker">
        {PRIORITY_LEVELS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              onChange(p)
              setOpen(false)
            }}
            className="xz-picker-item"
            data-priority={p}
          >
            <Flag className="xz-prio-flag size-4" data-priority={p} aria-hidden />
            <span className="flex-1">{t(`task.priority.${p}`)}</span>
            {value === p ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function ListPicker({
  value,
  onChange,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  value: string | null
  onChange: (listId: string | null) => void
  trigger: ReactNode
  /** 受控开关（行内就地编辑：点胶囊才挂载并直接打开，ADR-0045） */
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  const { t } = useTranslation()
  const { data } = useQuery(taskListsQuery)
  const actions = useTaskListActions()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (o: boolean) => {
    setOpenState(o)
    onOpenChange?.(o)
  }
  const [name, setName] = useState('')
  const lists = flatLists(data?.items ?? [])
  const pick = (id: string | null) => {
    onChange(id)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1" data-testid="list-picker">
        <div className="max-h-60 overflow-y-auto">
          <button type="button" onClick={() => pick(null)} className="xz-picker-item">
            <Inbox className="size-4 text-fg-muted" aria-hidden />
            <span className="flex-1">{t('taskLists.unlisted')}</span>
            {value === null ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
          </button>
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => pick(l.id)}
              className="xz-picker-item"
              data-list-id={l.id}
            >
              <ListDot list={l} />
              <span className="flex-1 truncate">{l.name}</span>
              {value === l.id ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
            </button>
          ))}
        </div>
        {data?.canCreate ? (
          <form
            className="mt-1 flex items-center gap-1 border-divider border-t px-1 pt-1"
            onSubmit={(e) => {
              e.preventDefault()
              const n = name.trim()
              if (!n) return
              const color = PALETTE[(lists.length * 3) % PALETTE.length] as PaletteName
              actions.create.mutate(
                { name: n, color },
                {
                  onSuccess: (l) => {
                    setName('')
                    pick(l.id)
                  },
                },
              )
            }}
          >
            <Plus className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('taskLists.newPlaceholder')}
              aria-label={t('taskLists.new')}
              maxLength={40}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
              data-testid="list-picker-new"
            />
          </form>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** 快速添加框里的图标按钮（有值时显示值、带色调） */
export function PickerButton({
  icon: Icon,
  label,
  value,
  active,
  className,
  testId,
  ...rest
}: {
  icon: typeof CalendarDays | typeof ListTodo
  label: string
  value?: ReactNode
  active?: boolean
  className?: string
  testId?: string
} & Omit<React.ComponentProps<'button'>, 'value'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('xz-qa-btn', active && 'xz-qa-btn-on', className)}
      data-testid={testId}
      {...rest}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {/* 窄屏只留图标，给输入留地方 */}
      {value ? <span className="hidden max-w-24 truncate sm:inline">{value}</span> : null}
    </button>
  )
}

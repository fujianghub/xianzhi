/**
 * 日历视图（08 §2.17、REQ-UI-031；Apple 日历风格）：月视图 6×7、周视图（全天行 + 24 小时时间轴 + 当前时间红线）。
 * 事件 = 任务：优先按 dueAt 归日，否则 scheduledAt；本地 23:59 / 00:00 视为全天（新建任务默认截止当日 23:59）。
 * 颜色取空间 8 色板；点击事件打开 Peek（不改 URL）。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  dayOfWeek,
  formatLocalDate,
  type LocalDate,
  localDateTimeOf,
  sameLocalDate,
} from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { usePeek } from '../../lib/stores.ts'
import type { Task } from '../../lib/task-queries.ts'
import { PALETTE_DOT, type PaletteName } from './SpaceIcon.tsx'

export interface CalEvent {
  task: Task
  day: string
  minutes: number
  allDay: boolean
  kind: 'due' | 'start'
}

/** 任务 → 日历事件（按用户时区归日） */
export function toEvents(tasks: Task[], tz: string): CalEvent[] {
  const out: CalEvent[] = []
  for (const task of tasks) {
    const iso = task.dueAt ?? task.scheduledAt
    if (!iso) continue
    const { date, minutes } = localDateTimeOf(tz, new Date(iso))
    out.push({
      task,
      day: formatLocalDate(date),
      minutes,
      allDay: minutes === 0 || minutes === 23 * 60 + 59,
      kind: task.dueAt ? 'due' : 'start',
    })
  }
  return out.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      a.minutes - b.minutes ||
      b.task.priority - a.task.priority,
  )
}

/** Tailwind 静态类名（app.css 的 --color-<palette>-bg / -fg） */
const DOT = PALETTE_DOT
const BLOCK: Record<PaletteName, string> = {
  moss: 'bg-moss-bg text-moss-fg border-moss-fg',
  amber: 'bg-amber-bg text-amber-fg border-amber-fg',
  indigo: 'bg-indigo-bg text-indigo-fg border-indigo-fg',
  ochre: 'bg-ochre-bg text-ochre-fg border-ochre-fg',
  teal: 'bg-teal-bg text-teal-fg border-teal-fg',
  plum: 'bg-plum-bg text-plum-fg border-plum-fg',
  gray: 'bg-gray-bg text-gray-fg border-gray-fg',
  pine: 'bg-pine-bg text-pine-fg border-pine-fg',
}
const palette = (colors: Map<string, string | null>, spaceId: string): PaletteName => {
  const c = colors.get(spaceId)
  return c && c in DOT ? (c as PaletteName) : 'moss'
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

function useOpenTask() {
  const openPeek = usePeek((s) => s.open)
  return (t: Task) => openPeek({ kind: 'task', id: t.id, spaceSlug: t.spaceSlug })
}

function EventChip({
  e,
  colors,
  compact,
}: {
  e: CalEvent
  colors: Map<string, string | null>
  compact?: boolean
}) {
  const { t } = useTranslation()
  const open = useOpenTask()
  const p = palette(colors, e.task.spaceId)
  const done = e.task.status === 'done' || e.task.status === 'cancelled'
  const label = t('calendar.eventLabel', {
    title: e.task.title,
    time: e.allDay ? t('calendar.allDay') : hhmm(e.minutes),
    kind: t(`calendar.${e.kind}`),
  })
  return (
    <button
      type="button"
      onClick={() => open(e.task)}
      title={label}
      aria-label={label}
      data-testid="cal-event"
      data-task-id={e.task.id}
      className={cn(
        'flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs leading-5 transition-colors duration-(--xz-dur-fast)',
        e.allDay ? cn(BLOCK[p], 'border-0 font-medium hover:brightness-95') : 'hover:bg-hover',
        done && 'line-through opacity-60',
        compact && 'py-0.5',
      )}
    >
      {e.allDay ? null : (
        <span className={cn('size-2 shrink-0 rounded-full', DOT[p])} aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">{e.task.title}</span>
      {e.allDay ? null : (
        <span className="shrink-0 text-fg-muted tabular-nums">{hhmm(e.minutes)}</span>
      )}
    </button>
  )
}

const weekdayFmt = (short: boolean) =>
  new Intl.DateTimeFormat('zh-CN', { weekday: short ? 'narrow' : 'short', timeZone: 'UTC' })
const weekdayName = (d: LocalDate, short = false) =>
  weekdayFmt(short).format(new Date(Date.UTC(d.y, d.m - 1, d.d)))

// ---------------------------------------------------------------- 月视图

export function MonthView({
  days,
  anchor,
  today,
  events,
  colors,
  onPickDay,
}: {
  days: LocalDate[]
  anchor: LocalDate
  today: LocalDate
  events: CalEvent[]
  colors: Map<string, string | null>
  onPickDay: (d: LocalDate) => void
}) {
  const { t } = useTranslation()
  const byDay = new Map<string, CalEvent[]>()
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e])
  const MAX = 3
  return (
    <div className="paper overflow-hidden rounded-xl" data-testid="cal-month">
      <div className="grid grid-cols-7 border-divider border-b" aria-hidden>
        {days.slice(0, 7).map((d) => (
          <div
            key={formatLocalDate(d)}
            className="px-3 py-2 text-right text-fg-muted text-xs tracking-[.08em]"
          >
            {weekdayName(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const key = formatLocalDate(d)
          const list = byDay.get(key) ?? []
          const inMonth = d.m === anchor.m
          const isToday = sameLocalDate(d, today)
          const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6
          return (
            <div
              key={key}
              data-testid="cal-day"
              data-date={key}
              className={cn(
                'flex min-h-28 min-w-0 flex-col gap-0.5 border-divider p-1.5',
                i % 7 !== 6 && 'border-r',
                i < 35 && 'border-b',
                !inMonth && 'bg-surface-2/60',
                inMonth && weekend && !isToday && 'bg-surface-2/25',
                isToday && 'bg-selected/60',
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(d)}
                aria-label={t('calendar.openWeek', { date: `${d.m}/${d.d}` })}
                className={cn(
                  'ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[13px] tabular-nums hover:bg-hover',
                  isToday && 'bg-primary font-semibold text-primary-fg hover:bg-primary',
                  !isToday && !inMonth && 'text-fg-faint',
                  !isToday && inMonth && weekend && 'text-fg-muted',
                )}
                aria-current={isToday ? 'date' : undefined}
              >
                {d.d === 1 ? t('calendar.monthDay', { m: d.m, d: d.d }) : d.d}
              </button>
              {list.slice(0, MAX).map((e) => (
                <EventChip key={`${e.task.id}-${e.kind}`} e={e} colors={colors} compact />
              ))}
              {list.length > MAX ? (
                <button
                  type="button"
                  onClick={() => onPickDay(d)}
                  className="min-h-6 rounded-md px-1.5 text-left text-fg-muted text-xs hover:bg-hover hover:text-fg"
                >
                  {t('calendar.more', { count: list.length - MAX })}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 周视图

const HOUR = 48
/** 事件块视觉高度（任务没有时长，按 50 分钟占位） */
const SPAN_MIN = 50

/**
 * 时间轴分栏（Apple 日历式）：时间上重叠的事件为一簇，簇内按列平分宽度。
 * 返回每个事件的列号与所在簇的列数。
 */
export function layoutLanes(list: CalEvent[]): { lane: number; lanes: number }[] {
  const out = list.map(() => ({ lane: 0, lanes: 1 }))
  let cluster: number[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const i of cluster) (out[i] as { lanes: number }).lanes = laneEnds.length
    cluster = []
    laneEnds = []
  }
  list.forEach((e, i) => {
    if (e.minutes >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= e.minutes)
    if (lane < 0) lane = laneEnds.push(0) - 1
    laneEnds[lane] = e.minutes + SPAN_MIN
    ;(out[i] as { lane: number }).lane = lane
    cluster.push(i)
    clusterEnd = Math.max(clusterEnd, e.minutes + SPAN_MIN)
  })
  flush()
  return out
}
const HOUR_MARKS = Array.from({ length: 23 }, (_, i) => i + 1)

export function WeekView({
  days,
  today,
  tz,
  events,
  colors,
}: {
  days: LocalDate[]
  today: LocalDate
  tz: string
  events: CalEvent[]
  colors: Map<string, string | null>
}) {
  const { t } = useTranslation()
  const open = useOpenTask()
  const scroller = useRef<HTMLDivElement>(null)
  const [nowMin, setNowMin] = useState(() => localDateTimeOf(tz, new Date()).minutes)
  useEffect(() => {
    const id = setInterval(() => setNowMin(localDateTimeOf(tz, new Date()).minutes), 60_000)
    return () => clearInterval(id)
  }, [tz])
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR - 12
  }, [])

  const keys = days.map(formatLocalDate)
  const allDay = keys.map((k) => events.filter((e) => e.day === k && e.allDay))
  const timed = keys.map((k) => events.filter((e) => e.day === k && !e.allDay))
  const layout = timed.map(layoutLanes)
  const todayIdx = days.findIndex((d) => sameLocalDate(d, today))

  return (
    <div className="paper flex flex-col overflow-hidden rounded-xl" data-testid="cal-week">
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-divider border-b">
        <div />
        {days.map((d, i) => {
          const isToday = i === todayIdx
          return (
            <div key={keys[i]} className="flex items-baseline justify-center gap-1.5 py-2.5">
              <span className={cn('text-xs', isToday ? 'text-primary-text' : 'text-fg-muted')}>
                {weekdayName(d)}
              </span>
              <span
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-full font-display text-lg tabular-nums',
                  isToday && 'bg-primary text-primary-fg',
                )}
                aria-current={isToday ? 'date' : undefined}
              >
                {d.d}
              </span>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-divider border-b bg-surface-2/50">
        <div className="self-center pr-2 text-right text-[11px] text-fg-muted">
          {t('calendar.allDay')}
        </div>
        {allDay.map((list, i) => (
          <div
            key={keys[i]}
            className="flex min-h-9 min-w-0 flex-col gap-0.5 border-divider border-l p-1"
          >
            {list.map((e) => (
              <EventChip key={`${e.task.id}-${e.kind}`} e={e} colors={colors} />
            ))}
          </div>
        ))}
      </div>
      <div
        ref={scroller}
        className="relative max-h-[calc(100dvh-19rem)] min-h-80 overflow-y-auto"
        data-testid="cal-timeline"
      >
        <div
          className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
          style={{ height: 24 * HOUR }}
        >
          <div className="relative">
            {HOUR_MARKS.map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-muted tabular-nums"
                style={{ top: h * HOUR }}
              >
                {hhmm(h * 60)}
              </span>
            ))}
          </div>
          {timed.map((list, i) => (
            <div
              key={keys[i]}
              className="relative border-divider border-l bg-[linear-gradient(to_bottom,var(--xz-divider)_1px,transparent_1px)]"
              style={{ backgroundSize: `100% ${HOUR}px` }}
            >
              {list.map((e, k) => {
                const p = palette(colors, e.task.spaceId)
                const { lane, lanes } = layout[i]?.[k] ?? { lane: 0, lanes: 1 }
                const done = e.task.status === 'done' || e.task.status === 'cancelled'
                return (
                  <button
                    key={`${e.task.id}-${e.kind}`}
                    type="button"
                    onClick={() => open(e.task)}
                    data-testid="cal-event"
                    data-task-id={e.task.id}
                    title={t('calendar.eventLabel', {
                      title: e.task.title,
                      time: hhmm(e.minutes),
                      kind: t(`calendar.${e.kind}`),
                    })}
                    className={cn(
                      'absolute flex min-w-0 flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs shadow-(--xz-shadow-soft) hover:brightness-95',
                      BLOCK[p],
                      done && 'line-through opacity-60',
                    )}
                    style={{
                      top: (e.minutes / 60) * HOUR + 1,
                      height: (SPAN_MIN / 60) * HOUR - 3,
                      left: `calc(${(lane / lanes) * 100}% + 3px)`,
                      width: `calc(${100 / lanes}% - 6px)`,
                    }}
                  >
                    <span className="block w-full truncate font-medium leading-4">
                      {e.task.title}
                    </span>
                    {lanes < 3 ? (
                      <span className="block w-full truncate leading-4 tabular-nums opacity-80">
                        {hhmm(e.minutes)} · {t(`calendar.${e.kind}`)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {i === todayIdx ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger"
                  style={{ top: (nowMin / 60) * HOUR }}
                  data-testid="cal-now"
                  aria-hidden
                >
                  <span className="absolute -top-[5px] -left-[5px] size-3 rounded-full bg-danger" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

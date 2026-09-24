/**
 * 日历（08 §2.17；REQ-UI-031 · REQ-TASK-024；Apple 日历风格）：`?view=month|week&date=YYYY-MM-DD`。
 * 取数 GET /tasks?from&to（截止或计划开始落在区间内，跨全部可见空间），翻页取全；按用户时区与 weekStartsOn 排版。
 * 快捷键：t 今天、← / → 上一 / 下一段、m 月、w 周。
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  addMonths,
  formatLocalDate,
  type LocalDate,
  localDateOf,
  monthGrid,
  parseLocalDate,
  weekDays,
  zonedMidnight,
} from '../../shared/tz.ts'
import { MonthView, toEvents, WeekView } from '../components/domain/CalendarViews.tsx'
import { useHotkeys } from '../hooks/useHotkeys.ts'
import type { Me } from '../hooks/useMe.ts'
import { useSpaces } from '../hooks/useSpaces.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf, optString } from '../lib/search.ts'
import { flattenPages, tasksInfiniteQuery } from '../lib/task-queries.ts'

type View = 'month' | 'week'

export const Route = createFileRoute('/_app/calendar')({
  validateSearch: (s: Record<string, unknown>): { view?: View; date?: string } => {
    const date = optString(s.date)
    return {
      view: optOneOf(['month', 'week'] as const)(s.view),
      date: parseLocalDate(date) ? date : undefined,
    }
  },
  component: Calendar,
})

function Calendar() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/calendar' })
  const view: View = search.view ?? 'month'
  const today = useMemo(() => localDateOf(me.timezone, new Date()), [me.timezone])
  const anchor = parseLocalDate(search.date) ?? today

  const { days, start, end } = useMemo(() => {
    if (view === 'month') return monthGrid(me.timezone, me.weekStartsOn, anchor)
    const w = weekDays(me.weekStartsOn, anchor)
    return {
      days: w,
      start: zonedMidnight(me.timezone, w[0] as LocalDate),
      end: zonedMidnight(me.timezone, addDays(w[0] as LocalDate, 7)),
    }
  }, [view, anchor, me.timezone, me.weekStartsOn])

  const q = useInfiniteQuery(
    tasksInfiniteQuery({ from: start.toISOString(), to: end.toISOString(), sort: 'dueAt' }),
  )
  // 区间内超过一页时取全（limit 200/页）
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage])
  const events = useMemo(() => toEvents(flattenPages(q.data), me.timezone), [q.data, me.timezone])
  const spaces = useSpaces()
  const colors = useMemo(
    () => new Map((spaces.data ?? []).map((s) => [s.id, s.color ?? null] as const)),
    [spaces.data],
  )

  const go = (next: { view?: View; date?: LocalDate }) =>
    nav({
      search: {
        view: (next.view ?? view) === 'month' ? undefined : 'week',
        date:
          next.date && formatLocalDate(next.date) !== formatLocalDate(today)
            ? formatLocalDate(next.date)
            : undefined,
      },
      replace: true,
    })
  const step = (dir: 1 | -1) =>
    go({ date: view === 'month' ? addMonths(anchor, dir) : addDays(anchor, 7 * dir) })

  useHotkeys({
    t: () => go({ date: today }),
    arrowleft: () => step(-1),
    arrowright: () => step(1),
    m: () => go({ view: 'month', date: anchor }),
    w: () => go({ view: 'week', date: anchor }),
  })

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="calendar">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-baseline gap-2" data-testid="cal-title">
          <span className="font-display text-[34px] leading-none tracking-[.06em]">
            {t('calendar.monthName', { m: anchor.m })}
          </span>
          <span className="font-display text-[22px] text-fg-muted leading-none">
            {t('calendar.yearName', { y: anchor.y })}
          </span>
          {q.isFetching ? (
            <span className="ml-2 text-fg-muted text-xs" role="status">
              {t('calendar.loading')}
            </span>
          ) : null}
        </h1>
        <div className="flex items-center gap-2">
          <fieldset className="inline-flex rounded-lg bg-active p-0.5">
            <legend className="sr-only">{t('calendar.viewLabel')}</legend>
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => go({ view: v, date: anchor })}
                data-testid={`cal-view-${v}`}
                className={cn(
                  'h-8 min-w-12 rounded-md px-3 text-sm transition-[background-color,box-shadow] duration-(--xz-dur-fast)',
                  view === v
                    ? 'bg-surface font-medium shadow-(--xz-shadow-soft)'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {t(`calendar.${v}`)}
              </button>
            ))}
          </fieldset>
          <div className="inline-flex items-center rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={t('calendar.prev')}
              className="inline-flex size-8 items-center justify-center rounded-l-lg text-fg-muted hover:bg-hover hover:text-fg"
              data-testid="cal-prev"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => go({ date: today })}
              className="h-8 border-border border-x px-3 text-sm hover:bg-hover"
              data-testid="cal-today"
            >
              {t('calendar.today')}
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={t('calendar.next')}
              className="inline-flex size-8 items-center justify-center rounded-r-lg text-fg-muted hover:bg-hover hover:text-fg"
              data-testid="cal-next"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </header>
      {view === 'month' ? (
        <MonthView
          days={days}
          anchor={anchor}
          today={today}
          events={events}
          colors={colors}
          onPickDay={(d) => go({ view: 'week', date: d })}
        />
      ) : (
        <WeekView days={days} today={today} tz={me.timezone} events={events} colors={colors} />
      )}
    </section>
  )
}

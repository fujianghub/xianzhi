/**
 * 右侧速览栏（REQ-UI-034，宽屏 ≥ xl 填充列表页右侧空白）：今天（日期 / 农历 / 节假日）· 今日日程 · 小月历 · 7 天内到期任务。
 * 用于今日 / 收件箱 / 通知；数据走已有查询（calendar-events、tasks?from&to），各自缓存复用。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, CalendarPlus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { dayMeta } from '../../../shared/cn-days.ts'
import {
  addDays,
  formatLocalDate,
  localDateOf,
  localDateTimeOf,
  monthGrid,
  zonedMidnight,
} from '../../../shared/tz.ts'
import { calendarsQuery, occurrencesQuery } from '../../lib/calendar-queries.ts'
import { cn } from '../../lib/cn.ts'
import { usePeek } from '../../lib/stores.ts'
import { flattenPages, tasksInfiniteQuery } from '../../lib/task-queries.ts'
import { MiniMonth } from '../calendar/MiniMonth.tsx'
import { weekdayName } from '../calendar/MonthView.tsx'
import { hhmm } from '../calendar/model.ts'
import { DOT } from '../calendar/parts.tsx'

function Card({
  title,
  action,
  children,
  testId,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section className="paper rounded-xl p-4" data-testid={testId}>
      {title ? (
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="font-medium text-fg-muted text-xs tracking-[.08em]">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function GlanceRail({ tz, weekStartsOn }: { tz: string; weekStartsOn: number }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const openPeek = usePeek((s) => s.open)
  const today = useMemo(() => localDateOf(tz, new Date()), [tz])
  const meta = dayMeta(today)
  const dayStart = zonedMidnight(tz, today)
  const dayEnd = zonedMidnight(tz, addDays(today, 1))
  const grid = useMemo(() => monthGrid(tz, weekStartsOn, today), [tz, weekStartsOn, today])

  const calendars = useQuery(calendarsQuery)
  const hidden = new Set((calendars.data ?? []).filter((c) => c.hidden).map((c) => c.id))
  const color = new Map((calendars.data ?? []).map((c) => [c.id, c.color] as const))
  const monthOcc = useQuery({
    ...occurrencesQuery(grid.start.toISOString(), grid.end.toISOString()),
    enabled: calendars.isSuccess,
  })
  const visible = (monthOcc.data ?? []).filter((o) => !hidden.has(o.calendarId))
  const todays = visible.filter((o) => new Date(o.startAt) < dayEnd && new Date(o.endAt) > dayStart)
  const marked = useMemo(() => {
    const s = new Set<string>()
    for (const o of visible) {
      const zone = o.allDay ? o.timezone : tz
      let d = localDateOf(zone, new Date(o.startAt))
      const last = formatLocalDate(localDateOf(zone, new Date(new Date(o.endAt).getTime() - 1)))
      for (let i = 0; i < 45 && formatLocalDate(d) <= last; i++) {
        s.add(formatLocalDate(d))
        d = addDays(d, 1)
      }
    }
    return s
  }, [visible, tz])

  const weekEnd = zonedMidnight(tz, addDays(today, 8))
  const dueQ = useInfiniteQuery(
    tasksInfiniteQuery(
      { from: dayStart.toISOString(), to: weekEnd.toISOString(), sort: 'dueAt' },
      50,
    ),
  )
  const due = flattenPages(dueQ.data)
    .filter((x) => x.dueAt && x.status !== 'done' && x.status !== 'cancelled')
    .slice(0, 6)

  const dayLink = (d = today) => ({
    to: '/calendar' as const,
    search: { view: 'day' as const, date: formatLocalDate(d) },
  })

  return (
    <aside className="flex flex-col gap-4" data-testid="glance-rail">
      <Card testId="glance-today">
        <div className="flex items-end gap-3">
          <span className="font-display text-5xl tabular-nums leading-none">{today.d}</span>
          <span className="flex flex-col pb-0.5 text-sm">
            <span className="font-medium">
              {t('calendar.monthName', { m: today.m })} · {weekdayName(today)}
            </span>
            {meta.lunarFull ? (
              <span className="text-fg-muted text-xs">
                {t('calendar.lunarLine', { year: meta.yearName ?? '', date: meta.lunarFull })}
              </span>
            ) : null}
          </span>
        </div>
        {meta.off || meta.work || meta.festival || meta.term ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {meta.off ? (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary-text text-xs">
                {t('calendar.holidayOff', { name: meta.off })}
              </span>
            ) : null}
            {meta.work ? (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs">
                {t('calendar.holidayWork', { name: meta.work })}
              </span>
            ) : null}
            {meta.festival ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs">
                {meta.festival}
              </span>
            ) : null}
            {meta.term ? (
              <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs">{meta.term}</span>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card
        title={t('glance.schedule')}
        testId="glance-schedule"
        action={
          <Link
            {...dayLink()}
            className="inline-flex items-center gap-0.5 text-primary-text text-xs hover:underline"
          >
            {t('glance.openCalendar')}
            <ArrowUpRight className="size-3.5" />
          </Link>
        }
      >
        {todays.length ? (
          <ul className="flex flex-col gap-0.5">
            {todays.slice(0, 6).map((o) => {
              const s = localDateTimeOf(tz, new Date(o.startAt))
              const e = localDateTimeOf(tz, new Date(o.endAt))
              const past = new Date(o.endAt).getTime() < Date.now()
              return (
                <li key={o.key}>
                  <Link
                    {...dayLink()}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-hover',
                      past && 'opacity-55',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        DOT[color.get(o.calendarId) ?? 'blue'],
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{o.title}</span>
                      <span className="block text-fg-muted text-xs tabular-nums">
                        {o.allDay
                          ? t('calendar.allDay')
                          : `${hhmm(s.minutes)} – ${hhmm(e.minutes)}`}
                        {o.location ? ` · ${o.location}` : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <Link
            {...dayLink()}
            className="flex items-center gap-2 rounded-md px-1.5 py-2 text-fg-muted text-sm hover:bg-hover hover:text-fg"
          >
            <CalendarPlus className="size-4" />
            {t('glance.noSchedule')}
          </Link>
        )}
      </Card>

      <Card testId="glance-month">
        <MiniMonth
          month={today}
          weekStartsOn={weekStartsOn}
          today={today}
          marked={marked}
          onPick={(d) => void nav(dayLink(d))}
          header={
            <div className="mb-1 px-1 font-medium text-sm">
              {t('calendar.yearName', { y: today.y })} {t('calendar.monthName', { m: today.m })}
            </div>
          }
        />
      </Card>

      <Card title={t('glance.dueSoon')} testId="glance-due">
        {due.length ? (
          <ul className="flex flex-col gap-0.5">
            {due.map((task) => {
              const d = localDateTimeOf(tz, new Date(task.dueAt as string))
              const isToday = formatLocalDate(d.date) === formatLocalDate(today)
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() =>
                      openPeek({ kind: 'task', id: task.id, spaceSlug: task.spaceSlug })
                    }
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        isToday ? 'text-warning' : 'text-fg-muted',
                      )}
                    >
                      {isToday
                        ? t('calendar.today')
                        : t('calendar.monthDay', { m: d.date.m, d: d.date.d })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-1.5 text-fg-muted text-sm">{t('glance.noDue')}</p>
        )}
      </Card>
    </aside>
  )
}

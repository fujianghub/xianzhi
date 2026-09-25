/**
 * 日历（08 §2.17；ADR-0009；REQ-CAL-001 ~ 009 · REQ-UI-031 · REQ-TASK-024；对标 macOS 日历）：
 * `?view=day|week|month|year&date=YYYY-MM-DD`。左栏小月历 + 我的日历 + 叠加项 + 接下来；右侧主视图。
 * 数据：GET /calendar-events?from&to（日程，含重复展开）+ 叠加 GET /tasks?from&to（截止 / 计划开始；年视图不叠加）。
 * 交互：空白处点击 / 拖选新建；点日程编辑；拖动改期、拖底边改时长；重复日程询问范围。
 * 快捷键：t 今天、← / → 翻页、d / w / m / y 切视图、n 新建日程。
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, PanelLeft, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  addDays,
  addMonths,
  formatLocalDate,
  type LocalDate,
  localDateOf,
  localDateTimeOf,
  monthGrid,
  parseLocalDate,
  weekDays,
  zonedMidnight,
} from '../../shared/tz.ts'
import { CalendarSidebar, type Overlay } from '../components/calendar/CalendarSidebar.tsx'
import { DayAside } from '../components/calendar/DayAside.tsx'
import { type EditorTarget, EventEditor } from '../components/calendar/EventEditor.tsx'
import { MonthView, weekdayName } from '../components/calendar/MonthView.tsx'
import {
  at,
  type CalItem,
  covers,
  dayKey,
  eventToItem,
  MIN_PER_DAY,
  taskToItem,
} from '../components/calendar/model.ts'
import { useScopePrompt } from '../components/calendar/ScopeDialog.tsx'
import { TimeGrid } from '../components/calendar/TimeGrid.tsx'
import { YearView } from '../components/calendar/YearView.tsx'
import { Button } from '../components/ui/button.tsx'
import { useHotkeys } from '../hooks/useHotkeys.ts'
import type { Me } from '../hooks/useMe.ts'
import { useSpaces } from '../hooks/useSpaces.ts'
import { ApiError } from '../lib/api.ts'
import {
  type CalendarOccurrence,
  calendarsQuery,
  invalidateCalendar,
  occurrencesQuery,
  patchEvent,
} from '../lib/calendar-queries.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf, optString } from '../lib/search.ts'
import { usePeek } from '../lib/stores.ts'
import { flattenPages, tasksInfiniteQuery } from '../lib/task-queries.ts'

const VIEWS = ['day', 'week', 'month', 'year'] as const
type View = (typeof VIEWS)[number]

export const Route = createFileRoute('/_app/calendar')({
  validateSearch: (s: Record<string, unknown>): { view?: View; date?: string } => {
    const date = optString(s.date)
    return {
      view: optOneOf(VIEWS)(s.view),
      date: parseLocalDate(date) ? date : undefined,
    }
  },
  component: Calendar,
})

const OVERLAY_KEY = 'xz.calendar.overlay'
function loadOverlay(): Overlay {
  const d: Overlay = { tasks: true, lunar: true, holidays: true }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(OVERLAY_KEY) ?? '{}') as Partial<Overlay>) }
  } catch {
    return d
  }
}
const SIDEBAR_KEY = 'xz.calendar.sidebar'

function Calendar() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { me } = Route.useRouteContext() as { me: Me }
  const tz = me.timezone
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/calendar' })
  const view: View = search.view ?? 'month'
  const today = useMemo(() => localDateOf(tz, new Date()), [tz])
  const anchor = useMemo(() => parseLocalDate(search.date) ?? today, [search.date, today])
  const [overlay, setOverlayState] = useState<Overlay>(loadOverlay)
  const setOverlay = (o: Overlay) => {
    setOverlayState(o)
    try {
      localStorage.setItem(OVERLAY_KEY, JSON.stringify(o))
    } catch {
      /* 隐私模式 */
    }
  }
  const [sidebar, setSidebarState] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggleSidebar = () => {
    setSidebarState((v) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, v ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !v
    })
  }
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [scopeEl, askScope] = useScopePrompt()
  const openPeek = usePeek((s) => s.open)

  // ---- 区间 ----
  const { days, start, end } = useMemo(() => {
    if (view === 'month') return monthGrid(tz, me.weekStartsOn, anchor)
    if (view === 'week') {
      const w = weekDays(me.weekStartsOn, anchor)
      const first = w[0] as LocalDate
      return { days: w, start: zonedMidnight(tz, first), end: zonedMidnight(tz, addDays(first, 7)) }
    }
    if (view === 'day')
      return {
        days: [anchor],
        start: zonedMidnight(tz, anchor),
        end: zonedMidnight(tz, addDays(anchor, 1)),
      }
    const jan1 = { y: anchor.y, m: 1, d: 1 }
    return {
      days: [] as LocalDate[],
      start: zonedMidnight(tz, jan1),
      end: zonedMidnight(tz, { y: anchor.y + 1, m: 1, d: 1 }),
    }
  }, [view, anchor, tz, me.weekStartsOn])

  const calendars = useQuery(calendarsQuery)
  const calMap = useMemo(
    () => new Map((calendars.data ?? []).map((c) => [c.id, c] as const)),
    [calendars.data],
  )
  const hidden = useMemo(
    () => new Set((calendars.data ?? []).filter((c) => c.hidden).map((c) => c.id)),
    [calendars.data],
  )
  const occ = useQuery({
    ...occurrencesQuery(start.toISOString(), end.toISOString()),
    enabled: calendars.isSuccess,
  })
  const withTasks = overlay.tasks && view !== 'year'
  const tq = useInfiniteQuery({
    ...tasksInfiniteQuery({ from: start.toISOString(), to: end.toISOString(), sort: 'dueAt' }),
    enabled: withTasks,
  })
  useEffect(() => {
    if (withTasks && tq.hasNextPage && !tq.isFetchingNextPage) void tq.fetchNextPage()
  }, [withTasks, tq.hasNextPage, tq.isFetchingNextPage, tq.fetchNextPage])
  const spaces = useSpaces()
  const spaceColor = useMemo(
    () => new Map((spaces.data ?? []).map((s) => [s.id, s.color ?? null] as const)),
    [spaces.data],
  )

  const items = useMemo(() => {
    const out: CalItem[] = (occ.data ?? [])
      .filter((o) => !hidden.has(o.calendarId))
      .map((o) => eventToItem(o, tz, calMap))
    if (withTasks)
      for (const task of flattenPages(tq.data)) {
        const it = taskToItem(task, tz, spaceColor.get(task.spaceId))
        if (it) out.push(it)
      }
    return out
  }, [occ.data, hidden, tz, calMap, withTasks, tq.data, spaceColor])

  // 侧栏「接下来」：今天起 7 天
  const upStart = zonedMidnight(tz, today)
  const upEnd = zonedMidnight(tz, addDays(today, 8))
  const upcomingQ = useQuery({
    ...occurrencesQuery(upStart.toISOString(), upEnd.toISOString()),
    enabled: calendars.isSuccess && sidebar,
  })
  const upcoming = useMemo(() => {
    const now = Date.now()
    return (upcomingQ.data ?? [])
      .filter((o) => !hidden.has(o.calendarId) && new Date(o.endAt).getTime() > now)
      .map((o) => eventToItem(o, tz, calMap))
  }, [upcomingQ.data, hidden, tz, calMap])

  const marked = useMemo(() => {
    const s = new Set<string>()
    for (const it of items) {
      if (it.source !== 'event') continue
      let d = parseLocalDate(it.startDay) as LocalDate
      for (let i = 0; i < 62 && dayKey(d) <= it.endDay; i++) {
        s.add(dayKey(d))
        d = addDays(d, 1)
      }
    }
    return s
  }, [items])

  // ---- 导航 ----
  const go = (next: { view?: View; date?: LocalDate }) =>
    nav({
      search: {
        view: (next.view ?? view) === 'month' ? undefined : (next.view ?? view),
        date:
          next.date && formatLocalDate(next.date) !== formatLocalDate(today)
            ? formatLocalDate(next.date)
            : undefined,
      },
      replace: true,
    })
  const step = (dir: 1 | -1) =>
    go({
      date:
        view === 'month'
          ? addMonths(anchor, dir)
          : view === 'year'
            ? { y: anchor.y + dir, m: anchor.m, d: 1 }
            : addDays(anchor, (view === 'week' ? 7 : 1) * dir),
    })
  const pickDay = (d: LocalDate) => go({ view: 'day', date: d })

  // ---- 新建 / 打开 ----
  const firstVisibleCal = (calendars.data ?? []).find((c) => !c.hidden)?.id
  const createAt = (d: LocalDate, from: number, to: number) =>
    setEditor({
      mode: 'create',
      start: at(tz, d, from),
      end: at(tz, d, to),
      allDay: false,
      calendarId: firstVisibleCal,
    })
  /** 全天日程：单日点击或按住拖选 d..to（含，REQ-CAL-010）。 */
  const createAllDay = (d: LocalDate, to: LocalDate = d) =>
    setEditor({
      mode: 'create',
      start: zonedMidnight(tz, d),
      end: zonedMidnight(tz, addDays(to, 1)),
      allDay: true,
      calendarId: firstVisibleCal,
    })
  const newEventNow = () => {
    const base = view === 'day' || view === 'week' ? anchor : today
    const nowMin = localDateTimeOf(tz, new Date()).minutes
    const from = Math.min(MIN_PER_DAY - 60, Math.ceil((nowMin + 1) / 30) * 30)
    createAt(base, from, from + 60)
  }
  const open = (it: CalItem) => {
    if (it.occ) setEditor({ mode: 'edit', occ: it.occ })
    else if (it.task) openPeek({ kind: 'task', id: it.task.id, spaceSlug: it.task.spaceSlug })
  }

  // ---- 拖动改期 ----
  const reschedule = async (o: CalendarOccurrence, startAt: Date, endAt: Date) => {
    let scope: 'this' | 'future' | 'all' = 'all'
    if (o.isException) scope = 'this'
    else if (o.recurring) {
      const s = await askScope('save')
      if (!s) return
      scope = s
    }
    // 乐观：先把当前区间缓存里的这一条挪过去
    const key = occurrencesQuery(start.toISOString(), end.toISOString()).queryKey
    const prev = qc.getQueryData<CalendarOccurrence[]>(key)
    if (prev && scope !== 'future')
      qc.setQueryData<CalendarOccurrence[]>(
        key,
        prev.map((x) =>
          x.key === o.key
            ? { ...x, startAt: startAt.toISOString(), endAt: endAt.toISOString() }
            : x,
        ),
      )
    try {
      await patchEvent(o, { startAt: startAt.toISOString(), endAt: endAt.toISOString() }, scope)
      toast.success(t('calendar.moved'))
    } catch (err) {
      if (prev) qc.setQueryData(key, prev)
      toast.error(
        err instanceof ApiError && err.code === 'CONFLICT_STALE'
          ? t('calendar.stale')
          : t('task.saveFailed'),
      )
    } finally {
      await invalidateCalendar(qc)
    }
  }
  const moveDays = (it: CalItem, n: number) => {
    const o = it.occ
    if (!o) return
    if (o.allDay) {
      const sd = localDateOf(o.timezone, new Date(o.startAt))
      const ed = localDateOf(o.timezone, new Date(o.endAt))
      return reschedule(
        o,
        zonedMidnight(o.timezone, addDays(sd, n)),
        zonedMidnight(o.timezone, addDays(ed, n)),
      )
    }
    const s = localDateTimeOf(tz, new Date(o.startAt))
    const ns = at(tz, addDays(s.date, n), s.minutes)
    const dur = new Date(o.endAt).getTime() - new Date(o.startAt).getTime()
    return reschedule(o, ns, new Date(ns.getTime() + dur))
  }
  const moveTimed = (it: CalItem, dayDelta: number, minuteDelta: number) => {
    const o = it.occ
    if (!o) return
    const s = localDateTimeOf(tz, new Date(o.startAt))
    const ns = at(tz, addDays(s.date, dayDelta), s.minutes + minuteDelta)
    const dur = new Date(o.endAt).getTime() - new Date(o.startAt).getTime()
    return reschedule(o, ns, new Date(ns.getTime() + dur))
  }
  const resize = (it: CalItem, day: LocalDate, endMin: number) => {
    const o = it.occ
    if (!o) return
    const ne = at(tz, day, endMin)
    if (ne.getTime() <= new Date(o.startAt).getTime()) return
    return reschedule(o, new Date(o.startAt), ne)
  }

  useHotkeys({
    t: () => go({ date: today }),
    arrowleft: () => step(-1),
    arrowright: () => step(1),
    d: () => go({ view: 'day', date: anchor }),
    w: () => go({ view: 'week', date: anchor }),
    m: () => go({ view: 'month', date: anchor }),
    y: () => go({ view: 'year', date: anchor }),
    n: newEventNow,
  })

  const display = { lunar: overlay.lunar, holidays: overlay.holidays }
  const loading = occ.isFetching || (withTasks && tq.isFetching)
  const dayItems = view === 'day' ? items.filter((it) => covers(it, dayKey(anchor))) : items

  return (
    <section
      className="flex h-[calc(100dvh-var(--xz-topbar-h)-4.5rem)] min-h-[36rem] flex-col gap-4"
      data-testid="calendar"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="icon"
            onClick={toggleSidebar}
            aria-label={t('calendar.toggleSidebar')}
            aria-pressed={sidebar}
            className="hidden xl:inline-flex"
          >
            <PanelLeft />
          </Button>
          <h1 className="flex items-baseline gap-2" data-testid="cal-title">
            {view === 'year' ? (
              <span className="font-display text-[34px] leading-none tracking-[.06em]">
                {t('calendar.yearName', { y: anchor.y })}
              </span>
            ) : (
              <>
                <span className="font-display text-[34px] leading-none tracking-[.06em]">
                  {view === 'day'
                    ? t('calendar.monthDay', { m: anchor.m, d: anchor.d })
                    : t('calendar.monthName', { m: anchor.m })}
                </span>
                <span className="font-display text-[22px] text-fg-muted leading-none">
                  {view === 'day' ? weekdayName(anchor) : t('calendar.yearName', { y: anchor.y })}
                </span>
              </>
            )}
            {loading ? (
              <span className="ml-2 text-fg-muted text-xs" role="status">
                {t('calendar.loading')}
              </span>
            ) : null}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="inline-flex rounded-lg bg-active p-0.5">
            <legend className="sr-only">{t('calendar.viewLabel')}</legend>
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => go({ view: v, date: anchor })}
                data-testid={`cal-view-${v}`}
                className={cn(
                  'h-8 min-w-11 rounded-md px-3 text-sm transition-[background-color,box-shadow] duration-(--xz-dur-fast)',
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
          <Button variant="primary" size="sm" onClick={newEventNow} data-testid="cal-new">
            <Plus />
            {t('calendar.newEvent')}
          </Button>
        </div>
      </header>

      <div
        className={cn(
          'grid min-h-0 flex-1 gap-5',
          sidebar ? 'xl:grid-cols-[15.5rem_minmax(0,1fr)]' : 'grid-cols-1',
        )}
      >
        {sidebar ? (
          <div className="hidden min-h-0 overflow-y-auto pr-1 xl:block">
            <CalendarSidebar
              calendars={calendars.data ?? []}
              anchor={anchor}
              today={today}
              weekStartsOn={me.weekStartsOn}
              marked={marked}
              overlay={overlay}
              onOverlay={setOverlay}
              onPick={(d) => go({ date: d, view: view === 'year' ? 'day' : view })}
              upcoming={upcoming}
              onOpen={open}
              tz={tz}
            />
          </div>
        ) : null}
        <div className="min-h-0 min-w-0 overflow-y-auto">
          {view === 'month' ? (
            <MonthView
              days={days}
              anchor={anchor}
              today={today}
              items={items}
              tz={tz}
              display={display}
              onPickDay={pickDay}
              onCreateDay={createAllDay}
              onOpen={open}
              onMoveDays={moveDays}
            />
          ) : view === 'year' ? (
            <YearView
              year={anchor.y}
              today={today}
              weekStartsOn={me.weekStartsOn}
              marked={marked}
              holidays={overlay.holidays}
              onPickDay={pickDay}
              onPickMonth={(m) => go({ view: 'month', date: m })}
            />
          ) : view === 'day' ? (
            <div className="grid h-full min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_19rem]">
              <TimeGrid
                days={days}
                today={today}
                tz={tz}
                items={dayItems}
                display={display}
                onCreate={createAt}
                onCreateAllDay={createAllDay}
                onOpen={open}
                onMove={moveTimed}
                onResize={resize}
              />
              <div className="hidden min-h-0 2xl:flex">
                <DayAside day={anchor} items={dayItems} tz={tz} onOpen={open} onNew={newEventNow} />
              </div>
            </div>
          ) : (
            <TimeGrid
              days={days}
              today={today}
              tz={tz}
              items={dayItems}
              display={display}
              onPickDay={view === 'week' ? pickDay : undefined}
              onCreate={createAt}
              onCreateAllDay={createAllDay}
              onOpen={open}
              onMove={moveTimed}
              onResize={resize}
            />
          )}
        </div>
      </div>
      <EventEditor
        target={editor}
        onClose={() => setEditor(null)}
        calendars={calendars.data ?? []}
        tz={tz}
      />
      {scopeEl}
    </section>
  )
}

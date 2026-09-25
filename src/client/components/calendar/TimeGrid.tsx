/**
 * 时间轴（日 / 周视图，REQ-CAL-002 · 003、REQ-UI-031）：表头（星期 + 日期 + 农历 + 休 / 班）、全天行、24 小时网格、当前时间红线。
 * 交互（macOS 同）：
 * - 空白处单击 = 在该半点新建 1 小时日程；按住拖动 = 框选时段新建（15 分钟吸附）
 * - 拖动日程块 = 改期（可跨列换日）；拖底边 = 改结束时间；单击 = 打开编辑器；任务只可点开
 * - 全天行空白处单击 = 新建全天日程
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, type LocalDate, localDateTimeOf, sameLocalDate } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { weekdayName } from './MonthView.tsx'
import {
  type CalItem,
  covers,
  dayKey,
  hhmm,
  keyToDate,
  layoutLanes,
  MIN_PER_DAY,
  SNAP,
  segmentOf,
  snap,
  sortItems,
} from './model.ts'
import {
  BLOCK,
  type DisplayOpts,
  HolidayBadge,
  ItemChip,
  isOffDay,
  LunarCaption,
} from './parts.tsx'
import { useRangeSelect } from './useRangeSelect.ts'

export const HOUR = 48
const HOUR_MARKS = Array.from({ length: 23 }, (_, i) => i + 1)
const GUTTER = 56 // 3.5rem

type Drag =
  | { kind: 'create'; col: number; a: number; b: number; moved: boolean }
  | {
      kind: 'move'
      item: CalItem
      col0: number
      col: number
      grab: number
      from0: number
      from: number
      dur: number
      moved: boolean
      /** 任务 / 跨日项：只可点开，不可拖 */
      locked?: boolean
    }
  | { kind: 'resize'; item: CalItem; col: number; from: number; to: number; moved: boolean }

export function TimeGrid({
  days,
  today,
  tz,
  items,
  display,
  onPickDay,
  onCreate,
  onCreateAllDay,
  onOpen,
  onMove,
  onResize,
}: {
  days: LocalDate[]
  today: LocalDate
  tz: string
  items: CalItem[]
  display: DisplayOpts
  onPickDay?: (d: LocalDate) => void
  onCreate: (d: LocalDate, from: number, to: number) => void
  onCreateAllDay: (d: LocalDate, to?: LocalDate) => void
  onOpen: (it: CalItem) => void
  /** 改期：dayDelta 天 + 新的当日开始分钟 */
  onMove: (it: CalItem, dayDelta: number, minuteDelta: number) => void
  onResize: (it: CalItem, day: LocalDate, endMinute: number) => void
}) {
  const { t } = useTranslation()
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const [nowMin, setNowMin] = useState(() => localDateTimeOf(tz, new Date()).minutes)
  useEffect(() => {
    const id = setInterval(() => setNowMin(localDateTimeOf(tz, new Date()).minutes), 60_000)
    return () => clearInterval(id)
  }, [tz])
  const keys = days.map(dayKey)
  const range = useRangeSelect((a, b) => onCreateAllDay(keyToDate(a), keyToDate(b)))
  const sorted = [...items].sort(sortItems)
  // 初始滚到 08:00；本段有更早的定时日程时上移到其前半小时（每换一段只调整一次）
  const scrolledFor = useRef('')
  const rangeKey = keys.join()
  const earliest = sorted.reduce((m, it) => {
    if (it.allDay || it.startDay !== it.endDay) return m
    return Math.min(m, ...keys.filter((k) => covers(it, k)).map((k) => segmentOf(it, k, tz).from))
  }, 8 * 60)
  useEffect(() => {
    if (!scroller.current) return
    const target = (Math.max(0, earliest - 30) / 60) * HOUR - 12
    if (scrolledFor.current !== rangeKey || scroller.current.scrollTop > target + 1) {
      scroller.current.scrollTop = Math.max(0, target)
      scrolledFor.current = rangeKey
    }
  }, [rangeKey, earliest])
  const isBlock = (it: CalItem) => it.allDay || it.startDay !== it.endDay
  const allDay = keys.map((k) => sorted.filter((it) => isBlock(it) && covers(it, k)))
  const timed = keys.map((k) => {
    const list = sorted.filter((it) => !isBlock(it) && covers(it, k))
    const segs = list.map((it) => segmentOf(it, k, tz))
    return { list, segs, lanes: layoutLanes(segs) }
  })
  const todayIdx = days.findIndex((d) => sameLocalDate(d, today))
  const cols = days.length

  const pointAt = (e: { clientX: number; clientY: number }) => {
    const r = grid.current?.getBoundingClientRect()
    if (!r) return { col: 0, min: 0 }
    const colW = (r.width - GUTTER) / cols
    const col = Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - r.left - GUTTER) / colW)))
    const min = Math.min(MIN_PER_DAY, Math.max(0, ((e.clientY - r.top) / HOUR) * 60))
    return { col, min }
  }

  // 拖动期间在 window 上跟踪指针（回调经 ref 取最新值，只在拖动开始 / 结束时重挂）
  const latest = useRef({ days, onCreate, onOpen, onMove, onResize, pointAt })
  latest.current = { days, onCreate, onOpen, onMove, onResize, pointAt }
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const { pointAt, days, onCreate, onOpen, onMove, onResize } = {
      ...latest.current,
      pointAt: (e: PointerEvent) => latest.current.pointAt(e),
    }
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const p = pointAt(e)
      if (d.kind === 'create') {
        const b = snap(p.min)
        setDrag({ ...d, b, moved: d.moved || Math.abs(b - d.a) >= SNAP })
      } else if (d.kind === 'move') {
        if (d.locked) return
        const from = Math.min(MIN_PER_DAY - SNAP, Math.max(0, snap(p.min - d.grab)))
        setDrag({ ...d, col: p.col, from, moved: d.moved || from !== d.from0 || p.col !== d.col0 })
      } else {
        const to = Math.max(d.from + SNAP, Math.min(MIN_PER_DAY, snap(p.min)))
        setDrag({ ...d, to, moved: true })
      }
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      const day = days[d.kind === 'create' ? d.col : d.col] as LocalDate
      if (d.kind === 'create') {
        if (!d.moved) {
          const from = Math.floor(d.a / 30) * 30
          onCreate(day, from, Math.min(MIN_PER_DAY, from + 60))
        } else onCreate(day, Math.min(d.a, d.b), Math.max(d.a, d.b))
      } else if (d.kind === 'move') {
        if (!d.moved) onOpen(d.item)
        else onMove(d.item, d.col - d.col0, d.from - d.from0)
      } else if (d.moved) onResize(d.item, day, d.to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging])

  const gridCols = { gridTemplateColumns: `${GUTTER}px repeat(${cols}, minmax(0, 1fr))` }

  return (
    <div
      className="paper flex h-full min-h-[32rem] flex-col overflow-hidden rounded-xl"
      data-testid={cols === 1 ? 'cal-day-view' : 'cal-week'}
    >
      {/* 表头 */}
      <div className="grid border-divider border-b" style={gridCols}>
        <div />
        {days.map((d, i) => {
          const isToday = i === todayIdx
          const off = display.holidays && isOffDay(d)
          return (
            <button
              type="button"
              key={keys[i]}
              onClick={() => onPickDay?.(d)}
              disabled={!onPickDay}
              className="flex flex-col items-center gap-0.5 py-2 enabled:hover:bg-hover"
              data-testid="cal-col-head"
            >
              <span className="flex flex-col items-center sm:flex-row sm:items-baseline sm:gap-1.5">
                <span
                  className={cn(
                    'text-xs',
                    isToday ? 'text-primary-text' : off ? 'text-primary-text/80' : 'text-fg-muted',
                  )}
                >
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
              </span>
              <span className="hidden h-4 items-center gap-1 sm:flex">
                {display.holidays ? <HolidayBadge d={d} /> : null}
                {display.lunar ? <LunarCaption d={d} /> : null}
              </span>
            </button>
          )
        })}
      </div>
      {/* 全天行 */}
      <div className="grid border-divider border-b bg-surface-2/50" style={gridCols}>
        <div className="self-center pr-2 text-right text-[11px] text-fg-muted">
          {t('calendar.allDay')}
        </div>
        {allDay.map((list, i) => (
          // 全天行空白处单击新建全天日程、按住横拖多日新建跨日全天日程（鼠标快捷方式，键盘用「新建日程」/ n）
          // biome-ignore lint/a11y/noStaticElementInteractions: 同上
          // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
          <div
            key={keys[i]}
            onPointerDown={(e) => range.start(e, keys[i] as string)}
            onClick={() => {
              if (!range.consumeClick()) onCreateAllDay(days[i] as LocalDate)
            }}
            className={cn(
              'flex min-h-9 min-w-0 select-none flex-col gap-0.5 border-divider border-l p-1',
              range.covers(keys[i] as string) && 'bg-primary-soft',
            )}
            data-testid="cal-allday"
            data-date={keys[i]}
            data-range-key={keys[i]}
          >
            {list.map((it) => (
              <ItemChip key={it.key} item={it} tz={tz} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
      {/* 时间轴 */}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-testid="cal-timeline"
      >
        <div
          ref={grid}
          className={cn('relative grid select-none', drag && 'cursor-grabbing')}
          style={{ ...gridCols, height: 24 * HOUR }}
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
          {timed.map(({ list, segs, lanes }, i) => (
            <div
              key={keys[i]}
              className={cn(
                'relative border-divider border-l bg-[linear-gradient(to_bottom,var(--xz-divider)_1px,transparent_1px)]',
                display.holidays && isOffDay(days[i] as LocalDate) && 'bg-surface-2/30',
              )}
              style={{ backgroundSize: `100% ${HOUR}px` }}
              data-testid="cal-col"
              data-date={keys[i]}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target !== e.currentTarget) return
                const p = pointAt(e)
                const a = snap(p.min)
                setDrag({ kind: 'create', col: i, a, b: a + SNAP * 4, moved: false })
              }}
            >
              {list.map((it, k) => {
                const seg = segs[k] as { from: number; to: number }
                const { lane, lanes: n } = lanes[k] ?? { lane: 0, lanes: 1 }
                const dragging = drag && drag.kind !== 'create' && drag.item.key === it.key
                const canDrag = it.source === 'event' && it.startDay === it.endDay
                return (
                  <button
                    key={it.key}
                    type="button"
                    data-testid="cal-event"
                    data-source={it.source}
                    data-event-id={it.occ?.id}
                    data-task-id={it.task?.id}
                    title={`${it.title} ${hhmm(seg.from)}–${hhmm(seg.to)}`}
                    onClick={(e) => {
                      // 键盘触发（detail = 0）；鼠标由 pointer 流程处理
                      if (e.detail === 0) onOpen(it)
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      if (!canDrag) {
                        setDrag({
                          kind: 'move',
                          item: it,
                          col0: i,
                          col: i,
                          grab: 0,
                          from0: seg.from,
                          from: seg.from,
                          dur: seg.to - seg.from,
                          moved: false,
                          locked: true,
                        })
                        return
                      }
                      const p = pointAt(e)
                      const resize = (e.target as HTMLElement).dataset.handle === 'resize'
                      setDrag(
                        resize
                          ? {
                              kind: 'resize',
                              item: it,
                              col: i,
                              from: seg.from,
                              to: seg.to,
                              moved: false,
                            }
                          : {
                              kind: 'move',
                              item: it,
                              col0: i,
                              col: i,
                              grab: p.min - seg.from,
                              from0: seg.from,
                              from: seg.from,
                              dur: seg.to - seg.from,
                              moved: false,
                            },
                      )
                    }}
                    className={cn(
                      'absolute flex min-w-0 touch-none flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-(--xz-shadow-soft) hover:brightness-95',
                      BLOCK[it.color],
                      it.source === 'task' && 'border-dashed',
                      it.done && 'line-through opacity-60',
                      dragging && 'opacity-40',
                      canDrag && 'cursor-grab',
                    )}
                    style={{
                      top: (seg.from / 60) * HOUR + 1,
                      height: Math.max(18, ((seg.to - seg.from) / 60) * HOUR - 2),
                      left: `calc(${(lane / n) * 100}% + 2px)`,
                      width: `calc(${100 / n}% - 4px)`,
                    }}
                  >
                    <span className="block w-full truncate font-medium leading-4">{it.title}</span>
                    {seg.to - seg.from >= 45 && n < 3 ? (
                      <span className="block w-full truncate leading-4 tabular-nums opacity-80">
                        {hhmm(seg.from)}–{hhmm(seg.to)}
                        {it.occ?.location ? ` · ${it.occ.location}` : ''}
                      </span>
                    ) : null}
                    {canDrag ? (
                      <span
                        data-handle="resize"
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      />
                    ) : null}
                  </button>
                )
              })}
              {/* 拖动预览 */}
              {drag?.kind === 'create' && drag.col === i ? (
                <Ghost
                  from={Math.min(drag.a, drag.b)}
                  to={Math.max(drag.a, drag.b, Math.min(drag.a, drag.b) + SNAP)}
                  label={t('calendar.newEvent')}
                />
              ) : null}
              {drag?.kind === 'move' && drag.moved && drag.col === i ? (
                <Ghost
                  from={drag.from}
                  to={Math.min(MIN_PER_DAY, drag.from + drag.dur)}
                  label={drag.item.title}
                  color={drag.item.color}
                />
              ) : null}
              {drag?.kind === 'resize' && drag.col === i ? (
                <Ghost
                  from={drag.from}
                  to={drag.to}
                  label={drag.item.title}
                  color={drag.item.color}
                />
              ) : null}
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

function Ghost({
  from,
  to,
  label,
  color = 'blue',
}: {
  from: number
  to: number
  label: string
  color?: CalItem['color']
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0.5 z-20 flex flex-col rounded-md border-2 border-dashed px-1.5 py-0.5 text-xs shadow-(--xz-shadow-float)',
        BLOCK[color],
      )}
      style={{ top: (from / 60) * HOUR, height: Math.max(18, ((to - from) / 60) * HOUR) }}
      data-testid="cal-ghost"
    >
      <span className="truncate font-medium">{label}</span>
      <span className="tabular-nums opacity-80">
        {hhmm(from)}–{hhmm(to)}
      </span>
    </div>
  )
}

export const nextDays = (d: LocalDate, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(d, i))

/**
 * 月视图（REQ-CAL-002 · 003 · 007 · 015、REQ-UI-031）：6×7；日期号右上 + 农历小字 + 休 / 班角标；
 * 点格子空白处 = 在该日新建全天日程；按住拖过多日 = 新建跨这些日的全天日程（REQ-CAL-010）；
 * 点日期号 = 切到日视图；日程可拖到别的日期（任务不可拖）。
 * 连续条（ADR-0057，仿 macOS）：每周一行是一个网格——格子（背景、点击、拖选、放置）铺满整列，
 * 日程按 layoutBars 排成行，跨多日的用 grid-column 横跨多列连成一条；跨周时在周末 / 周初那端画成直角。
 * 每格最多 3 行，放不下的在该列显示「还有 N 项」。拖放按落点所在列算日期（落在日程条上也算）。
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dayOfWeek, type LocalDate, sameLocalDate } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { type CalItem, dayKey, keyToDate, layoutBars } from './model.ts'
import { type DisplayOpts, HolidayBadge, ItemChip, isOffDay, LunarCaption } from './parts.tsx'
import { useRangeSelect } from './useRangeSelect.ts'

const weekdayFmt = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' })
export const weekdayName = (d: LocalDate) =>
  weekdayFmt.format(new Date(Date.UTC(d.y, d.m - 1, d.d)))

const dayDiff = (a: string, b: string) => {
  const x = keyToDate(a)
  const y = keyToDate(b)
  return Math.round((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(y.y, y.m - 1, y.d)) / 86_400_000)
}

/** 每格最多显示的行数 */
const MAX = 3
/** 日期行高（第一行；日期号 h-6 + 上边距） */
const HEAD = '1.875rem'

export function MonthView({
  days,
  anchor,
  today,
  items,
  tz,
  display,
  onPickDay,
  onCreateDay,
  onOpen,
  onMoveDays,
}: {
  days: LocalDate[]
  anchor: LocalDate
  today: LocalDate
  items: CalItem[]
  tz: string
  display: DisplayOpts
  onPickDay: (d: LocalDate) => void
  onCreateDay: (d: LocalDate, to?: LocalDate) => void
  onOpen: (it: CalItem) => void
  onMoveDays: (it: CalItem, days: number) => void
}) {
  const { t } = useTranslation()
  const drag = useRef<{ item: CalItem; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const range = useRangeSelect((a, b) => onCreateDay(keyToDate(a), keyToDate(b)))
  const weeks: LocalDate[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  /** 指针所在列的日期（拖放用：落在日程条上也能算出日期） */
  const keyAt = (e: React.DragEvent<HTMLElement>, keys: string[]) => {
    const r = e.currentTarget.getBoundingClientRect()
    const c = Math.floor(((e.clientX - r.left) / r.width) * keys.length)
    return keys[Math.min(keys.length - 1, Math.max(0, c))] as string
  }

  return (
    <div
      className="paper flex h-full min-h-[36rem] flex-col overflow-hidden rounded-xl"
      data-testid="cal-month"
    >
      <div className="grid grid-cols-7 border-divider border-b" aria-hidden>
        {days.slice(0, 7).map((d) => (
          <div
            key={dayKey(d)}
            className="px-3 py-2 text-right text-fg-muted text-xs tracking-[.08em]"
          >
            {weekdayName(d)}
          </div>
        ))}
      </div>
      <div className="grid flex-1 select-none auto-rows-fr">
        {weeks.map((wk, w) => {
          const keys = wk.map(dayKey)
          const bars = layoutBars(items, keys)
          const lanes = Math.min(
            MAX,
            bars.reduce((m, b) => Math.max(m, b.lane + 1), 0),
          )
          const hidden = keys.map(
            (_, c) => bars.filter((b) => b.lane >= MAX && b.c0 <= c && b.c1 >= c).length,
          )
          const anyMore = hidden.some(Boolean)
          return (
            // 一周一行：拖放目标（鼠标拖动日程改期；键盘改期走快速编辑 / 编辑器）
            // biome-ignore lint/a11y/noStaticElementInteractions: 同上
            <div
              key={keys[0]}
              className={cn(
                'grid min-h-20 min-w-0 grid-cols-7 gap-y-0.5 pb-1 sm:min-h-24',
                w < weeks.length - 1 && 'border-divider border-b',
              )}
              style={{
                gridTemplateRows: `${HEAD}${' auto'.repeat(lanes + (anyMore ? 1 : 0))} minmax(0, 1fr)`,
              }}
              data-testid="cal-week"
              onDragOver={(e) => {
                if (!drag.current) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOver(keyAt(e, keys))
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const dr = drag.current
                drag.current = null
                if (!dr) return
                const delta = dayDiff(keyAt(e, keys), dr.from)
                if (delta) onMoveDays(dr.item, delta)
              }}
            >
              {wk.map((d, i) => {
                const key = keys[i] as string
                const inMonth = d.m === anchor.m
                const isToday = sameLocalDate(d, today)
                const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6
                const off = display.holidays && isOffDay(d)
                return (
                  // 格子铺满整列（背景 / 点击 / 拖选），顶部是日期行（高 = 第一行 HEAD）；日程条是兄弟网格项，压在格子上
                  // 格子空白处单击新建是鼠标快捷方式；键盘用页头「新建日程」/ n
                  // biome-ignore lint/a11y/noStaticElementInteractions: 同上
                  // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
                  <div
                    key={key}
                    data-testid="cal-day"
                    data-date={key}
                    data-range-key={key}
                    data-selecting={range.covers(key) || undefined}
                    onPointerDown={(e) => range.start(e, key)}
                    onClick={() => {
                      if (!range.consumeClick()) onCreateDay(d)
                    }}
                    style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                    className={cn(
                      'min-w-0 cursor-default border-divider',
                      i < 6 && 'border-r',
                      !inMonth && 'bg-surface-2/60',
                      inMonth && (weekend || off) && !isToday && 'bg-surface-2/25',
                      isToday && 'bg-selected/60',
                      over === key && 'bg-primary-soft/70 ring-2 ring-primary/40 ring-inset',
                      range.covers(key) && 'bg-primary-soft',
                    )}
                  >
                    <div
                      className="flex min-w-0 items-center gap-1 px-1 pt-1.5 sm:px-1.5"
                      style={{ height: HEAD }}
                    >
                      {display.holidays ? (
                        <HolidayBadge d={d} className="hidden sm:inline-flex" />
                      ) : null}
                      {display.lunar ? (
                        <LunarCaption d={d} className="hidden min-w-0 pl-0.5 sm:inline" />
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onPickDay(d)
                        }}
                        aria-label={t('calendar.openDay', { date: `${d.m}/${d.d}` })}
                        className={cn(
                          'ml-auto inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[13px] tabular-nums hover:bg-hover',
                          isToday && 'bg-primary font-semibold text-primary-fg hover:bg-primary',
                          !isToday && !inMonth && 'text-fg-faint',
                          !isToday && inMonth && (weekend || off) && 'text-fg-muted',
                        )}
                        aria-current={isToday ? 'date' : undefined}
                      >
                        {d.d === 1 ? (
                          <>
                            <span className="hidden sm:inline">
                              {t('calendar.monthDay', { m: d.m, d: d.d })}
                            </span>
                            <span className="sm:hidden">{d.d}</span>
                          </>
                        ) : (
                          d.d
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
              {bars
                .filter((b) => b.lane < MAX)
                .map((b) => (
                  <ItemChip
                    key={b.item.key}
                    item={b.item}
                    tz={tz}
                    onOpen={onOpen}
                    bar={{ days: keys.slice(b.c0, b.c1 + 1), contL: b.contL, contR: b.contR }}
                    style={{ gridColumn: `${b.c0 + 1} / ${b.c1 + 2}`, gridRow: b.lane + 2 }}
                    draggable
                    onDragStart={(e) => {
                      // 抓住的是条上的哪一天：拖放的偏移按它算
                      const r = e.currentTarget.getBoundingClientRect()
                      const span = b.c1 - b.c0 + 1
                      const idx = Math.min(
                        span - 1,
                        Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * span)),
                      )
                      drag.current = { item: b.item, from: keys[b.c0 + idx] as string }
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', b.item.title)
                    }}
                    onDragEnd={() => {
                      drag.current = null
                      setOver(null)
                    }}
                    className={cn(
                      'relative z-[1] w-auto py-0.5',
                      b.contL ? 'ms-0' : 'ms-1 sm:ms-1.5',
                      b.contR ? 'me-0' : 'me-1 sm:me-1.5',
                    )}
                  />
                ))}
              {hidden.map((n, c) =>
                n ? (
                  <button
                    key={`more${keys[c]}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPickDay(wk[c] as LocalDate)
                    }}
                    style={{ gridColumn: c + 1, gridRow: lanes + 2 }}
                    className="relative z-[1] mx-1 min-h-6 rounded-md px-1.5 text-left text-fg-muted text-xs hover:bg-hover hover:text-fg sm:mx-1.5"
                    data-testid="cal-more"
                    data-date={keys[c]}
                  >
                    {t('calendar.more', { count: n })}
                  </button>
                ) : null,
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

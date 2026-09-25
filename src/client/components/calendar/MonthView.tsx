/**
 * 月视图（REQ-CAL-002 · 003 · 007、REQ-UI-031）：6×7；日期号右上 + 农历小字 + 休 / 班角标；
 * 点格子空白处 = 在该日新建全天日程；点日期号 = 切到日视图；日程可拖到别的日期（任务不可拖）。
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dayOfWeek, type LocalDate, sameLocalDate } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { type CalItem, covers, dayKey, keyToDate, sortItems } from './model.ts'
import { type DisplayOpts, HolidayBadge, ItemChip, isOffDay, LunarCaption } from './parts.tsx'

const weekdayFmt = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' })
export const weekdayName = (d: LocalDate) =>
  weekdayFmt.format(new Date(Date.UTC(d.y, d.m - 1, d.d)))

const dayDiff = (a: string, b: string) => {
  const x = keyToDate(a)
  const y = keyToDate(b)
  return Math.round((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(y.y, y.m - 1, y.d)) / 86_400_000)
}

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
  onCreateDay: (d: LocalDate) => void
  onOpen: (it: CalItem) => void
  onMoveDays: (it: CalItem, days: number) => void
}) {
  const { t } = useTranslation()
  const MAX = 3
  const drag = useRef<{ item: CalItem; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const sorted = [...items].sort(sortItems)
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
      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {days.map((d, i) => {
          const key = dayKey(d)
          const list = sorted.filter((it) => covers(it, key))
          const inMonth = d.m === anchor.m
          const isToday = sameLocalDate(d, today)
          const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6
          const off = display.holidays && isOffDay(d)
          return (
            // 格子空白处单击新建是鼠标快捷方式；键盘用页头「新建日程」/ n（格内含按钮，不能整体做成 button）
            // biome-ignore lint/a11y/noStaticElementInteractions: 同上
            // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
            <div
              key={key}
              data-testid="cal-day"
              data-date={key}
              onClick={() => onCreateDay(d)}
              onDragOver={(e) => {
                if (!drag.current) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOver(key)
              }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const dr = drag.current
                drag.current = null
                if (!dr) return
                const delta = dayDiff(key, dr.from)
                if (delta) onMoveDays(dr.item, delta)
              }}
              className={cn(
                'group/day flex min-h-20 min-w-0 cursor-default flex-col gap-0.5 overflow-hidden border-divider p-1 sm:min-h-24 sm:p-1.5',
                i % 7 !== 6 && 'border-r',
                i < 35 && 'border-b',
                !inMonth && 'bg-surface-2/60',
                inMonth && (weekend || off) && !isToday && 'bg-surface-2/25',
                isToday && 'bg-selected/60',
                over === key && 'bg-primary-soft/70 ring-2 ring-primary/40 ring-inset',
              )}
            >
              <div className="flex items-center gap-1">
                {display.holidays ? <HolidayBadge d={d} className="hidden sm:inline-flex" /> : null}
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
              {list.slice(0, MAX).map((it) => (
                <ItemChip
                  key={it.key}
                  item={it}
                  tz={tz}
                  onOpen={onOpen}
                  draggable={it.source === 'event'}
                  onDragStart={(e) => {
                    drag.current = { item: it, from: key }
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', it.title)
                  }}
                  onDragEnd={() => {
                    drag.current = null
                    setOver(null)
                  }}
                  className="py-0.5"
                />
              ))}
              {list.length > MAX ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPickDay(d)
                  }}
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

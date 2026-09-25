/**
 * 日视图右栏（macOS 日视图的详情栏，REQ-CAL-009）：大号日期 + 星期、农历全称与干支年、节假日说明、当日日程清单、新建。
 */
import { CalendarPlus, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dayMeta } from '../../../shared/cn-days.ts'
import type { LocalDate } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { weekdayName } from './MonthView.tsx'
import { type CalItem, covers, dayKey, hhmm, segmentOf, sortItems } from './model.ts'
import { DOT } from './parts.tsx'

export function DayAside({
  day,
  items,
  tz,
  onOpen,
  onNew,
}: {
  day: LocalDate
  items: CalItem[]
  tz: string
  onOpen: (it: CalItem) => void
  onNew: () => void
}) {
  const { t } = useTranslation()
  const k = dayKey(day)
  const meta = dayMeta(day)
  const list = items.filter((it) => covers(it, k)).sort(sortItems)
  return (
    <aside
      className="paper flex min-h-0 w-full flex-col gap-4 overflow-y-auto rounded-xl p-5"
      data-testid="cal-day-aside"
    >
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-5xl tabular-nums leading-none">{day.d}</span>
          <span className="text-fg-muted">{weekdayName(day)}</span>
        </div>
        {meta.lunarFull ? (
          <p className="mt-2 text-fg-muted text-sm">
            {t('calendar.lunarLine', { year: meta.yearName ?? '', date: meta.lunarFull })}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
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
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs">{meta.festival}</span>
          ) : null}
          {meta.term ? (
            <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs">{meta.term}</span>
          ) : null}
        </div>
      </div>
      <div className="h-px bg-divider" />
      {list.length ? (
        <ul className="flex flex-col gap-1">
          {list.map((it) => {
            const block = it.allDay || it.startDay !== it.endDay
            const seg = block ? null : segmentOf(it, k, tz)
            return (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => onOpen(it)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover"
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2.5 shrink-0',
                      it.source === 'task' ? 'rounded-[3px]' : 'rounded-full',
                      DOT[it.color],
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate font-medium text-sm',
                        it.done && 'line-through opacity-60',
                      )}
                    >
                      {it.title}
                    </span>
                    <span className="block text-fg-muted text-xs tabular-nums">
                      {seg ? `${hhmm(seg.from)} – ${hhmm(seg.to)}` : t('calendar.allDay')}
                      {it.source === 'task' ? ` · ${t('calendar.taskKind')}` : ''}
                    </span>
                    {it.occ?.location ? (
                      <span className="mt-0.5 flex items-center gap-1 text-fg-muted text-xs">
                        <MapPin className="size-3" aria-hidden />
                        <span className="truncate">{it.occ.location}</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-fg-muted text-sm">{t('calendar.dayEmpty')}</p>
      )}
      <Button variant="ghost" size="sm" className="mt-auto self-start" onClick={onNew}>
        <CalendarPlus />
        {t('calendar.newEvent')}
      </Button>
    </aside>
  )
}

/**
 * 小月历（侧栏导航与年视图共用，REQ-CAL-007 · 009）：按 weekStartsOn 6×7；今天实心圆、选中描边、
 * 法定假日淡翡翠底、调休上班角点、有日程的日期下方小点。
 */
import { useTranslation } from 'react-i18next'
import { dayMeta } from '../../../shared/cn-days.ts'
import { addDays, dayOfWeek, type LocalDate, sameLocalDate, weekDays } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { dayKey } from './model.ts'

const narrow = new Intl.DateTimeFormat('zh-CN', { weekday: 'narrow', timeZone: 'UTC' })

export function MiniMonth({
  month,
  weekStartsOn,
  today,
  selected,
  marked,
  holidays = true,
  onPick,
  compact,
  header,
}: {
  month: LocalDate
  weekStartsOn: number
  today: LocalDate
  selected?: LocalDate | null
  marked?: Set<string>
  holidays?: boolean
  onPick: (d: LocalDate) => void
  compact?: boolean
  header?: React.ReactNode
}) {
  const { t } = useTranslation()
  const first = weekDays(weekStartsOn, { y: month.y, m: month.m, d: 1 })[0] as LocalDate
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="cal-mini"
      data-month={`${month.y}-${month.m}`}
    >
      {header}
      <div className="grid grid-cols-7 text-center text-[10px] text-fg-muted" aria-hidden>
        {days.slice(0, 7).map((d) => (
          <span key={dayKey(d)}>{narrow.format(new Date(Date.UTC(d.y, d.m - 1, d.d)))}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d) => {
          const inMonth = d.m === month.m
          const isToday = sameLocalDate(d, today)
          const isSel = !!selected && sameLocalDate(d, selected)
          const meta = holidays ? dayMeta(d) : null
          const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6
          const has = marked?.has(dayKey(d))
          return (
            <button
              key={dayKey(d)}
              type="button"
              onClick={() => onPick(d)}
              aria-label={t('calendar.openDay', { date: `${d.m}/${d.d}` })}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'relative mx-auto inline-flex items-center justify-center rounded-full tabular-nums transition-colors hover:bg-hover',
                compact ? 'size-6 text-[11px]' : 'size-7 text-xs',
                !inMonth && 'invisible',
                meta?.off && !isToday && 'bg-primary-soft/70 text-primary-text',
                !meta?.off && weekend && !isToday && 'text-fg-muted',
                isSel && !isToday && 'ring-1 ring-primary',
                isToday && 'bg-primary font-semibold text-primary-fg hover:bg-primary',
              )}
            >
              {d.d}
              {meta?.work && inMonth ? (
                <span
                  className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning"
                  aria-hidden
                />
              ) : null}
              {has && inMonth ? (
                <span
                  className={cn(
                    'absolute bottom-0.5 size-1 rounded-full',
                    isToday ? 'bg-primary-fg' : 'bg-primary-text',
                  )}
                  aria-hidden
                />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 年视图（REQ-CAL-009）：12 个小月历，假日着色、调休角点、有日程打点；点日期进入日视图。 */
import { useTranslation } from 'react-i18next'
import type { LocalDate } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { MiniMonth } from './MiniMonth.tsx'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export function YearView({
  year,
  today,
  weekStartsOn,
  marked,
  holidays,
  onPickDay,
  onPickMonth,
}: {
  year: number
  today: LocalDate
  weekStartsOn: number
  marked: Set<string>
  holidays: boolean
  onPickDay: (d: LocalDate) => void
  onPickMonth: (m: LocalDate) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="paper grid grid-cols-1 gap-x-6 gap-y-5 rounded-xl p-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      data-testid="cal-year"
    >
      {MONTHS.map((m) => {
        const month = { y: year, m, d: 1 }
        const current = today.y === year && today.m === m
        return (
          <MiniMonth
            key={m}
            month={month}
            weekStartsOn={weekStartsOn}
            today={today}
            marked={marked}
            holidays={holidays}
            onPick={onPickDay}
            header={
              <button
                type="button"
                onClick={() => onPickMonth(month)}
                className={cn(
                  'mb-1 self-start rounded-md px-1 text-left font-display text-lg hover:bg-hover',
                  current && 'text-primary-text',
                )}
              >
                {t('calendar.monthName', { m })}
              </button>
            }
          />
        )
      })}
    </div>
  )
}

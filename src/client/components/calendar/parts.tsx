/** 日历共用小件：色板类、事件条、节假日角标、农历小字（ADR-0009、REQ-CAL-007）。 */
import { Repeat } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dayCaption, dayMeta } from '../../../shared/cn-days.ts'
import type { LocalDate } from '../../../shared/tz.ts'
import { cn } from '../../lib/cn.ts'
import { PALETTE_DOT } from '../domain/SpaceIcon.tsx'
import { type CalItem, hhmm, type PaletteName } from './model.ts'

export const BLOCK: Record<PaletteName, string> = {
  moss: 'bg-moss-bg text-moss-fg border-moss-fg',
  amber: 'bg-amber-bg text-amber-fg border-amber-fg',
  indigo: 'bg-indigo-bg text-indigo-fg border-indigo-fg',
  ochre: 'bg-ochre-bg text-ochre-fg border-ochre-fg',
  teal: 'bg-teal-bg text-teal-fg border-teal-fg',
  plum: 'bg-plum-bg text-plum-fg border-plum-fg',
  gray: 'bg-gray-bg text-gray-fg border-gray-fg',
  pine: 'bg-pine-bg text-pine-fg border-pine-fg',
}
export const DOT = PALETTE_DOT
export const TEXT: Record<PaletteName, string> = {
  moss: 'text-moss-fg',
  amber: 'text-amber-fg',
  indigo: 'text-indigo-fg',
  ochre: 'text-ochre-fg',
  teal: 'text-teal-fg',
  plum: 'text-plum-fg',
  gray: 'text-gray-fg',
  pine: 'text-pine-fg',
}

export interface DisplayOpts {
  lunar: boolean
  holidays: boolean
}

/** 月格 / 全天行里的一条（全天与多日为色块，定时为「色点 + 标题 + 时间」）。 */
export function ItemChip({
  item,
  tz,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  className,
}: {
  item: CalItem
  tz: string
  onOpen: (it: CalItem) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const block = item.allDay || item.startDay !== item.endDay
  const time = block ? t('calendar.allDay') : hhmm(minutesOf(item.start, tz))
  const label = t('calendar.eventLabel', {
    title: item.title,
    time,
    kind: item.source === 'task' ? t('calendar.taskKind') : t('calendar.eventKind'),
  })
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(item)
      }}
      title={label}
      aria-label={label}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid="cal-event"
      data-source={item.source}
      data-task-id={item.task?.id}
      data-event-id={item.occ?.id}
      className={cn(
        'flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs leading-5 transition-[filter,background-color] duration-(--xz-dur-fast)',
        block ? cn(BLOCK[item.color], 'font-medium hover:brightness-95') : 'hover:bg-hover',
        item.source === 'task' && block && 'border border-current/25 border-dashed bg-transparent',
        item.done && 'line-through opacity-60',
        className,
      )}
    >
      {block ? null : (
        <span
          className={cn(
            'size-2 shrink-0',
            item.source === 'task'
              ? 'rounded-[3px] border-2 border-current bg-transparent'
              : 'rounded-full',
            item.source === 'task' ? TEXT[item.color] : DOT[item.color],
          )}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.occ?.recurring ? (
        <Repeat className="hidden size-3 shrink-0 opacity-60 sm:block" aria-hidden />
      ) : null}
      {block ? null : (
        <span className="hidden shrink-0 text-fg-muted tabular-nums sm:inline">{time}</span>
      )}
    </button>
  )
}

const minutesOf = (d: Date, tz: string) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d)
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0)
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

/** 「休 / 班」角标。 */
export function HolidayBadge({ d, className }: { d: LocalDate; className?: string }) {
  const { t } = useTranslation()
  const m = dayMeta(d)
  if (!m.off && !m.work) return null
  return (
    <span
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] font-medium text-[10px] leading-none',
        m.off ? 'bg-primary-soft text-primary-text' : 'bg-warning-soft text-fg',
        className,
      )}
      title={
        m.off
          ? t('calendar.holidayOff', { name: m.off })
          : t('calendar.holidayWork', { name: m.work })
      }
      data-testid={m.off ? 'cal-off' : 'cal-work'}
    >
      {m.off ? t('calendar.off') : t('calendar.work')}
    </span>
  )
}

/** 农历 / 节日 / 节气小字。 */
export function LunarCaption({ d, className }: { d: LocalDate; className?: string }) {
  const { t } = useTranslation()
  const c = dayCaption(dayMeta(d))
  if (!c.text) return null
  return (
    <span
      className={cn(
        'truncate text-[11px] leading-none',
        c.accent ? 'text-primary-text' : 'text-fg-faint',
        className,
      )}
      data-testid="cal-lunar"
    >
      {c.leap ? t('calendar.leap', { m: c.text }) : c.text}
    </span>
  )
}

export const isOffDay = (d: LocalDate) => !!dayMeta(d).off

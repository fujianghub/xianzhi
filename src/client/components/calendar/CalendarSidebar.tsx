/**
 * 日历侧栏（macOS 左栏，REQ-CAL-001 · 007 · 009）：小月历导航；「我的日历」列表（勾选显示 / 隐藏、改名改色、删除、新建）；
 * 叠加显示：任务、农历、节假日（本机偏好）；接下来 7 天的日程。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PALETTE_COLORS, type PaletteColor } from '../../../shared/schemas/enums.ts'
import { addMonths, type LocalDate } from '../../../shared/tz.ts'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import type { CalendarView } from '../../lib/calendar-queries.ts'
import { cn } from '../../lib/cn.ts'
import { newId } from '../../lib/uuid.ts'
import { PALETTE_DOT } from '../domain/SpaceIcon.tsx'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { MiniMonth } from './MiniMonth.tsx'
import { type CalItem, hhmm } from './model.ts'

export interface Overlay {
  tasks: boolean
  lunar: boolean
  holidays: boolean
}

export function CalendarSidebar({
  calendars,
  anchor,
  today,
  weekStartsOn,
  marked,
  overlay,
  onOverlay,
  onPick,
  upcoming,
  onOpen,
  tz,
}: {
  calendars: CalendarView[]
  anchor: LocalDate
  today: LocalDate
  weekStartsOn: number
  marked: Set<string>
  overlay: Overlay
  onOverlay: (o: Overlay) => void
  onPick: (d: LocalDate) => void
  upcoming: CalItem[]
  onOpen: (it: CalItem) => void
  tz: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [month, setMonth] = useState<LocalDate>({ y: anchor.y, m: anchor.m, d: 1 })
  const [shownFor, setShownFor] = useState(`${anchor.y}-${anchor.m}`)
  // 主视图翻页时小月历跟随
  if (shownFor !== `${anchor.y}-${anchor.m}`) {
    setShownFor(`${anchor.y}-${anchor.m}`)
    setMonth({ y: anchor.y, m: anchor.m, d: 1 })
  }
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<PaletteColor>('cyan')
  const [confirmDel, setConfirmDel] = useState<CalendarView | null>(null)
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['calendars'] }),
      qc.invalidateQueries({ queryKey: ['calendar-events'] }),
    ])
  const patch = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: PaletteColor; hidden?: boolean }) =>
      unwrap(
        api.calendars[':id'].$patch({
          param: { id: v.id },
          json: { ...v, id: undefined } as never,
        }),
      ),
    onSuccess: refresh,
    onError: () => toast.error(t('task.saveFailed')),
  })
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.calendars.$post(
          { json: { name: newName.trim(), color: newColor } },
          { headers: { 'Idempotency-Key': newId() } },
        ),
      ),
    onSuccess: async () => {
      setAdding(false)
      setNewName('')
      await refresh()
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? (err.problem.errors?.[0]?.message ?? err.message)
          : t('task.saveFailed'),
      ),
  })

  return (
    <aside className="flex w-full flex-col gap-5" data-testid="cal-sidebar">
      <MiniMonth
        month={month}
        weekStartsOn={weekStartsOn}
        today={today}
        selected={anchor}
        marked={marked}
        holidays={overlay.holidays}
        onPick={onPick}
        header={
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-medium text-sm">
              {t('calendar.yearName', { y: month.y })} {t('calendar.monthName', { m: month.m })}
            </span>
            <span className="flex">
              <button
                type="button"
                aria-label={t('calendar.prevMonth')}
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t('calendar.nextMonth')}
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              >
                <ChevronRight className="size-4" />
              </button>
            </span>
          </div>
        }
      />

      <section>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <h2 className="font-medium text-fg-muted text-xs tracking-[.08em]">
            {t('calendar.myCalendars')}
          </h2>
          <button
            type="button"
            aria-label={t('calendar.newCalendar')}
            onClick={() => setAdding((v) => !v)}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            data-testid="cal-add-calendar"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <ul className="flex flex-col" data-testid="cal-list">
          {calendars.map((c) => (
            <li
              key={c.id}
              className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!c.hidden}
                  onChange={(e) => patch.mutate({ id: c.id, hidden: !e.target.checked })}
                  className="peer sr-only"
                  data-testid="cal-toggle"
                />
                <span
                  className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary',
                    c.hidden
                      ? 'border-current bg-transparent'
                      : cn(PALETTE_DOT[c.color], 'border-transparent'),
                  )}
                  aria-hidden
                >
                  {c.hidden ? null : (
                    <svg viewBox="0 0 16 16" className="size-3 text-primary-fg" aria-hidden>
                      <path
                        d="M3.5 8.5l3 3 6-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className={cn('truncate', c.hidden && 'text-fg-muted')}>{c.name}</span>
              </label>
              <CalendarMenu
                cal={c}
                onSave={(v) => patch.mutate({ id: c.id, ...v })}
                onDelete={() => setConfirmDel(c)}
                canDelete={calendars.length > 1}
              />
            </li>
          ))}
        </ul>
        {adding ? (
          <form
            className="mt-2 flex flex-col gap-2 rounded-md bg-surface-2/60 p-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (newName.trim()) create.mutate()
            }}
          >
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('calendar.calendarName')}
              maxLength={40}
              className="h-8"
              data-testid="cal-new-name"
            />
            <ColorPicker value={newColor} onChange={setNewColor} />
            <div className="flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t('ui.action.cancel')}
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!newName.trim()}
                loading={create.isPending}
              >
                {t('calendar.add')}
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <section>
        <h2 className="mb-1.5 px-1 font-medium text-fg-muted text-xs tracking-[.08em]">
          {t('calendar.overlay')}
        </h2>
        {(['tasks', 'holidays', 'lunar'] as const).map((k) => (
          <label
            key={k}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-hover"
          >
            <input
              type="checkbox"
              checked={overlay[k]}
              onChange={(e) => onOverlay({ ...overlay, [k]: e.target.checked })}
              className="size-4 accent-(--xz-primary)"
              data-testid={`cal-overlay-${k}`}
            />
            {t(`calendar.overlays.${k}`)}
          </label>
        ))}
      </section>

      <section className="min-h-0">
        <h2 className="mb-1.5 px-1 font-medium text-fg-muted text-xs tracking-[.08em]">
          {t('calendar.upcoming')}
        </h2>
        {upcoming.length ? (
          <ul className="flex flex-col gap-0.5" data-testid="cal-upcoming">
            {upcoming.slice(0, 8).map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => onOpen(it)}
                  className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-hover"
                >
                  <span
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full', PALETTE_DOT[it.color])}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{it.title}</span>
                    <span className="block text-fg-muted text-xs tabular-nums">
                      {upcomingWhen(it, tz, t)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-fg-muted text-xs">{t('calendar.noUpcoming')}</p>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={t('calendar.deleteCalendar.title')}
        description={t('calendar.deleteCalendar.body', { name: confirmDel?.name ?? '' })}
        confirmLabel={t('calendar.delete')}
        onConfirm={async () => {
          if (!confirmDel) return
          await unwrap(api.calendars[':id'].$delete({ param: { id: confirmDel.id } }))
          await refresh()
        }}
      />
    </aside>
  )
}

function upcomingWhen(
  it: CalItem,
  tz: string,
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  const d = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(it.start)
  const get = (k: string) => Number(d.find((p) => p.type === k)?.value ?? 0)
  const date = t('calendar.monthDay', { m: get('month'), d: get('day') })
  return it.allDay
    ? `${date} · ${t('calendar.allDay')}`
    : `${date} ${hhmm(get('hour') * 60 + get('minute'))}`
}

function ColorPicker({
  value,
  onChange,
}: {
  value: PaletteColor
  onChange: (c: PaletteColor) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('calendar.color')}>
      {PALETTE_COLORS.map((c) => (
        // biome-ignore lint/a11y/useSemanticElements: 色块单选
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t(`ui.palette.${c}`)}
          onClick={() => onChange(c)}
          className={cn(
            'size-5 rounded-full ring-offset-2 ring-offset-(--xz-surface-solid) transition-shadow',
            PALETTE_DOT[c],
            value === c && 'ring-2 ring-fg/60',
          )}
        />
      ))}
    </div>
  )
}

function CalendarMenu({
  cal,
  onSave,
  onDelete,
  canDelete,
}: {
  cal: CalendarView
  onSave: (v: { name?: string; color?: PaletteColor }) => void
  onDelete: () => void
  canDelete: boolean
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(cal.name)
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) setName(cal.name)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('calendar.editCalendar', { name: cal.name })}
          className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-active hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && name.trim() !== cal.name) onSave({ name: name.trim() })
            setOpen(false)
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="h-8"
            aria-label={t('calendar.calendarName')}
          />
          <ColorPicker value={cal.color} onChange={(c) => onSave({ color: c })} />
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={!canDelete}
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
            >
              {t('calendar.delete')}
            </Button>
            <Button type="submit" size="sm" variant="primary">
              {t('calendar.save')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

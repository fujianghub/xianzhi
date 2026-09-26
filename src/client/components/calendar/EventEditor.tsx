/**
 * 日程编辑器（REQ-CAL-002 · 003 · 004 · 005 · 008）：新建 / 查看编辑 / 删除一体的弹层。
 * 字段：标题、日历（颜色分类）、全天、开始 / 结束、重复（预设 + 自定义 + 结束条件）、提醒（≤ 5）、地点、链接、备注。
 * 重复日程保存 / 删除前询问范围（仅此 / 将来 / 全部）。⌘/Ctrl+Enter 保存。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Clock, Link2, MapPin, Repeat as RepeatIcon, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  addDays,
  type LocalDate,
  localDateOf,
  localDateTimeOf,
  parseLocalDate,
  zonedMidnight,
} from '../../../shared/tz.ts'
import { ApiError } from '../../lib/api.ts'
import {
  type CalendarOccurrence,
  type CalendarView,
  createEvent,
  deleteEvent,
  type EventDraft,
  invalidateCalendar,
  patchEvent,
} from '../../lib/calendar-queries.ts'
import { cn } from '../../lib/cn.ts'
import { PALETTE_DOT } from '../domain/SpaceIcon.tsx'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { FieldError } from '../ui/label.tsx'
import {
  ALLDAY_ALARMS,
  alarmLabel,
  at,
  BYDAY,
  buildRRule,
  describeRepeat,
  hhmm,
  parseRepeat,
  presetOf,
  type Repeat,
  type RepeatPreset,
  repeatFromPreset,
  TIMED_ALARMS,
} from './model.ts'
import { useScopePrompt } from './ScopeDialog.tsx'

export type EditorTarget =
  | { mode: 'create'; start: Date; end: Date; allDay: boolean; calendarId?: string }
  | { mode: 'edit'; occ: CalendarOccurrence }

export interface EventForm {
  title: string
  calendarId: string
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  repeat: Repeat | null
  alarms: number[]
  location: string
  url: string
  notes: string
}

const toTime = (m: number) => hhmm(m)
const fromTime = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
const ld = (s: string) => parseLocalDate(s) as LocalDate
const fmt = (d: LocalDate) =>
  `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`

export function initialForm(target: EditorTarget, tz: string, cals: CalendarView[]): EventForm {
  const fallbackCal = cals.find((c) => c.isDefault && !c.hidden)?.id ?? cals[0]?.id ?? ''
  if (target.mode === 'create') {
    const s = localDateTimeOf(tz, target.start)
    const e = localDateTimeOf(tz, target.end)
    const endDate = target.allDay ? addDays(e.date, -1) : e.date
    return {
      title: '',
      calendarId: target.calendarId ?? fallbackCal,
      allDay: target.allDay,
      startDate: fmt(s.date),
      startTime: toTime(s.minutes),
      endDate: fmt(target.allDay && fmt(endDate) < fmt(s.date) ? s.date : endDate),
      endTime: toTime(e.minutes),
      repeat: null,
      alarms: target.allDay ? [-540] : [10],
      location: '',
      url: '',
      notes: '',
    }
  }
  const o = target.occ
  const zone = o.allDay ? o.timezone : tz
  const s = localDateTimeOf(zone, new Date(o.startAt))
  const e = localDateTimeOf(zone, new Date(o.endAt))
  return {
    title: o.title,
    calendarId: o.calendarId,
    allDay: o.allDay,
    startDate: fmt(s.date),
    startTime: toTime(s.minutes),
    endDate: fmt(o.allDay ? addDays(localDateOf(zone, new Date(o.endAt)), -1) : e.date),
    endTime: toTime(e.minutes),
    repeat: parseRepeat(o.rrule),
    alarms: o.alarms,
    location: o.location ?? '',
    url: o.url ?? '',
    notes: o.notes ?? '',
  }
}

/** 表单 → [开始, 结束)：全天按本地零点、结束日含当天（+1 天）。 */
export function formRange(form: EventForm, tz: string): { start: Date; end: Date } {
  if (form.allDay)
    return {
      start: zonedMidnight(tz, ld(form.startDate)),
      end: zonedMidnight(tz, addDays(ld(form.endDate), 1)),
    }
  return {
    start: at(tz, ld(form.startDate), fromTime(form.startTime)),
    end: at(tz, ld(form.endDate), fromTime(form.endTime)),
  }
}

export function EventEditor({
  target,
  onClose,
  calendars,
  tz,
}: {
  target: EditorTarget | null
  onClose: () => void
  calendars: CalendarView[]
  tz: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const uid = useId()
  const [form, setForm] = useState<EventForm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scopeEl, askScope] = useScopePrompt()
  useEffect(() => {
    setForm(target ? initialForm(target, tz, calendars) : null)
    setError(null)
  }, [target, tz, calendars])

  const occ = target?.mode === 'edit' ? target.occ : null
  const recurring = !!occ?.recurring
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f))

  const range = useMemo(() => (form ? formRange(form, tz) : null), [form, tz])

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !range || !target) return
      const draft: EventDraft = {
        calendarId: form.calendarId,
        title: form.title.trim() || t('calendar.untitled'),
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
        url: form.url.trim() || null,
        allDay: form.allDay,
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString(),
        timezone: occ?.allDay && form.allDay ? occ.timezone : tz,
        rrule: form.repeat ? buildRRule(form.repeat) : null,
        alarms: form.alarms,
      }
      if (target.mode === 'create') return createEvent(draft)
      let scope: 'this' | 'future' | 'all' = 'all'
      if (recurring && !occ?.isException) {
        const s = await askScope('save')
        if (!s) throw new Error('cancelled')
        scope = s
      } else if (occ?.isException) scope = 'this'
      return patchEvent(target.occ, draft, scope)
    },
    onSuccess: async () => {
      await invalidateCalendar(qc)
      toast.success(target?.mode === 'create' ? t('calendar.created') : t('calendar.saved'))
      onClose()
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'cancelled') return
      if (err instanceof ApiError && err.code === 'CONFLICT_STALE') {
        setError(t('calendar.stale'))
        void invalidateCalendar(qc)
        return
      }
      setError(
        err instanceof ApiError
          ? (err.problem.errors?.[0]?.message ?? err.message)
          : t('task.saveFailed'),
      )
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!occ) return
      let scope: 'this' | 'future' | 'all' = 'all'
      if (recurring) {
        const s = await askScope('delete')
        if (!s) throw new Error('cancelled')
        scope = s
      }
      return deleteEvent(occ, scope)
    },
    onSuccess: async () => {
      await invalidateCalendar(qc)
      toast.success(t('calendar.deleted'))
      onClose()
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'cancelled') return
      setError(t('task.saveFailed'))
    },
  })

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!form || !range) return
    if (range.end <= range.start) return setError(t('calendar.endBeforeStart'))
    setError(null)
    save.mutate()
  }

  const cal = calendars.find((c) => c.id === form?.calendarId)
  const preset: RepeatPreset = presetOf(form?.repeat ?? null)
  const alarmOptions: readonly number[] = form?.allDay ? ALLDAY_ALARMS : TIMED_ALARMS
  const fieldCls = 'h-9 rounded-md border border-border bg-surface px-2 text-sm'

  return (
    <>
      <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          className="max-h-[92dvh] w-[min(94vw,34rem)] overflow-y-auto p-0"
          data-testid="cal-editor"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        >
          {form ? (
            <form onSubmit={submit} className="flex flex-col" noValidate>
              <div className="flex items-center gap-3 border-divider border-b px-5 pt-5 pb-4">
                <span
                  className={cn('size-3 shrink-0 rounded-full', PALETTE_DOT[cal?.color ?? 'blue'])}
                  aria-hidden
                />
                <DialogTitle className="sr-only">
                  {target?.mode === 'create' ? t('calendar.newEvent') : t('calendar.editEvent')}
                </DialogTitle>
                <input
                  autoFocus={target?.mode === 'create'}
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder={t('calendar.titlePlaceholder')}
                  aria-label={t('calendar.title')}
                  maxLength={200}
                  className="min-w-0 flex-1 bg-transparent font-semibold text-lg outline-none placeholder:text-fg-faint"
                  data-testid="cal-editor-title"
                />
              </div>

              <div className="flex flex-col gap-3.5 px-5 py-4 text-sm">
                <Row icon={CalendarDays} label={t('calendar.calendar')}>
                  <select
                    value={form.calendarId}
                    onChange={(e) => set('calendarId', e.target.value)}
                    className={cn(fieldCls, 'min-w-40')}
                    data-testid="cal-editor-calendar"
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row icon={Clock} label={t('calendar.time')}>
                  <div className="flex flex-col gap-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.allDay}
                        onChange={(e) => {
                          const allDay = e.target.checked
                          setForm((f) =>
                            f
                              ? {
                                  ...f,
                                  allDay,
                                  alarms: allDay ? [-540] : [10],
                                  endDate:
                                    allDay && f.endDate < f.startDate ? f.startDate : f.endDate,
                                }
                              : f,
                          )
                        }}
                        className="size-4 accent-(--xz-primary)"
                        data-testid="cal-editor-allday"
                      />
                      {t('calendar.allDay')}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-8 text-fg-muted text-xs">{t('calendar.start')}</span>
                      <input
                        type="date"
                        value={form.startDate}
                        aria-label={t('calendar.startDate')}
                        onChange={(e) => {
                          const v = e.target.value
                          if (!parseLocalDate(v)) return
                          // 改开始日期时保持时长（macOS）
                          setForm((f) => {
                            if (!f) return f
                            const delta =
                              Date.UTC(ld(v).y, ld(v).m - 1, ld(v).d) -
                              Date.UTC(ld(f.startDate).y, ld(f.startDate).m - 1, ld(f.startDate).d)
                            const end = new Date(Date.parse(`${f.endDate}T00:00:00Z`) + delta)
                            return { ...f, startDate: v, endDate: end.toISOString().slice(0, 10) }
                          })
                        }}
                        className={fieldCls}
                        data-testid="cal-editor-start-date"
                      />
                      {form.allDay ? null : (
                        <input
                          type="time"
                          step={300}
                          value={form.startTime}
                          aria-label={t('calendar.startTime')}
                          onChange={(e) => {
                            const v = e.target.value
                            if (!v) return
                            setForm((f) => {
                              if (!f) return f
                              const dur =
                                fromTime(f.endTime) -
                                fromTime(f.startTime) +
                                (Date.parse(f.endDate) - Date.parse(f.startDate)) / 60_000
                              const endAbs = fromTime(v) + Math.max(dur, 15)
                              const endDate = new Date(
                                Date.parse(`${f.startDate}T00:00:00Z`) +
                                  Math.floor(endAbs / 1440) * 86_400_000,
                              )
                              return {
                                ...f,
                                startTime: v,
                                endTime: toTime(((endAbs % 1440) + 1440) % 1440),
                                endDate: endDate.toISOString().slice(0, 10),
                              }
                            })
                          }}
                          className={fieldCls}
                          data-testid="cal-editor-start-time"
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-8 text-fg-muted text-xs">{t('calendar.end')}</span>
                      <input
                        type="date"
                        value={form.endDate}
                        min={form.startDate}
                        aria-label={t('calendar.endDate')}
                        onChange={(e) =>
                          parseLocalDate(e.target.value) && set('endDate', e.target.value)
                        }
                        className={fieldCls}
                        data-testid="cal-editor-end-date"
                      />
                      {form.allDay ? null : (
                        <input
                          type="time"
                          step={300}
                          value={form.endTime}
                          aria-label={t('calendar.endTime')}
                          onChange={(e) => e.target.value && set('endTime', e.target.value)}
                          className={fieldCls}
                          data-testid="cal-editor-end-time"
                        />
                      )}
                    </div>
                  </div>
                </Row>

                <Row icon={RepeatIcon} label={t('calendar.repeat.label')}>
                  <div className="flex flex-col gap-2">
                    <select
                      value={preset}
                      onChange={(e) =>
                        set(
                          'repeat',
                          repeatFromPreset(
                            e.target.value as RepeatPreset,
                            ld(form.startDate),
                            form.repeat,
                          ),
                        )
                      }
                      className={cn(fieldCls, 'min-w-40')}
                      data-testid="cal-editor-repeat"
                    >
                      {(
                        [
                          'none',
                          'daily',
                          'weekdays',
                          'weekly',
                          'biweekly',
                          'monthly',
                          'yearly',
                          'custom',
                        ] as const
                      ).map((p) => (
                        <option key={p} value={p}>
                          {t(`calendar.repeat.preset.${p}`)}
                        </option>
                      ))}
                    </select>
                    {form.repeat && preset === 'custom' ? (
                      <CustomRepeat value={form.repeat} onChange={(r) => set('repeat', r)} />
                    ) : null}
                    {form.repeat ? (
                      <RepeatEnd
                        value={form.repeat}
                        min={form.startDate}
                        onChange={(r) => set('repeat', r)}
                        id={uid}
                      />
                    ) : null}
                    {form.repeat ? (
                      <p className="text-fg-muted text-xs" data-testid="cal-editor-repeat-summary">
                        {describeRepeat(form.repeat, t)}
                      </p>
                    ) : null}
                  </div>
                </Row>

                <Row icon={Clock} label={t('calendar.alarm.label')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {form.alarms.map((m, i) => (
                      <span
                        key={m}
                        className="inline-flex h-7 items-center gap-1 rounded-full bg-selected px-2.5 text-xs"
                      >
                        {alarmLabel(m, form.allDay, t)}
                        <button
                          type="button"
                          aria-label={t('calendar.alarm.remove')}
                          onClick={() =>
                            set(
                              'alarms',
                              form.alarms.filter((_, k) => k !== i),
                            )
                          }
                          className="-mr-1 inline-flex size-5 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {form.alarms.length < 5 ? (
                      <select
                        value=""
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!form.alarms.includes(v))
                            set(
                              'alarms',
                              [...form.alarms, v].sort((a, b) => a - b),
                            )
                        }}
                        className={cn(fieldCls, 'h-7 text-xs')}
                        aria-label={t('calendar.alarm.add')}
                        data-testid="cal-editor-alarm"
                      >
                        <option value="">{t('calendar.alarm.add')}</option>
                        {alarmOptions
                          .filter((m) => !form.alarms.includes(m))
                          .map((m) => (
                            <option key={m} value={m}>
                              {alarmLabel(m, form.allDay, t)}
                            </option>
                          ))}
                      </select>
                    ) : null}
                  </div>
                </Row>

                <Row icon={MapPin} label={t('calendar.location')}>
                  <Input
                    value={form.location}
                    onChange={(e) => set('location', e.target.value)}
                    placeholder={t('calendar.locationPlaceholder')}
                    maxLength={200}
                    className="h-9"
                  />
                </Row>
                <Row icon={Link2} label={t('calendar.url')}>
                  <Input
                    type="url"
                    value={form.url}
                    onChange={(e) => set('url', e.target.value)}
                    placeholder="https://"
                    className="h-9"
                  />
                </Row>
                <textarea
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder={t('calendar.notesPlaceholder')}
                  aria-label={t('calendar.notes')}
                  maxLength={5000}
                  rows={3}
                  className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-selected-border"
                />
                <FieldError>{error}</FieldError>
              </div>

              <div className="flex items-center gap-2 border-divider border-t px-5 py-3">
                {occ ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-danger"
                    loading={remove.isPending}
                    onClick={() => remove.mutate()}
                    data-testid="cal-editor-delete"
                  >
                    <Trash2 />
                    {t('calendar.delete')}
                  </Button>
                ) : null}
                <span className="flex-1" />
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t('ui.action.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={save.isPending}
                  data-testid="cal-editor-save"
                >
                  {target?.mode === 'create' ? t('calendar.add') : t('calendar.save')}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      {scopeEl}
    </>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[1.25rem_4.5rem_1fr] items-start gap-2">
      <Icon className="mt-2 size-4 text-fg-muted" aria-hidden />
      <span className="pt-2 text-fg-muted text-xs">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function CustomRepeat({ value, onChange }: { value: Repeat; onChange: (r: Repeat) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2/60 p-2.5">
      <div className="flex items-center gap-2 text-xs">
        {t('calendar.repeat.every')}
        <input
          type="number"
          min={1}
          max={99}
          value={value.interval}
          onChange={(e) =>
            onChange({ ...value, interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })
          }
          className="h-8 w-16 rounded-md border border-border bg-surface px-2 text-sm"
          aria-label={t('calendar.repeat.interval')}
        />
        <select
          value={value.freq}
          onChange={(e) => onChange({ ...value, freq: e.target.value as Repeat['freq'] })}
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
          aria-label={t('calendar.repeat.freq')}
        >
          {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((f) => (
            <option key={f} value={f}>
              {t(`calendar.repeat.unit.${f}`)}
            </option>
          ))}
        </select>
      </div>
      {value.freq === 'WEEKLY' ? (
        <fieldset className="flex gap-1">
          <legend className="sr-only">{t('calendar.repeat.onWeekdays')}</legend>
          {BYDAY.map((_, i) => {
            const on = value.byDay.includes(i)
            return (
              <button
                key={BYDAY[i]}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...value,
                    byDay: on
                      ? value.byDay.filter((x) => x !== i).length
                        ? value.byDay.filter((x) => x !== i)
                        : value.byDay
                      : [...value.byDay, i],
                  })
                }
                className={cn(
                  'size-8 rounded-full text-xs transition-colors',
                  on ? 'bg-primary text-primary-fg' : 'bg-surface text-fg-muted hover:bg-hover',
                )}
              >
                {t(`calendar.wd.${i}`)}
              </button>
            )
          })}
        </fieldset>
      ) : null}
    </div>
  )
}

function RepeatEnd({
  value,
  onChange,
  min,
  id,
}: {
  value: Repeat
  onChange: (r: Repeat) => void
  min: string
  id: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor={`${id}-end`} className="text-fg-muted">
        {t('calendar.repeat.endLabel')}
      </label>
      <select
        id={`${id}-end`}
        value={value.end.kind}
        onChange={(e) => {
          const k = e.target.value as Repeat['end']['kind']
          onChange({
            ...value,
            end:
              k === 'never'
                ? { kind: 'never' }
                : k === 'count'
                  ? { kind: 'count', count: 10 }
                  : { kind: 'until', date: min },
          })
        }}
        className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
      >
        <option value="never">{t('calendar.repeat.endNever')}</option>
        <option value="until">{t('calendar.repeat.endUntil')}</option>
        <option value="count">{t('calendar.repeat.endCount')}</option>
      </select>
      {value.end.kind === 'until' ? (
        <input
          type="date"
          min={min}
          value={value.end.date}
          onChange={(e) =>
            parseLocalDate(e.target.value) &&
            onChange({ ...value, end: { kind: 'until', date: e.target.value } })
          }
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
          aria-label={t('calendar.repeat.endUntil')}
        />
      ) : null}
      {value.end.kind === 'count' ? (
        <input
          type="number"
          min={1}
          max={1000}
          value={value.end.count}
          onChange={(e) =>
            onChange({
              ...value,
              end: {
                kind: 'count',
                count: Math.min(1000, Math.max(1, Number(e.target.value) || 1)),
              },
            })
          }
          className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-sm"
          aria-label={t('calendar.repeat.endCount')}
        />
      ) : null}
    </div>
  )
}

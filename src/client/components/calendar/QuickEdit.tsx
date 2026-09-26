/**
 * 日历快速编辑气泡（REQ-CAL-012；对标 macOS 日历）：点日程 / 任务在其旁弹出，就地修改与删除，不离开日历。
 * - 日程：标题、全天、开始 / 结束、日历、地点、备注；关闭气泡时若有改动即保存（重复日程先问范围）；
 *   「更多选项」打开完整编辑器（重复 / 提醒 / 链接）；删除（重复日程问范围）。
 * - 任务：标题、完成、日期 / 时间（改的是日历上用来定位它的那个字段：截止优先，否则计划开始）、优先级；
 *   删除（软删，Toast「撤销」= restore）；「详情」在日历页内打开任务详情抽屉。
 * 焦点不在输入框时按 Delete / Backspace = 删除；Esc 关闭。
 */
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { addDays, type LocalDate, localDateTimeOf, parseLocalDate } from '../../../shared/tz.ts'
import { useTaskActions } from '../../hooks/useTasks.ts'
import { ApiError } from '../../lib/api.ts'
import {
  type CalendarView,
  deleteEvent,
  type EventDraft,
  invalidateCalendar,
  patchEvent,
} from '../../lib/calendar-queries.ts'
import { cn } from '../../lib/cn.ts'
import type { Task } from '../../lib/task-queries.ts'
import { PALETTE_DOT } from '../domain/SpaceIcon.tsx'
import { Button } from '../ui/button.tsx'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx'
import { type EventForm, formRange, initialForm } from './EventEditor.tsx'
import { at, type CalItem, hhmm } from './model.ts'

type AskScope = (a: 'save' | 'delete') => Promise<'this' | 'future' | 'all' | null>

export interface QuickTarget {
  item: CalItem
  /** 被点元素的视口矩形；气泡贴着它弹出 */
  rect: { left: number; top: number; width: number; height: number }
}

const fieldCls =
  'h-8 min-w-0 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border'
const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable)

export function QuickEdit({
  target,
  onClose,
  calendars,
  tz,
  onMore,
  onOpenTask,
  askScope,
}: {
  target: QuickTarget | null
  /** 路由级范围询问：气泡先关、对话框仍在（气泡内的对话框会随气泡卸载） */
  askScope: AskScope
  onClose: () => void
  calendars: CalendarView[]
  tz: string
  /** 日程：打开完整编辑器 */
  onMore: (it: CalItem) => void
  /** 任务：在日历页内打开详情抽屉 */
  onOpenTask: (task: Task) => void
}) {
  const commit = useRef<(() => void) | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const del = useRef<(() => void) | null>(null)
  const close = () => {
    commit.current?.()
    commit.current = null
    onClose()
  }
  const item = target?.item
  return (
    <Popover open={!!target} onOpenChange={(v) => !v && close()}>
      {target ? (
        <PopoverAnchor asChild>
          <div
            aria-hidden
            className="pointer-events-none fixed"
            style={{
              left: target.rect.left,
              top: target.rect.top,
              width: target.rect.width,
              height: target.rect.height,
            }}
          />
        </PopoverAnchor>
      ) : null}
      <PopoverContent
        side="right"
        align="start"
        collisionPadding={12}
        className="w-80 p-0"
        data-testid="cal-quick"
        data-source={item?.source}
        ref={box}
        tabIndex={-1}
        // 焦点给气泡本身（不进标题框）：打开后直接按 Delete 即删除，Tab 进入字段
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          box.current?.focus()
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e.target)) {
            e.preventDefault()
            del.current?.()
          }
        }}
      >
        {item?.occ ? (
          <EventQuick
            key={item.key}
            item={item}
            tz={tz}
            calendars={calendars}
            commitRef={commit}
            delRef={del}
            askScope={askScope}
            onDone={onClose}
            onMore={() => {
              commit.current = null
              onClose()
              onMore(item)
            }}
          />
        ) : item?.task ? (
          <TaskQuick
            key={item.key}
            task={item.task}
            tz={tz}
            delRef={del}
            onDone={onClose}
            onOpen={() => {
              onClose()
              if (item.task) onOpenTask(item.task)
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function EventQuick({
  item,
  tz,
  calendars,
  commitRef,
  delRef,
  askScope,
  onDone,
  onMore,
}: {
  askScope: AskScope
  item: CalItem
  tz: string
  calendars: CalendarView[]
  commitRef: { current: (() => void) | null }
  delRef: { current: (() => void) | null }
  onDone: () => void
  onMore: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const occ = item.occ as NonNullable<CalItem['occ']>
  const [init] = useState(() => initialForm({ mode: 'edit', occ }, tz, calendars))
  const [form, setForm] = useState<EventForm>(init)
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }))
  const dirty = JSON.stringify(form) !== JSON.stringify(init)

  const save = async (f: EventForm) => {
    const range = formRange(f, tz)
    if (range.end <= range.start) {
      toast.error(t('calendar.endBeforeStart'))
      return
    }
    const draft: Partial<EventDraft> = {
      calendarId: f.calendarId,
      title: f.title.trim() || t('calendar.untitled'),
      location: f.location.trim() || null,
      notes: f.notes.trim() || null,
      allDay: f.allDay,
      startAt: range.start.toISOString(),
      endAt: range.end.toISOString(),
      timezone: occ.allDay && f.allDay ? occ.timezone : tz,
    }
    let scope: 'this' | 'future' | 'all' = 'all'
    if (occ.isException) scope = 'this'
    else if (occ.recurring) {
      const s = await askScope('save')
      if (!s) return
      scope = s
    }
    try {
      await patchEvent(occ, draft, scope)
      toast.success(t('calendar.saved'))
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'CONFLICT_STALE'
          ? t('calendar.stale')
          : err instanceof ApiError
            ? (err.problem.errors?.[0]?.message ?? err.message)
            : t('task.saveFailed'),
      )
    } finally {
      await invalidateCalendar(qc)
    }
  }
  // 关闭气泡（点外面 / Esc）时有改动即保存（macOS 行为）
  const latest = useRef(form)
  latest.current = form
  useEffect(() => {
    commitRef.current = dirty ? () => void save(latest.current) : null
  })

  // 先关气泡再删（重复日程在路由级对话框里问范围）
  const remove = async () => {
    commitRef.current = null
    onDone()
    let scope: 'this' | 'future' | 'all' = 'all'
    if (occ.recurring) {
      const s = await askScope('delete')
      if (!s) return
      scope = s
    }
    try {
      await deleteEvent(occ, scope)
      toast.success(t('calendar.deleted'))
    } catch {
      toast.error(t('task.saveFailed'))
    } finally {
      await invalidateCalendar(qc)
    }
  }
  delRef.current = () => void remove()
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'text') {
      e.preventDefault()
      commitRef.current = null
      onDone()
      if (dirty) void save(form)
    }
  }
  const cal = calendars.find((c) => c.id === form.calendarId)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 气泡内 Enter 保存
    <div className="flex flex-col" onKeyDown={onKeyDown} data-testid="cal-quick-event">
      <div className="flex items-center gap-2 border-divider border-b px-4 pt-3.5 pb-3">
        <span
          aria-hidden
          className={cn('size-3 shrink-0 rounded-full', PALETTE_DOT[cal?.color ?? 'blue'])}
        />
        <input
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          aria-label={t('calendar.title')}
          placeholder={t('calendar.titlePlaceholder')}
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:text-fg-faint"
          data-testid="cal-quick-title"
        />
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) => {
              const allDay = e.target.checked
              setForm((f) => ({
                ...f,
                allDay,
                endDate: allDay && f.endDate < f.startDate ? f.startDate : f.endDate,
              }))
            }}
            className="size-4 accent-(--xz-primary)"
            data-testid="cal-quick-allday"
          />
          {t('calendar.allDay')}
        </label>
        <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2">
          <span className="text-fg-muted text-xs">{t('calendar.start')}</span>
          <input
            type="date"
            value={form.startDate}
            aria-label={t('calendar.startDate')}
            onChange={(e) => parseLocalDate(e.target.value) && set('startDate', e.target.value)}
            className={fieldCls}
            data-testid="cal-quick-start-date"
          />
          {form.allDay ? (
            <span />
          ) : (
            <input
              type="time"
              step={900}
              value={form.startTime}
              aria-label={t('calendar.startTime')}
              onChange={(e) => e.target.value && set('startTime', e.target.value)}
              className={fieldCls}
              data-testid="cal-quick-start-time"
            />
          )}
          <span className="text-fg-muted text-xs">{t('calendar.end')}</span>
          <input
            type="date"
            value={form.endDate}
            aria-label={t('calendar.endDate')}
            onChange={(e) => parseLocalDate(e.target.value) && set('endDate', e.target.value)}
            className={fieldCls}
            data-testid="cal-quick-end-date"
          />
          {form.allDay ? (
            <span />
          ) : (
            <input
              type="time"
              step={900}
              value={form.endTime}
              aria-label={t('calendar.endTime')}
              onChange={(e) => e.target.value && set('endTime', e.target.value)}
              className={fieldCls}
              data-testid="cal-quick-end-time"
            />
          )}
        </div>
        <select
          value={form.calendarId}
          onChange={(e) => set('calendarId', e.target.value)}
          aria-label={t('calendar.calendar')}
          className={fieldCls}
          data-testid="cal-quick-calendar"
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={form.location}
          onChange={(e) => set('location', e.target.value)}
          placeholder={t('calendar.locationPlaceholder')}
          aria-label={t('calendar.location')}
          maxLength={200}
          className={fieldCls}
        />
        <textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder={t('calendar.notesPlaceholder')}
          aria-label={t('calendar.notes')}
          rows={2}
          maxLength={5000}
          className="min-h-14 resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-selected-border"
        />
        {occ.recurring ? (
          <p className="text-fg-muted text-xs">{t('calendar.quick.recurringHint')}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 border-divider border-t px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={() => void remove()}
          data-testid="cal-quick-delete"
        >
          <Trash2 className="size-4" />
          {t('calendar.delete')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onMore} data-testid="cal-quick-more">
          <MoreHorizontal className="size-4" />
          {t('calendar.quick.more')}
        </Button>
        <Button
          variant={dirty ? 'primary' : 'ghost'}
          size="sm"
          className="ml-auto"
          onClick={() => {
            commitRef.current = null
            onDone()
            if (dirty) void save(form)
          }}
          data-testid="cal-quick-done"
        >
          {dirty ? t('calendar.save') : t('calendar.quick.close')}
        </Button>
      </div>
    </div>
  )
}

/** 任务在日历上的定位字段：截止优先，否则计划开始（与 taskToItem 一致）。 */
const placeField = (task: Task): 'dueAt' | 'scheduledAt' =>
  task.dueAt ? 'dueAt' : task.scheduledAt ? 'scheduledAt' : 'dueAt'
const ALL_DAY_MIN = 23 * 60 + 59
const fmtDate = (d: LocalDate) =>
  `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`

function TaskQuick({
  task,
  tz,
  delRef,
  onDone,
  onOpen,
}: {
  task: Task
  tz: string
  delRef: { current: (() => void) | null }
  onDone: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const actions = useTaskActions()
  // 乐观更新后缓存里是新 task；气泡内以本地副本为准，保存后回填
  const [cur, setCur] = useState(task)
  const field = placeField(cur)
  const iso = cur[field]
  const local = iso ? localDateTimeOf(tz, new Date(iso)) : null
  const allDay = !local || local.minutes === 0 || local.minutes === ALL_DAY_MIN
  const [title, setTitle] = useState(task.title)
  const done = cur.status === 'done' || cur.status === 'cancelled'

  // 气泡内的写操作串行，且总用最新版本（ifUpdatedAt）：回车存标题后失焦、紧接着改时间，不会互相 409
  const latest = useRef(task)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const apply = (next: Task) => {
    latest.current = next
    setCur(next)
  }
  const enqueue = (op: (base: Task) => Promise<Task>, onFail?: () => void) => {
    queue.current = queue.current.then(async () => {
      try {
        apply(await op(latest.current))
      } catch (err) {
        // 409：hook 已用最新值覆盖缓存并提示；气泡同步为最新
        if (err instanceof ApiError && err.problem.current) apply(err.problem.current as Task)
        onFail?.()
      }
    })
  }
  const patch = (change: Parameters<typeof actions.patch>[1]) =>
    enqueue(
      (base) => actions.patch(base, change),
      () => setTitle(latest.current.title),
    )
  const setWhen = (date: string, time: string | null) => {
    const d = parseLocalDate(date)
    if (!d) return
    const minutes = time
      ? (Number(time.slice(0, 2)) || 0) * 60 + (Number(time.slice(3, 5)) || 0)
      : ALL_DAY_MIN
    const next = at(tz, d, minutes).toISOString()
    if (next !== iso) patch({ [field]: next })
  }
  /** 已排队但未落库的标题，避免回车 + 失焦重复提交 */
  const pendingTitle = useRef<string | null>(null)
  const saveTitle = () => {
    const v = title.trim()
    if (!v) return setTitle(latest.current.title)
    if (v === latest.current.title || v === pendingTitle.current) return
    pendingTitle.current = v
    patch({ title: v })
  }
  const toggleDone = () =>
    enqueue(
      async (base) => {
        const r =
          base.status === 'done' || base.status === 'cancelled'
            ? await actions.uncomplete(base)
            : await actions.complete(base)
        await qc.invalidateQueries({ queryKey: ['tasks'] })
        return r
      },
      () => toast.error(t('task.saveFailed')),
    )
  const remove = async () => {
    onDone()
    try {
      await actions.remove(cur, { undo: true })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    }
  }
  delRef.current = () => void remove()

  return (
    <div className="flex flex-col" data-testid="cal-quick-task">
      <div className="flex items-center gap-2 border-divider border-b px-4 pt-3.5 pb-3">
        <input
          type="checkbox"
          checked={done}
          onChange={toggleDone}
          aria-label={t(done ? 'calendar.quick.markUndone' : 'calendar.quick.markDone')}
          className="size-5 shrink-0 accent-(--xz-primary)"
          data-testid="cal-quick-done-toggle"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              saveTitle()
            }
          }}
          aria-label={t('calendar.title')}
          maxLength={200}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-semibold outline-none',
            done && 'text-fg-muted line-through',
          )}
          data-testid="cal-quick-title"
        />
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3 text-sm">
        <div className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2">
          <span className="text-fg-muted text-xs">{t(`task.${field}`)}</span>
          <input
            type="date"
            value={local ? fmtDate(local.date) : ''}
            aria-label={t('calendar.quick.date')}
            onChange={(e) =>
              e.target.value && setWhen(e.target.value, allDay ? null : hhmm(local?.minutes ?? 0))
            }
            className={fieldCls}
            data-testid="cal-quick-task-date"
          />
          <input
            type="time"
            step={900}
            value={allDay || !local ? '' : hhmm(local.minutes)}
            aria-label={t('calendar.quick.time')}
            onChange={(e) =>
              local && setWhen(fmtDate(local.date), e.target.value ? e.target.value : null)
            }
            className={fieldCls}
            data-testid="cal-quick-task-time"
          />
          <span className="text-fg-muted text-xs">{t('task.priorityLabel')}</span>
          <select
            value={cur.priority}
            onChange={(e) => void patch({ priority: Number(e.target.value) })}
            aria-label={t('task.priorityLabel')}
            className={cn(fieldCls, 'col-span-2')}
            data-testid="cal-quick-priority"
          >
            {[0, 1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                {t(`task.priority.${p}`)}
              </option>
            ))}
          </select>
          <span className="text-fg-muted text-xs">{t('task.statusLabel')}</span>
          <span className="col-span-2 text-fg-muted">{t(`task.status.${cur.status}`)}</span>
        </div>
        {allDay && local ? (
          <p className="text-fg-muted text-xs">{t('calendar.quick.allDayHint')}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 border-divider border-t px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={() => void remove()}
          data-testid="cal-quick-delete"
        >
          <Trash2 className="size-4" />
          {t('calendar.delete')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpen} data-testid="cal-quick-open-task">
          <ExternalLink className="size-4" />
          {t('calendar.quick.details')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            saveTitle()
            onDone()
          }}
          data-testid="cal-quick-done"
        >
          {t('calendar.quick.close')}
        </Button>
      </div>
    </div>
  )
}

/** 把任务时刻平移 dayDelta 天 + minuteDelta 分钟（按用户时区本地时刻，跨 DST 不漂移）。 */
export function shiftTaskIso(iso: string, tz: string, dayDelta: number, minuteDelta = 0): string {
  const { date, minutes } = localDateTimeOf(tz, new Date(iso))
  return at(tz, addDays(date, dayDelta), minutes + minuteDelta).toISOString()
}

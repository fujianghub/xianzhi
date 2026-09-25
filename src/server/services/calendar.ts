/**
 * 日历与日程（ADR-0009；REQ-CAL-001 ~ 009）。个人私有：一切读写经 can('calendar.read' | 'calendar.write')，
 * 列表用 visibleCalendarsWhere / visibleCalendarEventsWhere（CLAUDE.md 不变量 2）。
 * - 首次访问自动建 4 个默认日历（个人 / 工作 / 学习 / 生活），至少保留 1 个
 * - 重复：母事件存 RRULE，查询时展开；单次改写 = 独立行（recurrenceId + originalStartAt）+ 母事件 exdates
 * - 改 / 删范围：this（仅此次）· future（此次及将来：截断母事件 + 另起新系列）· all（整个系列）
 */
import { and, asc, count, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type {
  CalEditScope,
  CalendarOccurrence,
  CalendarView,
  CreateCalendarEventInput,
  PatchCalendarEventInput,
} from '../../shared/schemas/calendar.ts'
import type { PaletteColor } from '../../shared/schemas/enums.ts'
import {
  type Actor,
  assertCan,
  visibleCalendarEventsWhere,
  visibleCalendarsWhere,
} from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { calendarEvents, calendars } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import {
  InvalidRRuleError,
  isOccurrence,
  occurrencesBetween,
  parseRRule,
  seriesEnd,
  truncateRRule,
} from './calendar-recur.ts'

export interface CalCtx {
  actor: Actor
  workspaceId: string
}

export const DEFAULT_CALENDARS: ReadonlyArray<{ name: string; color: PaletteColor }> = [
  { name: '个人', color: 'green' },
  { name: '工作', color: 'blue' },
  { name: '学习', color: 'orange' },
  { name: '生活', color: 'purple' },
]
export const CALENDAR_LIMIT = 30

type CalRow = typeof calendars.$inferSelect
type EvRow = typeof calendarEvents.$inferSelect

const calView = (r: CalRow): CalendarView => ({
  id: r.id,
  name: r.name,
  color: r.color as PaletteColor,
  hidden: r.hidden,
  isDefault: r.isDefault,
  position: r.position,
})

const dates = (a: unknown): Date[] =>
  ((a as unknown[] | null) ?? []).map((x) => new Date(x as string))

function occView(r: EvRow, start?: Date): CalendarOccurrence {
  const dur = r.endAt.getTime() - r.startAt.getTime()
  const s = start ?? r.startAt
  const recurring = !!r.rrule || !!r.recurrenceId
  const occ = r.rrule ? s : r.originalStartAt
  return {
    key: `${r.id}:${s.toISOString()}`,
    id: r.id,
    calendarId: r.calendarId,
    title: r.title,
    location: r.location,
    notes: r.notes,
    url: r.url,
    allDay: r.allDay,
    startAt: s.toISOString(),
    endAt: new Date(s.getTime() + dur).toISOString(),
    timezone: r.timezone,
    rrule: r.rrule ?? null,
    alarms: r.alarms ?? [],
    recurring,
    occurrenceStart: recurring && occ ? occ.toISOString() : null,
    isException: !!r.recurrenceId,
    updatedAt: r.updatedAt.toISOString(),
  }
}

const badRule = (err: unknown) =>
  err instanceof InvalidRRuleError
    ? AppError.validation([{ path: 'rrule', message: err.message }])
    : err

// ---------- 日历 ----------

/** 首次访问建默认日历；advisory lock 防并发双建。 */
async function ensureDefaults(db: Db, ctx: CalCtx): Promise<void> {
  const [n] = await db
    .select({ n: count() })
    .from(calendars)
    .where(visibleCalendarsWhere(ctx.actor))
  if ((n?.n ?? 0) > 0) return
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cal:${ctx.actor.id}`}))`)
    const [again] = await tx
      .select({ n: count() })
      .from(calendars)
      .where(eq(calendars.ownerId, ctx.actor.id))
    if ((again?.n ?? 0) > 0) return
    await tx.insert(calendars).values(
      DEFAULT_CALENDARS.map((c, i) => ({
        workspaceId: ctx.workspaceId,
        ownerId: ctx.actor.id,
        name: c.name,
        color: c.color,
        isDefault: i === 0,
        position: i,
      })),
    )
  })
}

export async function listCalendars(db: Db, ctx: CalCtx): Promise<CalendarView[]> {
  await ensureDefaults(db, ctx)
  const rows = await db
    .select()
    .from(calendars)
    .where(visibleCalendarsWhere(ctx.actor))
    .orderBy(asc(calendars.position), asc(calendars.createdAt))
  return rows.map(calView)
}

async function loadCalendar(db: DbOrTx, ctx: CalCtx, id: string, mode: 'read' | 'write') {
  const [row] = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1)
  // 他人的日历按不存在处理（不泄露存在性）
  if (!row || row.ownerId !== ctx.actor.id) throw AppError.notFound('日历不存在')
  assertCan(ctx.actor, mode === 'read' ? 'calendar.read' : 'calendar.write', row)
  return row
}

export async function createCalendar(
  db: Db,
  ctx: CalCtx,
  input: { name: string; color: PaletteColor },
): Promise<CalendarView> {
  assertCan(ctx.actor, 'calendar.write', { id: '', ownerId: ctx.actor.id })
  const existing = await listCalendars(db, ctx)
  if (existing.length >= CALENDAR_LIMIT)
    throw AppError.validation([{ path: 'name', message: `最多 ${CALENDAR_LIMIT} 个日历` }])
  const [row] = await db
    .insert(calendars)
    .values({
      workspaceId: ctx.workspaceId,
      ownerId: ctx.actor.id,
      name: input.name,
      color: input.color,
      position: Math.max(-1, ...existing.map((c) => c.position)) + 1,
    })
    .returning()
  if (!row) throw new Error('insert calendars returned nothing')
  return calView(row)
}

export async function patchCalendar(
  db: Db,
  ctx: CalCtx,
  id: string,
  patch: { name?: string; color?: PaletteColor; hidden?: boolean; position?: number },
): Promise<CalendarView> {
  await loadCalendar(db, ctx, id, 'write')
  const [row] = await db
    .update(calendars)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(calendars.id, id))
    .returning()
  if (!row) throw AppError.notFound('日历不存在')
  return calView(row)
}

/** 删除日历连同其日程（FK 级联）；至少保留一个。 */
export async function deleteCalendar(db: Db, ctx: CalCtx, id: string): Promise<void> {
  const row = await loadCalendar(db, ctx, id, 'write')
  const [n] = await db
    .select({ n: count() })
    .from(calendars)
    .where(visibleCalendarsWhere(ctx.actor))
  if ((n?.n ?? 0) <= 1) throw AppError.validation([{ path: 'id', message: '至少保留一个日历' }])
  await db.transaction(async (tx) => {
    await tx.delete(calendars).where(eq(calendars.id, id))
    if (row.isDefault) {
      const [first] = await tx
        .select({ id: calendars.id })
        .from(calendars)
        .where(eq(calendars.ownerId, ctx.actor.id))
        .orderBy(asc(calendars.position))
        .limit(1)
      if (first)
        await tx.update(calendars).set({ isDefault: true }).where(eq(calendars.id, first.id))
    }
  })
}

// ---------- 日程 ----------

export async function listOccurrences(
  db: Db,
  ctx: CalCtx,
  from: Date,
  to: Date,
): Promise<CalendarOccurrence[]> {
  const vis = visibleCalendarEventsWhere(ctx.actor)
  const single = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        vis,
        isNull(calendarEvents.rrule),
        lt(calendarEvents.startAt, to),
        gt(calendarEvents.endAt, from),
      ),
    )
  const masters = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        vis,
        isNotNull(calendarEvents.rrule),
        lt(calendarEvents.startAt, to),
        or(isNull(calendarEvents.repeatUntil), gt(calendarEvents.repeatUntil, from)),
      ),
    )
  const out: CalendarOccurrence[] = single.map((r) => occView(r))
  for (const m of masters) {
    try {
      const starts = occurrencesBetween(
        { ...m, rrule: m.rrule as string, exdates: dates(m.exdates) },
        from,
        to,
      )
      for (const s of starts) out.push(occView(m, s))
    } catch {
      /* 损坏的 RRULE 只跳过该系列，不拖垮整页 */
    }
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.key.localeCompare(b.key))
}

async function loadEvent(db: DbOrTx, ctx: CalCtx, id: string): Promise<EvRow> {
  const [row] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), visibleCalendarEventsWhere(ctx.actor)))
    .limit(1)
  if (!row) throw AppError.notFound('日程不存在')
  assertCan(ctx.actor, 'calendar.write', row)
  return row
}

function recurFields(
  rrule: string | null | undefined,
  startAt: Date,
  endAt: Date,
  timezone: string,
): { rrule: string | null; repeatUntil: Date | null } {
  if (!rrule) return { rrule: null, repeatUntil: null }
  try {
    parseRRule(rrule)
    const clean = rrule.replace(/^RRULE:/i, '')
    return { rrule: clean, repeatUntil: seriesEnd({ startAt, endAt, timezone, rrule: clean }) }
  } catch (err) {
    throw badRule(err)
  }
}

export async function createEvent(
  db: Db,
  ctx: CalCtx,
  input: CreateCalendarEventInput,
): Promise<CalendarOccurrence> {
  await loadCalendar(db, ctx, input.calendarId, 'write')
  const startAt = new Date(input.startAt)
  const endAt = new Date(input.endAt)
  const [row] = await db
    .insert(calendarEvents)
    .values({
      workspaceId: ctx.workspaceId,
      calendarId: input.calendarId,
      ownerId: ctx.actor.id,
      title: input.title,
      location: input.location ?? null,
      notes: input.notes ?? null,
      url: input.url ?? null,
      allDay: input.allDay,
      startAt,
      endAt,
      timezone: input.timezone,
      ...recurFields(input.rrule, startAt, endAt, input.timezone),
      alarms: input.alarms ?? [],
    })
    .returning()
  if (!row) throw new Error('insert calendar_events returned nothing')
  return occView(row)
}

const stale = (row: EvRow) =>
  new AppError(409, 'CONFLICT_STALE', '日程已被修改，请刷新后重试', { current: occView(row) })

/** patch 中与「内容」相关的字段（不含控制字段）。 */
function contentOf(p: PatchCalendarEventInput) {
  const { ifUpdatedAt: _i, scope: _s, occurrenceStart: _o, ...rest } = p
  return rest
}

export async function patchEvent(
  db: Db,
  ctx: CalCtx,
  id: string,
  patch: PatchCalendarEventInput,
): Promise<CalendarOccurrence> {
  let row = await loadEvent(db, ctx, id)
  if (row.updatedAt.toISOString() !== new Date(patch.ifUpdatedAt).toISOString()) throw stale(row)
  if (patch.calendarId && patch.calendarId !== row.calendarId)
    await loadCalendar(db, ctx, patch.calendarId, 'write')
  const content = contentOf(patch)
  let scope: CalEditScope = patch.scope
  let occ = patch.occurrenceStart ? new Date(patch.occurrenceStart) : null

  // 改写行上选「将来 / 全部」→ 转到母事件
  if (row.recurrenceId && scope !== 'this') {
    occ = row.originalStartAt
    row = await loadEvent(db, ctx, row.recurrenceId)
  }
  if (!row.rrule || row.recurrenceId) scope = 'all' // 非重复或改写行本身：直接改
  if (scope !== 'all') {
    if (!occ) throw AppError.validation([{ path: 'occurrenceStart', message: '缺少发生时刻' }])
    if (!isOccurrence({ ...row, rrule: row.rrule as string, exdates: dates(row.exdates) }, occ))
      throw AppError.validation([{ path: 'occurrenceStart', message: '不是该系列中的一次发生' }])
    if (scope === 'future' && occ.getTime() === row.startAt.getTime()) scope = 'all'
  }

  const dur = row.endAt.getTime() - row.startAt.getTime()
  const now = new Date()

  if (scope === 'all') {
    let startAt = content.startAt ? new Date(content.startAt) : row.startAt
    let endAt = content.endAt ? new Date(content.endAt) : row.endAt
    // 重复系列从某次发生拖动：按偏移平移整个系列（macOS 语义）
    if (row.rrule && occ && content.startAt) {
      const delta = new Date(content.startAt).getTime() - occ.getTime()
      const newDur = content.endAt
        ? new Date(content.endAt).getTime() - new Date(content.startAt).getTime()
        : dur
      startAt = new Date(row.startAt.getTime() + delta)
      endAt = new Date(startAt.getTime() + newDur)
    } else if (content.startAt && !content.endAt) endAt = new Date(startAt.getTime() + dur)
    if (endAt <= startAt) throw AppError.validation([{ path: 'endAt', message: '结束须晚于开始' }])
    const tz = content.timezone ?? row.timezone
    const rrule = content.rrule !== undefined ? content.rrule : row.rrule
    const { rrule: _r, startAt: _s, endAt: _e, ...plain } = content
    const timeChanged =
      startAt.getTime() !== row.startAt.getTime() || (rrule ?? '') !== (row.rrule ?? '')
    const [updated] = await db.transaction(async (tx) => {
      // 时间或规则变了，旧的单次改写 / 排除不再对得上：清掉（macOS 同）
      if (row.rrule && timeChanged)
        await tx
          .update(calendarEvents)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(calendarEvents.recurrenceId, row.id), isNull(calendarEvents.deletedAt)))
      return tx
        .update(calendarEvents)
        .set({
          ...plain,
          startAt,
          endAt,
          timezone: tz,
          ...(row.recurrenceId ? {} : recurFields(rrule, startAt, endAt, tz)),
          ...(row.rrule && timeChanged ? { exdates: [] } : {}),
          updatedAt: now,
        })
        .where(eq(calendarEvents.id, row.id))
        .returning()
    })
    if (!updated) throw AppError.notFound('日程不存在')
    return occView(updated)
  }

  const occAt = occ as Date
  const startAt = content.startAt ? new Date(content.startAt) : occAt
  const endAt = content.endAt ? new Date(content.endAt) : new Date(startAt.getTime() + dur)
  if (endAt <= startAt) throw AppError.validation([{ path: 'endAt', message: '结束须晚于开始' }])
  const base = {
    workspaceId: row.workspaceId,
    calendarId: content.calendarId ?? row.calendarId,
    ownerId: row.ownerId,
    title: content.title ?? row.title,
    location: content.location !== undefined ? content.location : row.location,
    notes: content.notes !== undefined ? content.notes : row.notes,
    url: content.url !== undefined ? content.url : row.url,
    allDay: content.allDay ?? row.allDay,
    timezone: content.timezone ?? row.timezone,
    alarms: content.alarms ?? row.alarms,
    startAt,
    endAt,
  }

  if (scope === 'this') {
    const [created] = await db.transaction(async (tx) => {
      await tx
        .update(calendarEvents)
        .set({
          exdates: sql`array_append(${calendarEvents.exdates}, ${occAt.toISOString()}::timestamptz)`,
          updatedAt: now,
        })
        .where(eq(calendarEvents.id, row.id))
      return tx
        .insert(calendarEvents)
        .values({ ...base, rrule: null, recurrenceId: row.id, originalStartAt: occAt })
        .returning()
    })
    if (!created) throw new Error('insert override returned nothing')
    return occView(created)
  }

  // future：截断旧系列到 occ 之前，从 occ 起另起新系列
  const oldRule = row.rrule as string
  const truncated = truncateRRule({ ...row, rrule: oldRule }, occAt)
  const newRule = content.rrule !== undefined ? content.rrule : stripCount(oldRule)
  const [created] = await db.transaction(async (tx) => {
    await tx
      .update(calendarEvents)
      .set({
        ...(truncated
          ? recurFields(truncated, row.startAt, row.endAt, row.timezone)
          : { deletedAt: now }),
        updatedAt: now,
      })
      .where(eq(calendarEvents.id, row.id))
    await tx
      .update(calendarEvents)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(calendarEvents.recurrenceId, row.id),
          isNull(calendarEvents.deletedAt),
          sql`${calendarEvents.originalStartAt} >= ${occAt.toISOString()}::timestamptz`,
        ),
      )
    return tx
      .insert(calendarEvents)
      .values({ ...base, ...recurFields(newRule, startAt, endAt, base.timezone) })
      .returning()
  })
  if (!created) throw new Error('insert series returned nothing')
  return occView(created)
}

/** 另起新系列时去掉 COUNT（剩余次数难以对齐；保留 UNTIL）。 */
function stripCount(rrule: string): string {
  return rrule
    .split(';')
    .filter((p) => !/^COUNT=/i.test(p))
    .join(';')
}

export async function deleteEvent(
  db: Db,
  ctx: CalCtx,
  id: string,
  scopeIn: CalEditScope,
  occurrenceStart?: string,
): Promise<void> {
  let row = await loadEvent(db, ctx, id)
  let scope = scopeIn
  let occ = occurrenceStart ? new Date(occurrenceStart) : null
  const now = new Date()
  if (row.recurrenceId) {
    if (scope === 'this') {
      // 母事件已含该次 exdate：删掉改写行即可
      await db
        .update(calendarEvents)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(calendarEvents.id, row.id))
      return
    }
    occ = row.originalStartAt
    row = await loadEvent(db, ctx, row.recurrenceId)
  }
  if (!row.rrule) scope = 'all'
  if (scope !== 'all' && !occ)
    throw AppError.validation([{ path: 'occurrenceStart', message: '缺少发生时刻' }])
  if (scope === 'future' && occ && occ.getTime() <= row.startAt.getTime()) scope = 'all'

  await db.transaction(async (tx) => {
    if (scope === 'all') {
      await tx
        .update(calendarEvents)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            or(eq(calendarEvents.id, row.id), eq(calendarEvents.recurrenceId, row.id)),
            isNull(calendarEvents.deletedAt),
          ),
        )
      return
    }
    const occAt = occ as Date
    if (scope === 'this') {
      await tx
        .update(calendarEvents)
        .set({
          exdates: sql`array_append(${calendarEvents.exdates}, ${occAt.toISOString()}::timestamptz)`,
          updatedAt: now,
        })
        .where(eq(calendarEvents.id, row.id))
      return
    }
    const truncated = truncateRRule({ ...row, rrule: row.rrule as string }, occAt)
    await tx
      .update(calendarEvents)
      .set({
        ...(truncated
          ? recurFields(truncated, row.startAt, row.endAt, row.timezone)
          : { deletedAt: now }),
        updatedAt: now,
      })
      .where(eq(calendarEvents.id, row.id))
    await tx
      .update(calendarEvents)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(calendarEvents.recurrenceId, row.id),
          isNull(calendarEvents.deletedAt),
          sql`${calendarEvents.originalStartAt} >= ${occAt.toISOString()}::timestamptz`,
        ),
      )
  })
}

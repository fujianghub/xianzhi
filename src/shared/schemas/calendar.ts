/**
 * 日历 / 日程（ADR-0009；REQ-CAL-001 ~ 010；02 §9 `/calendars`、`/calendar-events`）。
 * 时刻一律 ISO 带偏移；全天事件 startAt / endAt = `timezone` 下本地零点（endAt 为结束日次日零点）。
 */
import { z } from 'zod'
import { isValidTimeZone } from '../tz.ts'
import { isoDateTime, uuidSchema } from './common.ts'
import { PALETTE_COLORS } from './enums.ts'

export const calendarColorSchema = z.enum(PALETTE_COLORS)

export const createCalendarSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: calendarColorSchema,
})
export const patchCalendarSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: calendarColorSchema.optional(),
    hidden: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少一个字段', path: ['name'] })

/** 提醒：开始前分钟数；全天事件相对当天零点，可为负（-540 = 当天 09:00）。最多 5 个。 */
export const alarmsSchema = z.array(z.number().int().min(-1440).max(10_080)).max(5)

const timezoneSchema = z.string().max(64).refine(isValidTimeZone, { message: '无效的 IANA 时区' })
const optText = (max: number) => z.string().trim().max(max).nullable().optional()

const eventFields = {
  calendarId: uuidSchema,
  title: z.string().trim().min(1).max(200),
  location: optText(200),
  notes: optText(5000),
  url: z.url().max(2000).nullable().optional(),
  allDay: z.boolean().default(false),
  startAt: isoDateTime,
  endAt: isoDateTime,
  timezone: timezoneSchema,
  /** RFC 5545 RRULE（不含 DTSTART），如 `FREQ=WEEKLY;BYDAY=MO,WE`；null = 不重复 */
  rrule: z.string().max(500).nullable().optional(),
  alarms: alarmsSchema.optional(),
}

const rangeOk = (v: { startAt?: string; endAt?: string }) =>
  !v.startAt || !v.endAt || new Date(v.endAt) > new Date(v.startAt)
const rangeMsg = { message: '结束须晚于开始', path: ['endAt'] }

export const createCalendarEventSchema = z.object(eventFields).refine(rangeOk, rangeMsg)
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>

/** 修改范围（macOS：仅此事件 / 将来所有事件 / 所有事件）；非重复事件忽略。 */
export const CAL_EDIT_SCOPES = ['this', 'future', 'all'] as const
export type CalEditScope = (typeof CAL_EDIT_SCOPES)[number]

export const patchCalendarEventSchema = z
  .object({
    ...eventFields,
    allDay: z.boolean().optional(),
  })
  .partial()
  .extend({
    ifUpdatedAt: isoDateTime,
    scope: z.enum(CAL_EDIT_SCOPES).default('all'),
    /** 重复事件：被编辑的那次发生的原始开始时刻（scope = this / future 必填） */
    occurrenceStart: isoDateTime.optional(),
  })
  .refine(rangeOk, rangeMsg)
export type PatchCalendarEventInput = z.infer<typeof patchCalendarEventSchema>

export const deleteCalendarEventQuery = z.object({
  scope: z.enum(CAL_EDIT_SCOPES).default('all'),
  occurrenceStart: isoDateTime.optional(),
})

/** 区间查询：跨度 ≤ 400 天（年视图）。 */
export const calendarEventsQuery = z
  .object({ from: isoDateTime, to: isoDateTime })
  .refine((v) => new Date(v.to) > new Date(v.from), { message: 'to 须晚于 from', path: ['to'] })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 400 * 86_400_000, {
    message: '区间跨度不得超过 400 天',
    path: ['to'],
  })

export interface CalendarView {
  id: string
  name: string
  color: (typeof PALETTE_COLORS)[number]
  hidden: boolean
  isDefault: boolean
  position: number
}

/** 一次发生（非重复事件即其本身）。`key` 在同一区间内唯一，供前端列表 key 与拖拽。 */
export interface CalendarOccurrence {
  key: string
  id: string
  calendarId: string
  title: string
  location: string | null
  notes: string | null
  url: string | null
  allDay: boolean
  startAt: string
  endAt: string
  timezone: string
  rrule: string | null
  alarms: number[]
  /** 属于重复系列（母事件展开或单次改写） */
  recurring: boolean
  /** 系列中本次的原始开始时刻（非重复为 null） */
  occurrenceStart: string | null
  /** 单次改写行 */
  isException: boolean
  updatedAt: string
}

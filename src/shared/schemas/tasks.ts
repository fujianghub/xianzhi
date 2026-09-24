import { z } from 'zod'
import { isoDate, isoDateTime, uuidSchema } from './common.ts'
import { RECURRENCE_FREQS, TASK_STATUSES } from './enums.ts'
import { liteDocSchema } from './pm.ts'
import { bool01, csv, csvText, idOrMe, pageParams, sortParam } from './query.ts'

/** 01 §3.2 recurrence；weekly 需 byWeekday，monthly 需 byMonthday，daily 二者皆无。 */
export const recurrenceSchema = z
  .strictObject({
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    byMonthday: z.number().int().min(1).max(31).optional(),
    until: isoDate.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.freq === 'weekly' && !r.byWeekday)
      ctx.addIssue({ code: 'custom', message: 'weekly 需要 byWeekday', path: ['byWeekday'] })
    if (r.freq === 'monthly' && !r.byMonthday)
      ctx.addIssue({ code: 'custom', message: 'monthly 需要 byMonthday', path: ['byMonthday'] })
    if (r.freq !== 'weekly' && r.byWeekday)
      ctx.addIssue({ code: 'custom', message: '仅 weekly 可带 byWeekday', path: ['byWeekday'] })
    if (r.freq !== 'monthly' && r.byMonthday)
      ctx.addIssue({ code: 'custom', message: '仅 monthly 可带 byMonthday', path: ['byMonthday'] })
  })
export type Recurrence = z.infer<typeof recurrenceSchema>

export const prioritySchema = z.number().int().min(0).max(4)

export const createTaskSchema = z.object({
  spaceId: uuidSchema.optional(), // 缺省落个人空间（01 §3.2）
  parentId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  descriptionPm: liteDocSchema.nullable().optional(),
  status: z.enum(TASK_STATUSES).default('inbox'),
  priority: prioritySchema.default(0),
  dueAt: isoDateTime.nullable().optional(),
  scheduledAt: isoDateTime.nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  cycleId: uuidSchema.nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  tagIds: z.array(uuidSchema).max(50).optional(),
})
export const patchTaskSchema = createTaskSchema
  .omit({ spaceId: true })
  .partial()
  .extend({
    spaceId: uuidSchema.optional(),
    sortKey: z.string().min(1).max(64).optional(),
    ifUpdatedAt: isoDateTime,
  })
export const batchTaskOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update'), id: uuidSchema, patch: patchTaskSchema }),
  z.object({ op: z.literal('complete'), id: uuidSchema }),
  z.object({ op: z.literal('delete'), id: uuidSchema }),
])
export const batchTasksSchema = z.object({ ops: z.array(batchTaskOpSchema).min(1).max(100) })

export const TASK_SORT = [
  'updatedAt',
  'createdAt',
  'dueAt',
  'priority',
  'title',
  'sortKey',
] as const
export const listTasksQuery = pageParams.extend({
  spaceId: uuidSchema.optional(),
  status: csv(TASK_STATUSES),
  assigneeId: idOrMe,
  creatorId: idOrMe,
  cycleId: uuidSchema.optional(),
  /** 子任务列表（任务详情，08 §2.7） */
  parentId: uuidSchema.optional(),
  tag: csvText, // 逗号多值，任一命中（REQ-TAG-002）
  dueBefore: isoDateTime.optional(),
  dueAfter: isoDateTime.optional(),
  q: z.string().trim().max(200).optional(),
  deleted: bool01,
  view: z.enum(['today', 'inbox']).optional(),
  due: z.enum(['today', 'week', 'overdue']).optional(),
  sort: sortParam(TASK_SORT, { field: 'updatedAt', dir: 'desc' }),
})
export const addWatcherSchema = z.object({ userId: z.string().min(1) })

export const taskIdParam = z.object({ id: uuidSchema })
export const taskWatcherParam = z.object({ id: uuidSchema, userId: z.string().min(1).max(64) })
/** complete / uncomplete 的可选请求体（空体也可）。 */
export const taskTransitionSchema = z.object({ ifUpdatedAt: isoDateTime.optional() })

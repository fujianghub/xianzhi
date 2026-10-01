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
  /** 本人名下的清单（ADR-0044）；null = 移出清单。只影响本人的归类 */
  listId: uuidSchema.nullable().optional(),
})
export const patchTaskSchema = createTaskSchema
  .omit({ spaceId: true })
  .partial()
  .extend({
    spaceId: uuidSchema.optional(),
    // create 里的 default 在 zod 4 的 partial 后仍会补值（只改标题也会把状态改回 inbox、优先级清零）：
    // PATCH 须显式无默认（debug/2026-10-01-task-patch-defaults）
    status: z.enum(TASK_STATUSES).optional(),
    priority: prioritySchema.optional(),
    sortKey: z.string().min(1).max(64).optional(),
    ifUpdatedAt: isoDateTime,
  })
export const batchTaskOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update'), id: uuidSchema, patch: patchTaskSchema }),
  z.object({ op: z.literal('complete'), id: uuidSchema }),
  z.object({ op: z.literal('delete'), id: uuidSchema }),
  /** 批量撤销（ADR-0045）：恢复软删 / 回到完成前状态（已非完成态则跳过，幂等） */
  z.object({ op: z.literal('restore'), id: uuidSchema }),
  z.object({ op: z.literal('uncomplete'), id: uuidSchema }),
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
  /** 日历区间（REQ-TASK-024）：dueAt 或 scheduledAt 落在 [from, to)；两者须同时给出，跨度 ≤ 62 天 */
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  q: z.string().trim().max(200).optional(),
  deleted: bool01,
  /** mine = 我的全部任务（ADR-0043 任务页）：指派给我或未指派且由我创建的顶层任务，可再筛 status / spaceId */
  view: z.enum(['today', 'inbox', 'mine']).optional(),
  /** 本人清单（ADR-0044）：uuid = 在该清单里；none = 不在本人任何清单里（未归类） */
  listId: z.union([uuidSchema, z.literal('none')]).optional(),
  /** tomorrow = 明天到期；next7 = 逾期或 7 天内（今天起算）到期（ADR-0044 智能清单，边界按用户时区） */
  due: z.enum(['today', 'week', 'overdue', 'tomorrow', 'next7']).optional(),
  sort: sortParam(TASK_SORT, { field: 'updatedAt', dir: 'desc' }),
})
export const addWatcherSchema = z.object({ userId: z.string().min(1) })

export const taskIdParam = z.object({ id: uuidSchema })
export const taskWatcherParam = z.object({ id: uuidSchema, userId: z.string().min(1).max(64) })
/** complete / uncomplete 的可选请求体（空体也可）。 */
/** GET /tasks/counts（ADR-0044）：可再按空间收窄 */
export const taskCountsQuery = z.object({ spaceId: uuidSchema.optional() })
export const taskTransitionSchema = z.object({ ifUpdatedAt: isoDateTime.optional() })

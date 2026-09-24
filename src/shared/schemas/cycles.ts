import { z } from 'zod'
import { isoDate, uuidSchema } from './common.ts'
import { CYCLE_KINDS, CYCLE_STATUSES } from './enums.ts'
import { pageParams, sortParam } from './query.ts'

export const goalSchema = z.strictObject({
  id: uuidSchema,
  text: z.string().trim().min(1).max(200),
  done: z.boolean().default(false),
  taskIds: z.array(uuidSchema).max(200).default([]),
})
export const goalsSchema = z.array(goalSchema).max(50)

export const createCycleSchema = z.object({
  kind: z.enum(CYCLE_KINDS),
  startDate: isoDate, // service 按 kind 归一到周一 / 月初 / 季初
  goals: goalsSchema.optional(),
})
export const patchCycleSchema = z
  .object({
    goals: goalsSchema.optional(),
    status: z.enum(CYCLE_STATUSES).optional(),
    title: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少一个字段', path: ['goals'] })
export const CYCLE_SORT = ['startDate'] as const
export const listCyclesQuery = pageParams.extend({
  kind: z.enum(CYCLE_KINDS).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  sort: sortParam(CYCLE_SORT, { field: 'startDate', dir: 'desc' }),
})
export const currentCycleQuery = z.object({ kind: z.enum(CYCLE_KINDS) })

/** 单向流转 planning → active → reviewed（REQ-CYCLE-005）。 */
export const CYCLE_TRANSITIONS: Record<string, readonly string[]> = {
  planning: ['active'],
  active: ['reviewed'],
  reviewed: [],
}

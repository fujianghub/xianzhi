import { z } from 'zod'
import { PALETTE_COLORS } from './enums.ts'

export const tagNameSchema = z.string().trim().min(1).max(40)
export const createTagSchema = z.object({ name: tagNameSchema, color: z.enum(PALETTE_COLORS) })
export const patchTagSchema = z
  .object({ name: tagNameSchema.optional(), color: z.enum(PALETTE_COLORS).optional() })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: '至少一个字段',
    path: ['name'],
  })

/** POST /tags/:id/merge（ADR-0014）：把本标签的所有关联并入目标标签后删除本标签。 */
export const mergeTagSchema = z.object({ intoId: z.uuid() })

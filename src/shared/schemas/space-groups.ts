/** 大类（ADR-0012、02 §9 /space-groups）。 */
import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { PALETTE_COLORS, type PaletteColor } from './enums.ts'
import { spaceIconSchema } from './spaces.ts'

/** 新工作区预置的大类（迁移 0010 对已有工作区同样预置）；可改名 / 删除，不会自动补回。 */
export const DEFAULT_SPACE_GROUPS: { name: string; color: PaletteColor; icon: string }[] = [
  { name: '产品开发', color: 'blue', icon: 'rocket' },
  { name: '技术学习规划', color: 'purple', icon: 'graduation-cap' },
  { name: '生活', color: 'green', icon: 'leaf' },
]

export const createSpaceGroupSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(PALETTE_COLORS).nullable().optional(),
  icon: spaceIconSchema.nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
})
export const patchSpaceGroupSchema = createSpaceGroupSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: '至少一个字段', path: ['name'] })
/** `after` = 放在哪个大类之后；null = 最前。 */
export const reorderSpaceGroupSchema = z.object({ id: uuidSchema, after: uuidSchema.nullable() })
export const spaceGroupParam = z.object({ id: uuidSchema })

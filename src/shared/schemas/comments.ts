import { z } from 'zod'
import { isoDateTime, uuidSchema } from './common.ts'
import { COMMENT_TARGET_TYPES } from './enums.ts'
import { commentDocSchema } from './pm.ts'
import { pageParams } from './query.ts'

export const createCommentSchema = z.object({
  targetType: z.enum(COMMENT_TARGET_TYPES),
  targetId: uuidSchema,
  threadId: uuidSchema.optional(), // 编辑器锚定评论带；任务评论缺省 = 首条评论 id
  parentId: uuidSchema.optional(),
  bodyPm: commentDocSchema,
})
export const patchCommentSchema = z.object({ bodyPm: commentDocSchema, ifUpdatedAt: isoDateTime })
export const listCommentsQuery = pageParams.extend({
  targetType: z.enum(COMMENT_TARGET_TYPES),
  targetId: uuidSchema,
})

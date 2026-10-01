/** 个人清单（ADR-0044、REQ-TASK-029）：02 §9 `/task-lists`。 */
import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { PALETTE_COLORS, TASK_LIST_KINDS } from './enums.ts'

/** 清单名：不含 `~ # !`（快速添加的标记符），1–40 字 */
export const taskListName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^~#!！]+$/, '名称不能含 ~ # !')

/** 每人最多（07 §5） */
export const TASK_LISTS_MAX = 200

export const createTaskListSchema = z
  .object({
    kind: z.enum(TASK_LIST_KINDS).default('list'),
    name: taskListName,
    color: z.enum(PALETTE_COLORS).optional(),
    /** 放进哪个文件夹（仅清单） */
    parentId: uuidSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'folder' && v.color)
      ctx.addIssue({ code: 'custom', message: '文件夹没有颜色', path: ['color'] })
    if (v.kind === 'folder' && v.parentId)
      ctx.addIssue({ code: 'custom', message: '文件夹不能再放进文件夹', path: ['parentId'] })
  })

export const patchTaskListSchema = z
  .object({
    name: taskListName.optional(),
    color: z.enum(PALETTE_COLORS).optional(),
    parentId: uuidSchema.nullable().optional(),
    /** 排到哪一项之后（同层）；null = 最前 */
    after: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: '至少一个字段',
    path: ['name'],
  })

export const taskListIdParam = z.object({ id: uuidSchema })

/** 自定义记录类型（ADR-0016、REQ-ENTRY-018 · 019）：/api/v1/entry-types。 */
import { z } from 'zod'
import { customStatusName } from './entryFields.ts'
import { BUILTIN_ENTRY_KINDS, PALETTE_COLORS } from './enums.ts'

export const entryTypeNameSchema = z.string().trim().min(1).max(20)
/** 有序、去重、0–12 项；空列表 = 该类型不用状态 */
export const entryTypeStatusesSchema = z
  .array(customStatusName)
  .max(12)
  .refine((a) => new Set(a).size === a.length, { message: '状态不能重复' })

export const createEntryTypeSchema = z.object({
  name: entryTypeNameSchema,
  color: z.enum(PALETTE_COLORS),
  statuses: entryTypeStatusesSchema.default([]),
})
/**
 * PATCH：改名 / 改色 / 改状态列表。`renames` 把旧状态名一对一改成新名（其下记录同步改）；
 * 改完仍不在新列表里的旧状态：记录的 status 改为新列表第一项（新列表为空 = 去掉 status）。
 */
export const patchEntryTypeSchema = z
  .object({
    name: entryTypeNameSchema.optional(),
    color: z.enum(PALETTE_COLORS).optional(),
    statuses: entryTypeStatusesSchema.optional(),
    renames: z.record(customStatusName, customStatusName).optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined || v.statuses !== undefined, {
    message: '至少一个字段',
    path: ['name'],
  })
/** PUT /entry-types/builtin/:kind：隐藏 / 显示内置类型（管理员）。 */
export const builtinKindParam = z.object({ kind: z.enum(BUILTIN_ENTRY_KINDS) })
export const setBuiltinHiddenSchema = z.object({ hidden: z.boolean() })

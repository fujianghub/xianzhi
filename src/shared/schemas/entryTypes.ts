/** 类型（ADR-0016 · 0017、REQ-ENTRY-018 ~ 020）：/api/v1/entry-types。增删改仅所有者。 */
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
/** 内置类型（ADR-0017）：改名 / 改色（null = 恢复默认）；状态流转由代码定义，不可改。 */
export const builtinKindParam = z.object({ kind: z.enum(BUILTIN_ENTRY_KINDS) })
export const patchBuiltinKindSchema = z
  .object({
    name: entryTypeNameSchema.nullable().optional(),
    color: z.enum(PALETTE_COLORS).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: '至少一个字段',
    path: ['name'],
  })
/**
 * 删除类型（内置或自定义，ADR-0017）：其下记录（含回收站）转到 `moveTo`——内置 kind 或自定义类型 id；
 * 缺省 = 随笔（删的正是随笔时必须给出）。
 */
export const deleteEntryTypeQuery = z.object({
  moveTo: z.union([z.enum(BUILTIN_ENTRY_KINDS), z.uuid()]).optional(),
})

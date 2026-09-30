/**
 * 类型（ADR-0016 · 0017 · 0036、REQ-ENTRY-018 ~ 020 · 027 · 028、REQ-KB-015）：/api/v1/entry-types。
 * 个人类型本人管理；空间类型（spaceId）由空间管理员管理；内置类型仅所有者。
 */
import { z } from 'zod'
import { customStatusName } from './entryFields.ts'
import { BUILTIN_ENTRY_KINDS, PALETTE_COLORS } from './enums.ts'
import {
  extraFieldKey,
  FIELD_DEF_TYPES,
  fieldOptionName,
  fieldOptionSchema,
  statusColorsSchema,
} from './fieldDefs.ts'

/**
 * 字段定义的输入：新字段可不带 key（服务端生成）；已有字段须带原 key，type 不可改（服务端校验）。
 * 输出 / 存储一律带 key（fieldDefSchema）。
 */
export const fieldDefInputSchema = z.object({
  key: extraFieldKey.optional(),
  label: z.string().trim().min(1).max(20),
  type: z.enum(FIELD_DEF_TYPES),
  options: z.array(fieldOptionSchema).max(30).optional(),
  required: z.boolean().optional(),
})
export const fieldDefsInputSchema = z.array(fieldDefInputSchema).max(20)
/** 选项改名（字段键 → { 旧名: 新名 }）：记录里的值同步改 */
export const optionRenamesSchema = z.record(
  extraFieldKey,
  z.record(fieldOptionName, fieldOptionName),
)

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
  statusColors: statusColorsSchema.optional(),
  fieldDefs: fieldDefsInputSchema.optional(),
  /** 给了 = 空间类型（ADR-0036，须为该空间管理员、空间可写且非个人空间）；缺省 = 个人类型 */
  spaceId: z.uuid().optional(),
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
    statusColors: statusColorsSchema.optional(),
    /** 整组替换（ADR-0036）：去掉的字段同事务清空记录里的值 */
    fieldDefs: fieldDefsInputSchema.optional(),
    optionRenames: optionRenamesSchema.optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.color !== undefined ||
      v.statuses !== undefined ||
      v.statusColors !== undefined ||
      v.fieldDefs !== undefined,
    { message: '至少一个字段', path: ['name'] },
  )
/** 内置类型（ADR-0017）：改名 / 改色（null = 恢复默认）；状态流转由代码定义，不可改。 */
export const builtinKindParam = z.object({ kind: z.enum(BUILTIN_ENTRY_KINDS) })
export const patchBuiltinKindSchema = z
  .object({
    name: entryTypeNameSchema.nullable().optional(),
    color: z.enum(PALETTE_COLORS).nullable().optional(),
    /** 追加字段（ADR-0036、REQ-ENTRY-028） */
    fieldDefs: fieldDefsInputSchema.optional(),
    optionRenames: optionRenamesSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined || v.fieldDefs !== undefined, {
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

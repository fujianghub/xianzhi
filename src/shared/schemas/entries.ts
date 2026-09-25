import { z } from 'zod'
import { isoDateTime, uuidSchema } from './common.ts'
import { entryFieldsIssues } from './entryFields.ts'
import { ENTRY_EXPORT_FORMATS, ENTRY_KINDS, ENTRY_VISIBILITIES } from './enums.ts'
import { bool01, csvText, idOrMe, pageParams, sortParam } from './query.ts'
import { templateIdSchema } from './templates.ts'

export const createEntrySchema = z
  .object({
    kind: z.enum(ENTRY_KINDS),
    title: z.string().trim().min(1).max(200),
    spaceId: uuidSchema.optional(), // 缺省落个人空间（01 §3.4）
    fields: z.record(z.string(), z.unknown()).default({}),
    // 缺省：个人空间 → private，其余 → space（REQ-ENTRY-003；service 按目标空间决定）
    visibility: z.enum(ENTRY_VISIBILITIES).optional(),
    tagIds: z.array(uuidSchema).max(50).optional(),
    // 初始正文模板（ADR-0011 §2）：`builtin:<key>` / 用户模板 uuid；`builtin:blank` = 明确空白
    templateId: templateIdSchema.optional(),
  })
  .superRefine((v, ctx) => entryFieldsIssues(v.kind, v.fields, ctx))

/** PATCH 时 fields 需与当前 kind 校验，kind 不可改；service 调用 `validateEntryFields(kind, fields)`。 */
export const patchEntrySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    visibility: z.enum(ENTRY_VISIBILITIES).optional(),
    spaceId: uuidSchema.optional(),
    pinned: z.boolean().optional(),
    tagIds: z.array(uuidSchema).max(50).optional(),
    ifUpdatedAt: isoDateTime,
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少一个字段', path: ['title'] })

export const ENTRY_SORT = ['updatedAt', 'createdAt', 'title'] as const
export const listEntriesQuery = pageParams.extend({
  spaceId: uuidSchema.optional(),
  kind: z.enum(ENTRY_KINDS).optional(),
  authorId: idOrMe,
  tag: csvText, // 逗号多值，任一命中（REQ-TAG-002）
  q: z.string().trim().max(200).optional(),
  pinned: bool01,
  archived: bool01,
  deleted: bool01,
  sort: sortParam(ENTRY_SORT, { field: 'updatedAt', dir: 'desc' }),
})
export const entryDetailQuery = z.object({ withBody: bool01 })
export const createSnapshotSchema = z.object({ label: z.string().trim().min(1).max(80) })
export const entryExportQuery = z.object({ format: z.enum(ENTRY_EXPORT_FORMATS).default('md') })

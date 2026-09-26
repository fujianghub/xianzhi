import { z } from 'zod'
import { isoDateTime, uuidSchema } from './common.ts'
import { entryFieldsIssues } from './entryFields.ts'
import { ENTRY_EXPORT_FORMATS, ENTRY_KINDS, ENTRY_VISIBILITIES } from './enums.ts'
import { bool01, csv, csvText, fieldsFilter, idOrMe, pageParams, sortParam } from './query.ts'
import { templateIdSchema } from './templates.ts'

export const createEntrySchema = z
  .object({
    kind: z.enum(ENTRY_KINDS),
    /** 自定义类型（ADR-0016）：kind = 'custom' 时必填 */
    typeId: uuidSchema.optional(),
    title: z.string().trim().min(1).max(200),
    spaceId: uuidSchema.optional(), // 缺省落个人空间（01 §3.4）
    fields: z.record(z.string(), z.unknown()).default({}),
    // 缺省：个人空间 → private，其余 → space（REQ-ENTRY-003；service 按目标空间决定）
    visibility: z.enum(ENTRY_VISIBILITIES).optional(),
    tagIds: z.array(uuidSchema).max(50).optional(),
    // 初始正文模板（ADR-0011 §2）：`builtin:<key>` / 用户模板 uuid；`builtin:blank` = 明确空白
    templateId: templateIdSchema.optional(),
    // 目录树（ADR-0012）：给出该键 = 放进目录（null = 根级；uuid = 作为其子页）；省略 = 不进目录
    parentId: uuidSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    entryFieldsIssues(v.kind, v.fields, ctx)
    customTypeIssues(v.kind, v.typeId, ctx)
  })

/** kind = 'custom' ⇔ 给出 typeId（ADR-0016）。 */
function customTypeIssues(
  kind: string | undefined,
  typeId: string | null | undefined,
  ctx: z.RefinementCtx,
) {
  if (kind === 'custom' && !typeId)
    ctx.addIssue({ code: 'custom', message: '自定义类型须给出 typeId', path: ['typeId'] })
  if (kind !== undefined && kind !== 'custom' && typeId)
    ctx.addIssue({ code: 'custom', message: '只有自定义类型带 typeId', path: ['typeId'] })
}

/**
 * PATCH：fields 按（改后的）kind 校验（service）。
 * 改类型（ADR-0016）：给 `kind`（自定义再给 `typeId`）；不给 fields 时按目标类型默认值重建，保留仍合法的 status / progress。
 */
export const patchEntrySchema = z
  .object({
    kind: z.enum(ENTRY_KINDS).optional(),
    typeId: uuidSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    visibility: z.enum(ENTRY_VISIBILITIES).optional(),
    spaceId: uuidSchema.optional(),
    pinned: z.boolean().optional(),
    tagIds: z.array(uuidSchema).max(50).optional(),
    ifUpdatedAt: isoDateTime,
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少一个字段', path: ['title'] })
  .superRefine((v, ctx) => {
    if (v.typeId && v.kind === undefined)
      ctx.addIssue({ code: 'custom', message: '改自定义类型须同时给 kind', path: ['kind'] })
    customTypeIssues(v.kind, v.typeId, ctx)
  })

export const ENTRY_SORT = ['updatedAt', 'createdAt', 'title'] as const
export const listEntriesQuery = pageParams.extend({
  spaceId: uuidSchema.optional(),
  kind: csv(ENTRY_KINDS), // 逗号多值（08 §2.8、ADR-0012 类型视图）
  // 自定义类型 id，逗号多值；与 kind 同给时为「任一命中」（ADR-0016）
  typeId: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(uuidSchema).max(50))
    .optional(),
  fields: fieldsFilter, // `status=open|fixed,severity=high`（ADR-0012）
  inTree: bool01, // 1 = 只要在目录里的，0 = 只要「其余记录」（ADR-0012）
  under: uuidSchema.optional(), // 目录子树（含该节点本身，ADR-0014）
  groupId: z.union([uuidSchema, z.literal('none')]).optional(), // 大类（none = 未分类，ADR-0014）
  favorite: bool01, // 只看本人收藏（ADR-0014）
  ids: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(uuidSchema).max(50))
    .optional(), // 最近打开：按 id 取（ADR-0014）
  authorId: idOrMe,
  tag: csvText, // 逗号多值，任一命中（REQ-TAG-002）
  q: z.string().trim().max(200).optional(),
  pinned: bool01,
  archived: bool01,
  deleted: bool01,
  sort: sortParam(ENTRY_SORT, { field: 'updatedAt', dir: 'desc' }),
})
export const entryDetailQuery = z.object({ withBody: bool01 })
/** PATCH /entries/:id/move（ADR-0012、REQ-KB-005）：移到 parentId 下、after 之后（null = 最前）；或 `{ detach: true }` 移出目录。 */
export const moveEntrySchema = z.union([
  z.object({ parentId: uuidSchema.nullable(), after: uuidSchema.nullable() }),
  z.object({ detach: z.literal(true) }),
])
export const createSnapshotSchema = z.object({ label: z.string().trim().min(1).max(80) })
/** POST /entries/batch（ADR-0014、REQ-ENTRY-013）：逐条鉴权，部分失败不回滚其它条。 */
export const batchEntriesSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('move'),
    ids: z.array(uuidSchema).min(1).max(100),
    spaceId: uuidSchema,
  }),
  z.object({
    op: z.literal('tags'),
    ids: z.array(uuidSchema).min(1).max(100),
    add: z.array(uuidSchema).max(50).default([]),
    remove: z.array(uuidSchema).max(50).default([]),
  }),
  z.object({ op: z.literal('archive'), ids: z.array(uuidSchema).min(1).max(100) }),
  z.object({ op: z.literal('unarchive'), ids: z.array(uuidSchema).min(1).max(100) }),
  z.object({ op: z.literal('delete'), ids: z.array(uuidSchema).min(1).max(100) }),
  // ADR-0016（REQ-ENTRY-017）：批量改类型 / 状态 / 进度 / 固定
  z
    .object({
      op: z.literal('retype'),
      ids: z.array(uuidSchema).min(1).max(100),
      kind: z.enum(ENTRY_KINDS),
      typeId: uuidSchema.optional(),
    })
    .superRefine((v, ctx) => customTypeIssues(v.kind, v.typeId, ctx)),
  z.object({
    op: z.literal('fields'),
    ids: z.array(uuidSchema).min(1).max(100),
    set: z
      .object({
        status: z.string().trim().min(1).max(40).optional(),
        progress: z.number().int().min(0).max(100).optional(),
      })
      .refine((v) => v.status !== undefined || v.progress !== undefined, {
        message: '至少一个字段',
        path: ['status'],
      }),
  }),
  z.object({ op: z.literal('pin'), ids: z.array(uuidSchema).min(1).max(100) }),
  z.object({ op: z.literal('unpin'), ids: z.array(uuidSchema).min(1).max(100) }),
])
export const entryExportQuery = z.object({ format: z.enum(ENTRY_EXPORT_FORMATS).default('md') })

/** 记录模板（ADR-0011 §2、02 §9 /templates）。 */
import { z } from 'zod'
import { isoDateTime, uuidSchema } from './common.ts'
import { entryFieldsIssues } from './entryFields.ts'
import { fieldDefsInputSchema, optionRenamesSchema } from './entryTypes.ts'
import { ENTRY_KINDS, SPACE_KINDS, TEMPLATE_SCOPES } from './enums.ts'
import { fullDocSchema } from './pm.ts'
import { bool01 } from './query.ts'

/** 模板 id：内置 `builtin:<key>` 或用户模板 uuid。 */
export const templateIdSchema = z.union([
  z.string().regex(/^builtin:[a-z][a-z-]{1,40}$/, '模板 id 无效'),
  uuidSchema,
])

export const listTemplatesQuery = z.object({
  kind: z.enum(ENTRY_KINDS).optional(),
  /** 绑自定义 / 空间类型的模板（ADR-0036） */
  typeId: uuidSchema.optional(),
  /** 只列已删除的代码内置模板（ADR-0038，仅所有者） */
  deleted: bool01,
  spaceKind: z.enum(SPACE_KINDS).optional(),
})

/**
 * 模板元数据（ADR-0039、REQ-TPL-016 · 017）：
 * - `fieldDefs`：模板自有字段，整组替换；已有字段须带原 key、type 不可改。新字段的 key 可省；
 *   带了也只是临时句柄（好在同一次保存里用它给新字段预填值），服务端一律换成自己生成的键。
 * - `hiddenFields`：本模板移除的类型字段名（类型的可移除内置字段或其自定义字段键）；不认识的名字静默丢弃。
 */
export const hiddenFieldsSchema = z
  .array(z.string().regex(/^[a-zA-Z]{1,40}$/, '字段名无效'))
  .max(40)
const metadata = {
  fieldDefs: fieldDefsInputSchema.optional(),
  hiddenFields: hiddenFieldsSchema.optional(),
}

const meta = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(''),
  scope: z.enum(TEMPLATE_SCOPES).default('personal'),
  spaceKind: z.enum(SPACE_KINDS).nullable().optional(),
}

/**
 * 新建：正文三选一——直接给 `body`；`fromEntryId`（另存为模板：取该记录当前正文与 kind / fields）；
 * `fromTemplateId`（复制到我的，ADR-0023：内置或可见模板 → 新模板，未给 kind / fields 时沿用原模板）。
 */
export const createTemplateSchema = z
  .object({
    ...meta,
    kind: z.enum(ENTRY_KINDS).optional(),
    /** kind = custom 时必给（ADR-0036、REQ-TPL-011） */
    typeId: uuidSchema.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    ...metadata,
    body: fullDocSchema.optional(),
    fromEntryId: uuidSchema.optional(),
    fromTemplateId: templateIdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if ([v.body, v.fromEntryId, v.fromTemplateId].filter(Boolean).length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'body / fromEntryId / fromTemplateId 三选一',
        path: ['body'],
      })
    if (v.body && !v.kind) ctx.addIssue({ code: 'custom', message: '需要 kind', path: ['kind'] })
    if (v.kind && (v.kind === 'custom') !== !!v.typeId)
      ctx.addIssue({ code: 'custom', message: '自定义类型须给 typeId', path: ['typeId'] })
    if (v.kind && v.fields) entryFieldsIssues(v.kind, v.fields, ctx)
  })

/**
 * 修改（ADR-0023）：元信息 + 正文 / 类型 / fields；乐观锁 `ifUpdatedAt`（02 §4，不匹配 409 CONFLICT_STALE）。
 * fields 按「新 kind ?? 原 kind」在 service 内校验；只改 kind 不给 fields → 重置为该 kind 默认值。
 */
export const patchTemplateSchema = z
  .object({
    name: meta.name.optional(),
    description: z.string().trim().max(200).optional(),
    scope: z.enum(TEMPLATE_SCOPES).optional(),
    spaceKind: z.enum(SPACE_KINDS).nullable().optional(),
    kind: z.enum(ENTRY_KINDS).optional(),
    typeId: uuidSchema.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    ...metadata,
    /** 选项改名（字段键 → { 旧名: 新名 }）：用此模板建的记录里的值同步改 */
    optionRenames: optionRenamesSchema.optional(),
    body: fullDocSchema.optional(),
    ifUpdatedAt: isoDateTime,
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少一个字段', path: ['name'] })
  .refine((v) => !v.kind || (v.kind === 'custom') === !!v.typeId, {
    message: '自定义类型须给 typeId',
    path: ['typeId'],
  })

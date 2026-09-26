/** 记录模板（ADR-0011 §2、02 §9 /templates）。 */
import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { entryFieldsIssues } from './entryFields.ts'
import { BUILTIN_ENTRY_KINDS, SPACE_KINDS, TEMPLATE_SCOPES } from './enums.ts'
import { fullDocSchema } from './pm.ts'

/** 模板 id：内置 `builtin:<key>` 或用户模板 uuid。 */
export const templateIdSchema = z.union([
  z.string().regex(/^builtin:[a-z][a-z-]{1,40}$/, '模板 id 无效'),
  uuidSchema,
])

export const listTemplatesQuery = z.object({
  kind: z.enum(BUILTIN_ENTRY_KINDS).optional(),
  spaceKind: z.enum(SPACE_KINDS).optional(),
})

const meta = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(''),
  scope: z.enum(TEMPLATE_SCOPES).default('personal'),
  spaceKind: z.enum(SPACE_KINDS).nullable().optional(),
}

/** 新建：正文二选一——直接给 `body`，或 `fromEntryId`（另存为模板：取该记录当前正文与 kind / fields）。 */
export const createTemplateSchema = z
  .object({
    ...meta,
    kind: z.enum(BUILTIN_ENTRY_KINDS).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    body: fullDocSchema.optional(),
    fromEntryId: uuidSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.body === !v.fromEntryId)
      ctx.addIssue({ code: 'custom', message: 'body 与 fromEntryId 二选一', path: ['body'] })
    if (v.body && !v.kind) ctx.addIssue({ code: 'custom', message: '需要 kind', path: ['kind'] })
    if (v.kind && v.fields) entryFieldsIssues(v.kind, v.fields, ctx)
  })

export const patchTemplateSchema = z
  .object({
    name: meta.name.optional(),
    description: z.string().trim().max(200).optional(),
    scope: z.enum(TEMPLATE_SCOPES).optional(),
    spaceKind: z.enum(SPACE_KINDS).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少一个字段', path: ['name'] })

/**
 * `entries.fields` 按 kind 的元数据 schema（01 §3.5；REQ-ENTRY-001）。strict：未知键 → 422。
 * 叙述性内容在正文模板（03 §6），不进 fields。
 */
import { z } from 'zod'
import { isoDate, uuidSchema } from './common.ts'
import { ENTRY_KINDS, type EntryKind } from './enums.ts'

export const decisionFields = z.strictObject({
  status: z.enum(['proposed', 'accepted', 'superseded', 'rejected']),
  supersedesId: uuidSchema.optional(),
  decidedAt: isoDate.optional(),
})
export const bugFields = z.strictObject({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'fixed', 'wontfix']),
  commit: z.string().trim().min(1).max(64).optional(),
  debugDir: z.string().trim().min(1).max(200).optional(),
})
export const iterationFields = z
  .strictObject({
    periodStart: isoDate,
    periodEnd: isoDate,
    version: z.string().trim().min(1).max(40).optional(),
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: 'periodEnd 不能早于 periodStart',
    path: ['periodEnd'],
  })
export const changelogFields = z.strictObject({
  version: z.string().trim().min(1).max(40),
  releasedAt: isoDate,
})
export const reviewFields = z.strictObject({ cycleId: uuidSchema })
export const journalFields = z.strictObject({
  mood: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
})
export const noteFields = z.strictObject({})

export const entryFieldsByKind = {
  decision: decisionFields,
  bug: bugFields,
  iteration: iterationFields,
  changelog: changelogFields,
  review: reviewFields,
  journal: journalFields,
  note: noteFields,
} as const satisfies Record<EntryKind, z.ZodType>

export type EntryFields<K extends EntryKind = EntryKind> = z.infer<(typeof entryFieldsByKind)[K]>

export function entryFieldsSchemaFor(kind: EntryKind): z.ZodType {
  return entryFieldsByKind[kind]
}

/**
 * 把 fields 校验结果并入外层 ctx：path 以 `fields.` 开头（REQ-ENTRY-001 `errors[].path = fields.severity`）；
 * strictObject 的 unrecognized_keys 展开为每个未知键一条。
 */
export function entryFieldsIssues(kind: EntryKind, fields: unknown, ctx: z.RefinementCtx): void {
  const r = entryFieldsByKind[kind].safeParse(fields)
  if (r.success) return
  for (const i of r.error.issues) {
    if (i.code === 'unrecognized_keys') {
      for (const k of i.keys)
        ctx.addIssue({ code: 'custom', message: `未知字段 ${k}`, path: ['fields', ...i.path, k] })
    } else ctx.addIssue({ ...i, path: ['fields', ...i.path] })
  }
}

/** `{ kind, fields }` 联合校验。 */
export const kindWithFieldsSchema = z
  .object({ kind: z.enum(ENTRY_KINDS), fields: z.record(z.string(), z.unknown()).default({}) })
  .superRefine((v, ctx) => entryFieldsIssues(v.kind, v.fields, ctx))

/** 每种 kind 的空默认 fields（新建记录未填时用）。 */
export const defaultEntryFields: Record<EntryKind, Record<string, unknown>> = {
  decision: { status: 'proposed' },
  bug: { severity: 'medium', status: 'open' },
  iteration: {}, // 必填 periodStart/periodEnd 由前端补
  changelog: {},
  review: {},
  journal: {},
  note: {},
}

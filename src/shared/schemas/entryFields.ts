/**
 * `entries.fields` 按 kind 的元数据 schema（01 §3.5；REQ-ENTRY-001）。strict：未知键 → 422。
 * 叙述性内容在正文模板（03 §6），不进 fields。
 */
import { z } from 'zod'
import { isoDate, uuidSchema } from './common.ts'
import { ENTRY_KINDS, type EntryKind, TRACKED_ENTRY_FIELDS } from './enums.ts'
import { splitExtraFields } from './fieldDefs.ts'

/**
 * 跨字段检查（日期先后）。单列出来，好在 ADR-0042 按内置字段覆盖层把部分字段改为可选时，
 * 重新套在 partial 形状上（zod 4 不允许对带 refine 的对象 `.partial()`）。缺值不查。
 */
interface CrossCheck {
  ok: (v: Record<string, unknown>) => boolean
  message: string
  path: string[]
}
const ordered = (a: string, b: string, message: string): CrossCheck => ({
  ok: (v) => !v[a] || !v[b] || String(v[a]) <= String(v[b]),
  message,
  path: [b],
})
const CROSS_CHECKS: Partial<Record<EntryKind, CrossCheck[]>> = {
  bug: [ordered('foundAt', 'resolvedAt', '解决日期不能早于发现日期')],
  iteration: [ordered('periodStart', 'periodEnd', 'periodEnd 不能早于 periodStart')],
  plan: [ordered('startDate', 'endDate', 'endDate 不能早于 startDate')],
}
function withChecks<T extends z.ZodType>(s: T, kind: EntryKind): T {
  let out = s
  for (const c of CROSS_CHECKS[kind] ?? [])
    out = out.refine((v) => c.ok(v as Record<string, unknown>), {
      message: c.message,
      path: c.path,
    }) as T
  return out
}

export const decisionFields = z.strictObject({
  status: z.enum(['proposed', 'accepted', 'superseded', 'rejected']),
  supersedesId: uuidSchema.optional(),
  decidedAt: isoDate.optional(),
})
/** Bug 状态（ADR-0033）：新建 · 待决策 · 已修复 · 不修复；定义顺序 = 看板列顺序。 */
export const BUG_STATUSES = ['new', 'pending', 'fixed', 'wontfix'] as const
/** 已关闭（进入即写 resolvedAt）；其余为未关闭。 */
export const BUG_CLOSED_STATUSES: readonly string[] = ['fixed', 'wontfix']
export const BUG_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const
/** 可作分组 / 统计的文本属性值：不含 `, | =`（列表筛选参数的分隔符）。 */
const filterableText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^,|=]+$/, '不能含 , | =')
const bugShape = z.strictObject({
  status: z.enum(BUG_STATUSES),
  /** 优先级；缺省由服务端补 p2（旧客户端 / MCP 不传也不 422） */
  priority: z.enum(BUG_PRIORITIES).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  /** 发现日期；缺省由服务端补为操作者时区的今天（ADR-0033） */
  foundAt: isoDate.optional(),
  /** 解决日期；服务端维护：进入已关闭写入，回到未关闭清除 */
  resolvedAt: isoDate.optional(),
  module: filterableText(40).optional(),
  commit: z.string().trim().min(1).max(64).optional(),
  debugDir: z.string().trim().min(1).max(200).optional(),
})
export const bugFields = withChecks(bugShape, 'bug')
const iterationShape = z.strictObject({
  periodStart: isoDate,
  periodEnd: isoDate,
  version: z.string().trim().min(1).max(40).optional(),
})
export const iterationFields = withChecks(iterationShape, 'iteration')
export const changelogFields = z.strictObject({
  version: z.string().trim().min(1).max(40),
  releasedAt: isoDate,
})
export const reviewFields = z.strictObject({ cycleId: uuidSchema })
export const journalFields = z.strictObject({
  mood: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
})
export const noteFields = z.strictObject({})
/** 产品优化（ADR-0011 §3）：状态 + 衡量指标与目标值。 */
export const optimizeFields = z.strictObject({
  status: z.enum(['proposed', 'planned', 'doing', 'shipped', 'dropped']),
  metric: z.string().trim().min(1).max(120).optional(),
  target: z.string().trim().min(1).max(120).optional(),
})
/** 学习计划（ADR-0011 §3）：状态、起止与进度百分比。 */
const planShape = z.strictObject({
  status: z.enum(['planning', 'active', 'paused', 'done']),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  progress: z.number().int().min(0).max(100).optional(),
})
export const planFields = withChecks(planShape, 'plan')

/**
 * 自定义类型（ADR-0016）：状态（取值 ∈ 该类型的状态列表，service 校验）、进度百分比、截止日。
 * 状态名不含 `, | =`（列表筛选参数的分隔符）。
 */
export const customStatusName = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[^,|=]+$/, '状态名不能含 , | =')
export const customFields = z.strictObject({
  status: customStatusName.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  dueDate: isoDate.optional(),
})

export const entryFieldsByKind = {
  decision: decisionFields,
  bug: bugFields,
  iteration: iterationFields,
  changelog: changelogFields,
  review: reviewFields,
  journal: journalFields,
  note: noteFields,
  optimize: optimizeFields,
  plan: planFields,
  custom: customFields,
} as const satisfies Record<EntryKind, z.ZodType>

export type EntryFields<K extends EntryKind = EntryKind> = z.infer<(typeof entryFieldsByKind)[K]>

/** 不带跨字段检查的形状（`.partial()` 用） */
const SHAPES: Record<EntryKind, z.ZodObject> = {
  ...entryFieldsByKind,
  bug: bugShape,
  iteration: iterationShape,
  plan: planShape,
}

/** 内置字段名（代码定义的顺序） */
export function baseFieldNames(kind: EntryKind): string[] {
  return Object.keys(SHAPES[kind].shape)
}

/**
 * kind 的 fields schema；`optional` 里的字段改为可选（ADR-0042：隐藏的必填字段不再必填）。
 * 仍是 strict（未知键报错），跨字段检查照旧（缺值不查）。
 */
export function entryFieldsSchema(kind: EntryKind, optional: readonly string[] = []): z.ZodType {
  const shape = SHAPES[kind]
  const mask = Object.fromEntries(optional.filter((k) => k in shape.shape).map((k) => [k, true]))
  if (!Object.keys(mask).length) return entryFieldsByKind[kind]
  return withChecks(shape.partial(mask as never), kind)
}

/**
 * 把 fields 校验结果并入外层 ctx：path 以 `fields.` 开头（REQ-ENTRY-001 `errors[].path = fields.severity`）；
 * strictObject 的 unrecognized_keys 展开为每个未知键一条。
 * 路由层不知道工作区的内置字段覆盖（ADR-0042：隐藏的必填字段可省），故这里不查「必填缺失」，
 * 只查未知键与已给出的值；必填由 service 按覆盖层校验（同一 `fields.<key>` 路径）。
 */
export function entryFieldsIssues(
  kind: EntryKind,
  fields: unknown,
  ctx: z.RefinementCtx,
  /** 连同必填一起查（不经 service 的完整校验，如 `kindWithFieldsSchema`） */
  opts: { requireAll?: boolean } = {},
): void {
  // 自定义字段（x 键，ADR-0036）按类型的字段定义在 service 校验；这里只校验内置字段
  const base =
    fields && typeof fields === 'object' && !Array.isArray(fields)
      ? splitExtraFields(fields as Record<string, unknown>).base
      : fields
  const r = (
    opts.requireAll ? entryFieldsByKind[kind] : entryFieldsSchema(kind, baseFieldNames(kind))
  ).safeParse(base)
  if (r.success) return
  for (const i of r.error.issues) {
    if (i.code === 'unrecognized_keys') {
      for (const k of i.keys)
        ctx.addIssue({ code: 'custom', message: `未知字段 ${k}`, path: ['fields', ...i.path, k] })
    } else ctx.addIssue({ ...i, path: ['fields', ...i.path] })
  }
}

/** `{ kind, fields }` 联合校验（按代码默认，含必填；不含工作区覆盖）。 */
export const kindWithFieldsSchema = z
  .object({ kind: z.enum(ENTRY_KINDS), fields: z.record(z.string(), z.unknown()).default({}) })
  .superRefine((v, ctx) => entryFieldsIssues(v.kind, v.fields, ctx, { requireAll: true }))

/** 每种 kind 的空默认 fields（新建记录未填时用）。 */
export const defaultEntryFields: Record<EntryKind, Record<string, unknown>> = {
  decision: { status: 'proposed' },
  bug: { status: 'new', priority: 'p2', severity: 'medium' },
  iteration: {}, // 必填 periodStart/periodEnd 由前端补
  changelog: {},
  review: {},
  journal: {},
  note: {},
  optimize: { status: 'proposed' },
  plan: { status: 'active' },
  custom: {}, // 状态默认取该类型状态列表第一项（service）
}

/** 服务端维护的字段（Bug 的发现 / 解决日期，ADR-0033）：模板既不预填也不能移除 */
const SERVER_KEPT_FIELDS: readonly string[] = ['foundAt', 'resolvedAt']

/**
 * 模板可以从自己的元数据里移除的内置字段名（ADR-0039、REQ-TPL-017）：该类型的可省字段，
 * 去掉进流转的（状态 / 优先级 / 严重度——统计、看板靠它们）与服务端维护的日期。必填字段不可移除。
 */
export function hideableBaseFields(kind: EntryKind): string[] {
  const shape = (entryFieldsByKind[kind] as unknown as { shape: Record<string, z.ZodType> }).shape
  return Object.entries(shape)
    .filter(
      ([k, s]) =>
        s.safeParse(undefined).success &&
        !(TRACKED_ENTRY_FIELDS as readonly string[]).includes(k) &&
        !SERVER_KEPT_FIELDS.includes(k),
    )
    .map(([k]) => k)
}

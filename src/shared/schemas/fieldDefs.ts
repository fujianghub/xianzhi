/**
 * 类型的字段定义（ADR-0036、REQ-ENTRY-027）：自定义类型 / 空间类型的属性，及内置类型追加的属性。
 * 值存在 `entries.fields` 顶层、键为系统生成的 `x` + 6 位大写字母（与内置键不会重名，筛选 / 统计 / 排序复用 fields 键）。
 */
import { z } from 'zod'
import { PALETTE_COLORS } from './enums.ts'

export const FIELD_DEF_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'url',
  'progress',
] as const
export type FieldDefType = (typeof FIELD_DEF_TYPES)[number]

/** 自定义字段键：`x` + 6 位大写字母 */
export const EXTRA_FIELD_KEY_RE = /^x[A-Z]{6}$/
export const isExtraFieldKey = (k: string) => EXTRA_FIELD_KEY_RE.test(k)
export const extraFieldKey = z.string().regex(EXTRA_FIELD_KEY_RE, '字段键无效')

/** 选项名：不含 `, | =`（列表筛选参数的分隔符），与自定义状态名同规则 */
export const fieldOptionName = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[^,|=]+$/, '选项名不能含 , | =')

export const fieldOptionSchema = z.object({
  name: fieldOptionName,
  color: z.enum(PALETTE_COLORS),
})

export const fieldDefSchema = z
  .object({
    key: extraFieldKey,
    label: z.string().trim().min(1).max(20),
    type: z.enum(FIELD_DEF_TYPES),
    /** 单选 / 多选的选项（有序、去重） */
    options: z.array(fieldOptionSchema).max(30).optional(),
    /** 必填只作提示（红色「必填」），不拦写入——避免批量 / 改类型卡死 */
    required: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const choice = v.type === 'select' || v.type === 'multiselect'
    if (choice && !v.options?.length)
      ctx.addIssue({ code: 'custom', message: '单选 / 多选至少一个选项', path: ['options'] })
    if (!choice && v.options?.length)
      ctx.addIssue({ code: 'custom', message: '只有单选 / 多选有选项', path: ['options'] })
    const names = v.options?.map((o) => o.name) ?? []
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: 'custom', message: '选项不能重复', path: ['options'] })
  })
export type FieldDef = z.infer<typeof fieldDefSchema>
export type FieldOption = z.infer<typeof fieldOptionSchema>

export const fieldDefsSchema = z
  .array(fieldDefSchema)
  .max(20)
  .superRefine((defs, ctx) => {
    const keys = defs.map((d) => d.key)
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: '字段键不能重复', path: [] })
    const labels = defs.map((d) => d.label)
    if (new Set(labels).size !== labels.length)
      ctx.addIssue({ code: 'custom', message: '字段名不能重复', path: [] })
  })

/** 状态 / 选项颜色：名 → 色板色 */
export const statusColorsSchema = z.record(z.string(), z.enum(PALETTE_COLORS))

/** 按字段定义校验单个值；返回错误消息或 null。null / undefined / '' 视为「未填」由调用方处理。 */
export function extraValueError(def: FieldDef, v: unknown): string | null {
  switch (def.type) {
    case 'text':
      return typeof v === 'string' && v.length <= 500 ? null : '须为 500 字以内的文本'
    case 'url':
      return typeof v === 'string' && v.length <= 2000 && /^https?:\/\/\S+$/.test(v)
        ? null
        : '须为 http(s) 链接'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : '须为数字'
    case 'progress':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100
        ? null
        : '须为 0–100 的整数'
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : '须为日期'
    case 'checkbox':
      return typeof v === 'boolean' ? null : '须为勾选值'
    case 'select':
      return typeof v === 'string' && def.options?.some((o) => o.name === v) ? null : '不是可选的值'
    case 'multiselect':
      return Array.isArray(v) &&
        v.length <= 30 &&
        v.every((x) => typeof x === 'string' && def.options?.some((o) => o.name === x))
        ? null
        : '不是可选的值'
  }
}

/** 从 fields 里分出自定义字段（x 键）与内置字段 */
export function splitExtraFields(fields: Record<string, unknown>): {
  base: Record<string, unknown>
  extra: Record<string, unknown>
} {
  const base: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) (isExtraFieldKey(k) ? extra : base)[k] = v
  return { base, extra }
}

/** 生成不与已有键重复的新字段键 */
export function newExtraFieldKey(existing: readonly string[], rand = Math.random): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (;;) {
    let k = 'x'
    for (let i = 0; i < 6; i++) k += A[Math.floor(rand() * 26)]
    if (!existing.includes(k)) return k
  }
}

/** 选项改名表：字段键 → { 旧名: 新名 } */
export type OptionRenames = Record<string, Record<string, string>>

/**
 * 字段定义变更后迁移一份 fields 里的值（与服务端对记录做的 SQL 同规则，ADR-0036 §11 · ADR-0039）：
 * 去掉的字段清值；选项改名同步；不在新选项里的值清掉（单选去键、多选去该项，空了去键）。
 * 只动 `prev` 里有的键，其余原样保留。
 */
export function migrateExtraValues(
  fields: Record<string, unknown>,
  prev: FieldDef[],
  next: FieldDef[],
  renames: OptionRenames = {},
): Record<string, unknown> {
  const out = { ...fields }
  for (const old of prev) {
    if (!(old.key in out)) continue
    const cur = next.find((d) => d.key === old.key)
    if (!cur) {
      delete out[old.key]
      continue
    }
    if (cur.type !== 'select' && cur.type !== 'multiselect') continue
    const names = new Set((cur.options ?? []).map((o) => o.name))
    const map = renames[old.key] ?? {}
    const rename = (v: string) => {
      const to = map[v]
      return to !== undefined && names.has(to) ? to : v
    }
    const v = out[old.key]
    if (cur.type === 'select') {
      const nv = typeof v === 'string' ? rename(v) : v
      if (typeof nv === 'string' && names.has(nv)) out[old.key] = nv
      else delete out[old.key]
    } else {
      const arr = Array.isArray(v) ? [...new Set(v.map((x) => rename(String(x))))] : []
      const kept = arr.filter((x) => names.has(x))
      if (kept.length) out[old.key] = kept
      else delete out[old.key]
    }
  }
  return out
}

/** 合并两组字段定义（类型的在前；同键以前者为准）：记录的有效自定义字段 = 类型字段 + 来源模板的字段（ADR-0039） */
export function mergeFieldDefs(first: FieldDef[], second: FieldDef[]): FieldDef[] {
  if (!second.length) return first
  const keys = new Set(first.map((d) => d.key))
  return [...first, ...second.filter((d) => !keys.has(d.key))]
}

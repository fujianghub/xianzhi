/**
 * 内置字段覆盖层（ADR-0042、REQ-ENTRY-034 ~ 037）：内置类型的代码字段可隐藏、改显示名、排序；
 * 枚举字段的选项可改显示名 / 色、可隐藏。字段键与选项值不变（筛选 / 统计 / 流转照旧），
 * 隐藏只影响展示与编辑，记录里的值保留。工作区统一、仅所有者维护（`entry_kind_overrides`）。
 */
import { z } from 'zod'
import {
  baseFieldNames,
  defaultEntryFields,
  entryFieldsByKind,
  entryFieldsSchema,
} from './entryFields.ts'
import { type BuiltinEntryKind, type EntryKind, PALETTE_COLORS } from './enums.ts'
import type { FieldDef } from './fieldDefs.ts'

const displayLabel = z.string().trim().min(1).max(20)

export const baseOptionOverrideSchema = z.strictObject({
  label: displayLabel.optional(),
  color: z.enum(PALETTE_COLORS).optional(),
  hidden: z.boolean().optional(),
})
export const baseFieldOverrideSchema = z.strictObject({
  hidden: z.boolean().optional(),
  label: displayLabel.optional(),
  /** 选项值（数字值按字符串）→ 覆盖 */
  options: z.record(z.string().max(40), baseOptionOverrideSchema).optional(),
})
/** 字段名 → 覆盖；键在 service 里按 kind 校验 */
export const baseFieldsSchema = z.record(
  z.string().regex(/^[a-z][A-Za-z]{0,39}$/),
  baseFieldOverrideSchema,
)
/** 属性顺序：内置字段名与追加字段 x 键混排；未列出的按代码顺序排在后面 */
export const fieldOrderSchema = z.array(z.string().max(40)).max(80)

export type BaseOptionOverride = z.infer<typeof baseOptionOverrideSchema>
export type BaseFieldOverride = z.infer<typeof baseFieldOverrideSchema>
export type BaseFieldOverrides = Record<string, BaseFieldOverride>

/** 代码字段目录（由 Zod shape 反射得出；仅覆盖 entryFields 用到的类型） */
export interface BaseFieldInfo {
  name: string
  kind: 'select' | 'date' | 'text' | 'number'
  options: (string | number)[]
  /** 代码里是否必填（覆盖层隐藏后不再必填） */
  required: boolean
}

interface Def {
  type: string
  innerType?: z.ZodType
  entries?: Record<string, string>
  options?: z.ZodType[]
  values?: unknown[]
  format?: string
}
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def

export function baseFieldCatalog(kind: EntryKind): BaseFieldInfo[] {
  const shape = (entryFieldsByKind[kind] as unknown as { shape: Record<string, z.ZodType> }).shape
  return Object.entries(shape).map(([name, raw]): BaseFieldInfo => {
    let s = raw
    let required = true
    while (['optional', 'default', 'nullable'].includes(defOf(s).type)) {
      required = false
      s = defOf(s).innerType as z.ZodType
    }
    const d = defOf(s)
    if (d.type === 'enum')
      return { name, kind: 'select', options: Object.values(d.entries ?? {}), required }
    if (d.type === 'union' && d.options?.every((o) => defOf(o).type === 'literal'))
      return {
        name,
        kind: 'select',
        options: d.options.flatMap((o) => (defOf(o).values ?? []) as (string | number)[]),
        required,
      }
    if (d.type === 'number') return { name, kind: 'number', options: [], required }
    const isDate = d.format === 'date' || /date$|Date$|At$|Start$|End$/.test(name)
    return { name, kind: isDate ? 'date' : 'text', options: [], required }
  })
}

/** 被隐藏的内置字段名 */
export function hiddenBaseFields(ov: BaseFieldOverrides | null | undefined): string[] {
  return Object.entries(ov ?? {})
    .filter(([, o]) => o.hidden)
    .map(([k]) => k)
}

/**
 * 按覆盖层补值：隐藏的必填字段未给值、而该类型有默认值 → 补默认（Bug 状态 / 严重度等，
 * 统计 / 看板 / 流转仍有值可依）；没有默认值的（迭代起止、变更版本等）改为可选，不补。
 */
export function fillHiddenDefaults(
  kind: EntryKind,
  base: Record<string, unknown>,
  ov: BaseFieldOverrides | null | undefined,
): Record<string, unknown> {
  const out = { ...base }
  const defaults = defaultEntryFields[kind]
  for (const k of hiddenBaseFields(ov))
    if (out[k] === undefined && defaults[k] !== undefined) out[k] = defaults[k]
  return out
}

/**
 * 该类型的默认 fields（隐藏的必填字段按覆盖层补默认 / 可省）能否通过校验：
 * 能 = 可作批量改类型 / 删类型的转入目标（没有要人填的必填属性）。
 */
export function defaultsSatisfy(kind: EntryKind, ov: BaseFieldOverrides | null | undefined) {
  return entryFieldsSchema(kind, hiddenBaseFields(ov)).safeParse(
    fillHiddenDefaults(kind, defaultEntryFields[kind], ov),
  ).success
}

export interface BaseFieldIssue {
  path: string
  message: string
}

/**
 * 覆盖输入 → 存储（service 调用）：校验字段名 / 选项值属于该 kind、默认值选项不可隐藏、
 * 每个枚举至少留一个可见选项、显示名与其它字段（含追加字段）不重复；去掉空项。
 * 返回规范化后的覆盖或问题列表。
 */
export function normalizeBaseFields(
  kind: BuiltinEntryKind,
  input: BaseFieldOverrides,
  extraDefs: readonly FieldDef[],
): { value: BaseFieldOverrides; issues: BaseFieldIssue[] } {
  const catalog = new Map(baseFieldCatalog(kind).map((f) => [f.name, f]))
  const defaults = defaultEntryFields[kind]
  const issues: BaseFieldIssue[] = []
  const value: BaseFieldOverrides = {}
  for (const [name, o] of Object.entries(input)) {
    const path = `baseFields.${name}`
    const info = catalog.get(name)
    if (!info) {
      issues.push({ path, message: `该类型没有字段 ${name}` })
      continue
    }
    const next: BaseFieldOverride = {}
    if (o.hidden) next.hidden = true
    if (o.label) next.label = o.label
    if (o.options && Object.keys(o.options).length) {
      if (info.kind !== 'select') {
        issues.push({ path: `${path}.options`, message: '只有选项字段能改选项' })
        continue
      }
      const values = info.options.map(String)
      const opts: Record<string, BaseOptionOverride> = {}
      for (const [v, oo] of Object.entries(o.options)) {
        if (!values.includes(v)) {
          issues.push({ path: `${path}.options.${v}`, message: `没有选项 ${v}` })
          continue
        }
        if (oo.hidden && defaults[name] !== undefined && String(defaults[name]) === v) {
          issues.push({ path: `${path}.options.${v}`, message: '默认值选项不能隐藏' })
          continue
        }
        const c: BaseOptionOverride = {}
        if (oo.label) c.label = oo.label
        if (oo.color) c.color = oo.color
        if (oo.hidden) c.hidden = true
        if (Object.keys(c).length) opts[v] = c
      }
      if (values.every((v) => opts[v]?.hidden))
        issues.push({ path: `${path}.options`, message: '至少留一个可见选项' })
      if (Object.keys(opts).length) next.options = opts
    }
    if (Object.keys(next).length) value[name] = next
  }
  const labels = [
    ...Object.values(value).flatMap((o) => (o.label ? [o.label] : [])),
    ...extraDefs.map((d) => d.label),
  ]
  const dup = labels.find((l, i) => labels.indexOf(l) !== i)
  if (dup) issues.push({ path: 'baseFields', message: `字段名「${dup}」重复` })
  return { value, issues }
}

/** 顺序规范化：只留该类型的内置字段名与追加字段键，去重 */
export function normalizeFieldOrder(
  kind: EntryKind,
  order: readonly string[],
  extraDefs: readonly FieldDef[],
): string[] {
  const ok = new Set([...baseFieldNames(kind), ...extraDefs.map((d) => d.key)])
  return [...new Set(order)].filter((k) => ok.has(k))
}

/** 按 `fieldOrder` 排序（稳定；未列出的保持原相对顺序排在后面） */
export function sortByFieldOrder<T>(
  items: readonly T[],
  keyOf: (t: T) => string,
  order: readonly string[] | null | undefined,
): T[] {
  if (!order?.length) return [...items]
  const rank = new Map(order.map((k, i) => [k, i]))
  return items
    .map((t, i) => ({ t, i, r: rank.get(keyOf(t)) ?? order.length + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t)
}

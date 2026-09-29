/**
 * kind 元数据表单（08 §2.9、T1-013）：由 `entryFieldsByKind[kind]` 的 Zod shape 生成——
 * enum / 字面量联合 → 下拉；日期 → date 输入；数字 → number 输入；其余 → 文本。前端不重复校验，422 的 `fields.x` 错误就地显示（REQ-ENTRY-001）。
 * 自定义类型（ADR-0016）：状态下拉的选项 = 该类型的状态列表（原样显示，不翻译）；列表为空则不出状态项。
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'
import { BUG_CLOSED_STATUSES, entryFieldsByKind } from '../../../shared/schemas/entryFields.ts'
import { type EntryKind, entryStatsQuery } from '../../lib/entry-queries.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { Input } from '../ui/input.tsx'

type Spec =
  | {
      name: string
      kind: 'select'
      options: (string | number)[]
      required: boolean
      /** 选项是用户自定义文字（自定义类型的状态），不走 i18n */
      raw?: boolean
    }
  | { name: string; kind: 'date' | 'text' | 'number'; required: boolean }

interface Def {
  type: string
  innerType?: z.ZodType
  entries?: Record<string, string>
  options?: z.ZodType[]
  values?: unknown[]
  format?: string
}
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def

/** Zod shape → 表单项规格（仅覆盖 entryFields 用到的类型）。 */
export function fieldSpecs(kind: EntryKind, statuses?: string[] | null): Spec[] {
  const shape = (entryFieldsByKind[kind] as unknown as { shape: Record<string, z.ZodType> }).shape
  if (kind === 'custom')
    return [
      ...(statuses?.length
        ? [
            {
              name: 'status',
              kind: 'select',
              options: statuses,
              required: false,
              raw: true,
            } as const,
          ]
        : []),
      { name: 'progress', kind: 'number', required: false },
      { name: 'dueDate', kind: 'date', required: false },
    ]
  return Object.entries(shape).map(([name, raw]) => {
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
    if (d.type === 'number') return { name, kind: 'number', required }
    const isDate = d.format === 'date' || /date$|Date$|At$|Start$|End$/.test(name)
    return { name, kind: isDate ? 'date' : 'text', required }
  })
}

/** 新建对话框里 Bug 只填这些（ADR-0033 快速提 Bug）；状态默认新建、发现日期服务端补，其余在属性栏补。 */
export const QUICK_FIELDS: Partial<Record<EntryKind, string[]>> = {
  bug: ['priority', 'severity', 'module'],
}

export function EntryFieldsForm({
  kind,
  typeId,
  value,
  onChange,
  errors,
  disabled,
  only,
}: {
  kind: EntryKind
  typeId?: string | null
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  errors?: Record<string, string>
  disabled?: boolean
  /** 只显示这些字段（新建对话框的精简属性） */
  only?: string[]
}) {
  const { t } = useTranslation()
  const specs = fieldSpecs(kind, useKindLabel()(kind, typeId).statuses).filter(
    (f) =>
      (!only || only.includes(f.name)) &&
      // 解决日期只在已关闭时显示（服务端维护，ADR-0033）
      !(kind === 'bug' && f.name === 'resolvedAt' && !isBugClosed(value.status)),
  )
  const modules = useBugModules(kind === 'bug' && specs.some((f) => f.name === 'module'))
  if (!specs.length) return null
  const set = (name: string, v: unknown) => {
    const next = { ...value }
    if (v === '' || v === undefined) delete next[name]
    else next[name] = v
    onChange(next)
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="entry-fields">
      {specs.map((f) => {
        const id = `field-${f.name}`
        const err = errors?.[f.name]
        const cur = value[f.name]
        return (
          <label key={f.name} htmlFor={id} className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted text-xs">
              {t(`entry.field.${f.name}`)}
              {f.required ? ' *' : ''}
            </span>
            {f.kind === 'select' ? (
              <select
                id={id}
                disabled={disabled}
                value={cur === undefined ? '' : String(cur)}
                onChange={(e) => {
                  const raw = e.target.value
                  const opt = f.options.find((o) => String(o) === raw)
                  set(f.name, raw === '' ? undefined : opt)
                }}
                className="h-9 rounded-md border border-border bg-surface px-2"
                aria-invalid={!!err}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {typeof o === 'number' || f.raw
                      ? o
                      : t(`entry.fieldValue.${o}`, { defaultValue: o })}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                list={f.name === 'module' && modules.length ? 'bug-modules' : undefined}
                type={f.kind === 'text' ? 'text' : f.kind}
                disabled={disabled}
                value={cur === undefined ? '' : String(cur)}
                onChange={(e) =>
                  set(
                    f.name,
                    f.kind === 'number' && e.target.value !== ''
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
                aria-invalid={!!err}
              />
            )}
            {err ? (
              <span
                className="text-danger text-xs"
                role="alert"
                data-testid={`field-error-${f.name}`}
              >
                {err}
              </span>
            ) : null}
          </label>
        )
      })}
      {modules.length ? (
        <datalist id="bug-modules">
          {modules.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

const isBugClosed = (s: unknown) => BUG_CLOSED_STATUSES.includes(String(s))

/** 本人可见 Bug 已用过的模块（按使用次数），作输入候选。 */
function useBugModules(enabled: boolean): string[] {
  const { data } = useQuery({
    ...entryStatsQuery({ kind: 'bug', groupBy: 'module' }),
    enabled,
    staleTime: 60_000,
  })
  return (data?.groups ?? []).flatMap((g) => (g.values.module ? [g.values.module] : []))
}

/** ApiError.problem.errors → { 字段名: 消息 }（只取 fields.* 路径）。 */
export function fieldErrors(errors: { path: string; message: string }[] | undefined) {
  const out: Record<string, string> = {}
  for (const e of errors ?? []) if (e.path.startsWith('fields.')) out[e.path.slice(7)] = e.message
  return out
}

/**
 * kind 元数据表单（08 §2.9、T1-013）：由 `entryFieldsByKind[kind]` 的 Zod shape 生成——
 * enum / 字面量联合 → 下拉；日期 → date 输入；其余 → 文本。前端不重复校验，422 的 `fields.x` 错误就地显示（REQ-ENTRY-001）。
 */
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'
import { entryFieldsByKind } from '../../../shared/schemas/entryFields.ts'
import type { EntryKind } from '../../lib/entry-queries.ts'
import { Input } from '../ui/input.tsx'

type Spec =
  | { name: string; kind: 'select'; options: (string | number)[]; required: boolean }
  | { name: string; kind: 'date' | 'text'; required: boolean }

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
export function fieldSpecs(kind: EntryKind): Spec[] {
  const shape = (entryFieldsByKind[kind] as unknown as { shape: Record<string, z.ZodType> }).shape
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
    const isDate = d.format === 'date' || /date$|At$|Start$|End$/.test(name)
    return { name, kind: isDate ? 'date' : 'text', required }
  })
}

export function EntryFieldsForm({
  kind,
  value,
  onChange,
  errors,
  disabled,
}: {
  kind: EntryKind
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  errors?: Record<string, string>
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const specs = fieldSpecs(kind)
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
                    {typeof o === 'number' ? o : t(`entry.fieldValue.${o}`, { defaultValue: o })}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                type={f.kind === 'date' ? 'date' : 'text'}
                disabled={disabled}
                value={cur === undefined ? '' : String(cur)}
                onChange={(e) => set(f.name, e.target.value)}
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
    </div>
  )
}

/** ApiError.problem.errors → { 字段名: 消息 }（只取 fields.* 路径）。 */
export function fieldErrors(errors: { path: string; message: string }[] | undefined) {
  const out: Record<string, string> = {}
  for (const e of errors ?? []) if (e.path.startsWith('fields.')) out[e.path.slice(7)] = e.message
  return out
}

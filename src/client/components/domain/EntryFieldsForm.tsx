/**
 * kind 元数据表单（08 §2.9、T1-013）：由 `entryFieldsByKind[kind]` 的 Zod shape 生成——
 * enum / 字面量联合 → 下拉；日期 → date 输入；数字 → number 输入；其余 → 文本。前端不重复校验，422 的 `fields.x` 错误就地显示（REQ-ENTRY-001）。
 * 自定义类型（ADR-0016）：状态下拉的选项 = 该类型的状态列表（原样显示，不翻译）；列表为空则不出状态项。
 * 模板元数据（ADR-0039）：给了 `template`（新建对话框里选中的模板）→ 去掉它移除的类型字段、追加它的自有字段。
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { baseFieldCatalog, sortByFieldOrder } from '../../../shared/schemas/baseFields.ts'
import { BUG_CLOSED_STATUSES } from '../../../shared/schemas/entryFields.ts'
import { type FieldDef, mergeFieldDefs } from '../../../shared/schemas/fieldDefs.ts'
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

/**
 * 代码字段目录（ADR-0042：由 shared `baseFieldCatalog` 反射 Zod shape；不含覆盖层）。
 * 业务展示一律走 `useFieldSpecs`（套上隐藏 / 显示名 / 选项覆盖与顺序）；这里只给目录与设置页用。
 */
export function fieldSpecs(kind: EntryKind, statuses?: string[] | null): Spec[] {
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
  return baseFieldCatalog(kind).map((f) =>
    f.kind === 'select'
      ? { name: f.name, kind: 'select', options: f.options, required: f.required }
      : { name: f.name, kind: f.kind, required: f.required },
  )
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
  template,
}: {
  kind: EntryKind
  typeId?: string | null
  /** 所选模板的元数据（ADR-0039）：移除的类型字段只在模板所绑类型与当前类型一致时生效 */
  template?: {
    kind: string
    typeId: string | null
    fieldDefs: FieldDef[]
    hiddenFields: string[]
  } | null
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  errors?: Record<string, string>
  disabled?: boolean
  /** 只显示这些字段（新建对话框的精简属性） */
  only?: string[]
}) {
  const { t } = useTranslation()
  const meta = useKindLabel()(kind, typeId)
  const removed =
    template && template.kind === kind && (template.typeId ?? null) === (typeId ?? null)
      ? template.hiddenFields
      : []
  // 类型的自定义字段（ADR-0036）+ 模板自有字段（ADR-0039）：精简模式（only）不显示
  const extras = only
    ? []
    : mergeFieldDefs(
        meta.fieldDefs.filter((d) => !removed.includes(d.key)),
        template?.fieldDefs ?? [],
      )
  // 代码字段覆盖（ADR-0042）：隐藏的不出现，显示名 / 选项名取覆盖，按属性顺序
  const ov = meta.baseFields
  const specs = sortByFieldOrder(
    fieldSpecs(kind, meta.statuses),
    (f) => f.name,
    meta.fieldOrder,
  ).filter(
    (f) =>
      !ov[f.name]?.hidden &&
      (!only || only.includes(f.name)) &&
      (f.required || !removed.includes(f.name)) &&
      // 解决日期只在已关闭时显示（服务端维护，ADR-0033）
      !(kind === 'bug' && f.name === 'resolvedAt' && !isBugClosed(value.status)),
  )
  const modules = useBugModules(kind === 'bug' && specs.some((f) => f.name === 'module'))
  if (!specs.length && !extras.length) return null
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
              {ov[f.name]?.label ?? t(`entry.field.${f.name}`)}
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
                {f.options
                  .filter(
                    (o) => !ov[f.name]?.options?.[String(o)]?.hidden || String(o) === String(cur),
                  )
                  .map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {ov[f.name]?.options?.[String(o)]?.label ??
                        (typeof o === 'number' || f.raw
                          ? o
                          : t(`entry.fieldValue.${o}`, { defaultValue: o }))}
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
      {extras.map((d) => (
        <ExtraField
          key={d.key}
          def={d}
          value={value[d.key]}
          error={errors?.[d.key]}
          disabled={disabled}
          onChange={(v) => set(d.key, v)}
        />
      ))}
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

/** 自定义字段输入（ADR-0036、REQ-ENTRY-027）：id = `field-<key>`，与内置字段同一形态 */
function ExtraField({
  def,
  value,
  error,
  disabled,
  onChange,
}: {
  def: FieldDef
  value: unknown
  error?: string
  disabled?: boolean
  onChange: (v: unknown) => void
}) {
  const id = `field-${def.key}`
  const ctl = 'h-9 rounded-md border border-border bg-surface px-2'
  const input = (() => {
    switch (def.type) {
      case 'select':
        return (
          <select
            id={id}
            disabled={disabled}
            value={value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
            className={ctl}
            aria-invalid={!!error}
          >
            <option value="">—</option>
            {(def.options ?? []).map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        )
      case 'multiselect': {
        const cur = Array.isArray(value) ? value.map(String) : []
        return (
          <span id={id} className="flex flex-wrap gap-x-3 gap-y-1 py-1">
            {(def.options ?? []).map((o) => (
              <label key={o.name} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={cur.includes(o.name)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? (def.options ?? [])
                          .map((x) => x.name)
                          .filter((n) => n === o.name || cur.includes(n))
                      : cur.filter((n) => n !== o.name)
                    onChange(next.length ? next : undefined)
                  }}
                />
                {o.name}
              </label>
            ))}
          </span>
        )
      }
      case 'checkbox':
        return (
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked || undefined)}
            className="size-4 self-start"
          />
        )
      default: {
        const numeric = def.type === 'number' || def.type === 'progress'
        return (
          <Input
            id={id}
            type={
              def.type === 'date'
                ? 'date'
                : numeric
                  ? 'number'
                  : def.type === 'url'
                    ? 'url'
                    : 'text'
            }
            min={def.type === 'progress' ? 0 : undefined}
            max={def.type === 'progress' ? 100 : undefined}
            disabled={disabled}
            value={value === undefined ? '' : String(value)}
            onChange={(e) =>
              onChange(
                e.target.value === ''
                  ? undefined
                  : numeric
                    ? Number(e.target.value)
                    : e.target.value,
              )
            }
            aria-invalid={!!error}
          />
        )
      }
    }
  })()
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm" data-field={def.key}>
      <span className="text-fg-muted text-xs">
        {def.label}
        {def.required ? ' *' : ''}
      </span>
      {input}
      {error ? (
        <span className="text-danger text-xs" role="alert" data-testid={`field-error-${def.key}`}>
          {error}
        </span>
      ) : null}
    </label>
  )
}

/** 本人可见 Bug 已用过的模块（按使用次数），作输入候选。 */
export function useBugModules(enabled: boolean): string[] {
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

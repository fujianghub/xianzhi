/**
 * 元数据的统一展示与就地编辑（ADR-0035 §B–D、REQ-ENTRY-024 · 026、REQ-UI-044）：
 * - `useFieldSpecs`：类型 → 字段规格（内置字段由 Zod shape 推出；自定义类型 / 追加字段由字段定义给出，ADR-0036）；
 *   每个选项带显示名与色（状态 / 优先级 / 严重度按语义色，自定义选项取类型里设的色，否则按位置轮换）。
 * - `FieldValue`：只读彩色展示（胶囊 / 日期胶囊 / 进度条 / 勾选 / 链接），记录页属性面板、表格、看板、卡片共用。
 * - `FieldEditor`：点值弹出的编辑器（选项列表带色点 / 日期月历 / 数字 / 文本），提交即回调，由调用方 PATCH。
 */

import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  CalendarDays,
  Check,
  CheckSquare,
  CircleDot,
  Flag,
  Gauge,
  Hash,
  Layers,
  Link2,
  ListChecks,
  type LucideIcon,
  RefreshCw,
  Smile,
  Tag as TagIcon,
  Target,
  TriangleAlert,
  Type,
} from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sortByFieldOrder } from '../../../shared/schemas/baseFields.ts'
import type { PaletteColor } from '../../../shared/schemas/enums.ts'
import type { FieldDef } from '../../../shared/schemas/fieldDefs.ts'
import { cn } from '../../lib/cn.ts'
import type { EntryKind } from '../../lib/entry-queries.ts'
import { type KindMeta, useKindLabel } from '../../lib/entry-types.ts'
import { dateTone, isClosedStatus, progressTone, valueTone } from '../../lib/field-tones.ts'
import { typeTemplateFields } from '../../lib/template-fields.ts'
import { templateFieldsQuery, useTemplateMetaOf } from '../../lib/template-queries.ts'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { useUserTimeZone } from '../ui/relative-time.tsx'
import { DateFieldPicker } from './DateFieldPicker.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'
import { toneClass } from './KindIcon.tsx'

export type FieldKind =
  | 'select'
  | 'multiselect'
  | 'date'
  | 'text'
  | 'number'
  | 'checkbox'
  | 'url'
  | 'progress'

export interface FieldOptionSpec {
  value: string | number
  label: string
  tone: PaletteColor
  /** 被覆盖层隐藏的选项（ADR-0042）：选择器 / 筛选 / 看板空列不列，已有的值照常显示 */
  hidden?: boolean
}
export interface FieldSpec {
  name: string
  label: string
  kind: FieldKind
  options: FieldOptionSpec[]
  required: boolean
  /** 字段定义给出的自定义字段（x 键，ADR-0036） */
  extra: boolean
}

/** 字段图标：按名 / 类型取，未知退回类型图标 */
const NAME_ICON: Record<string, LucideIcon> = {
  status: CircleDot,
  priority: Flag,
  severity: TriangleAlert,
  module: Layers,
  version: TagIcon,
  mood: Smile,
  cycleId: RefreshCw,
  supersedesId: Link2,
  metric: Target,
  target: Target,
  commit: Hash,
}
const KIND_ICON: Record<FieldKind, LucideIcon> = {
  select: CircleDot,
  multiselect: ListChecks,
  date: CalendarDays,
  text: Type,
  number: Hash,
  checkbox: CheckSquare,
  url: Link2,
  progress: Gauge,
}
export const fieldIcon = (s: Pick<FieldSpec, 'name' | 'kind' | 'extra'>): LucideIcon =>
  (!s.extra && NAME_ICON[s.name]) || KIND_ICON[s.kind]

/** 字段定义 → 规格（自定义字段 / 追加字段） */
export function defSpec(d: FieldDef): FieldSpec {
  const opts = d.options ?? []
  return {
    name: d.key,
    label: d.label,
    kind: d.type,
    options: opts.map((o) => ({ value: o.name, label: o.name, tone: o.color })),
    required: !!d.required,
    extra: true,
  }
}

/** 模板元数据里与字段规格有关的部分（目录项，或模板表单里未保存的草稿） */
export interface TemplateSpecMeta {
  kind: string
  typeId: string | null
  fieldDefs: FieldDef[]
  hiddenFields: string[]
}

/**
 * 类型的字段规格套上模板元数据（ADR-0039、REQ-ENTRY-032）：去掉模板移除的类型字段，追加模板自有字段。
 * 移除清单只在记录类型与模板所绑类型一致时生效（记录改过类型后，同名字段在新类型里可能是必填的）；
 * 必填字段不会被去掉。模板自有字段与类型无关，始终追加（同键以类型的为准）。
 */
export function withTemplateSpecs(
  specs: FieldSpec[],
  tpl: TemplateSpecMeta | undefined,
  kind: string,
  typeId?: string | null,
): FieldSpec[] {
  if (!tpl) return specs
  const sameType = tpl.kind === kind && (tpl.typeId ?? null) === (typeId ?? null)
  const kept = sameType
    ? specs.filter((f) => f.required || !tpl.hiddenFields.includes(f.name))
    : specs
  const have = new Set(specs.map((f) => f.name))
  return [...kept, ...tpl.fieldDefs.filter((d) => !have.has(d.key)).map(defSpec)]
}

/** 选择器里可选的选项：去掉隐藏的，但当前值即使隐藏也保留 */
export const pickableOptions = (spec: FieldSpec, current?: unknown): FieldOptionSpec[] =>
  spec.options.filter((o) => !o.hidden || String(o.value) === String(current))

/**
 * 代码字段 → 规格（ADR-0042）：套上显示名 / 选项名与色 / 选项隐藏；`includeHidden` 为设置页保留被隐藏的字段。
 * 内置规格不含追加字段与模板元数据（见 `useFieldSpecs`）。
 */
export function baseSpecsOf(
  kind: EntryKind,
  meta: KindMeta,
  t: TFunction,
  opts: { includeHidden?: boolean } = {},
): FieldSpec[] {
  const ov = meta.baseFields
  return fieldSpecs(kind, meta.statuses)
    .filter((f) => opts.includeHidden || !ov[f.name]?.hidden)
    .map((f) => {
      const label = ov[f.name]?.label ?? t(`entry.field.${f.name}`)
      if (f.kind !== 'select') {
        return {
          name: f.name,
          label,
          kind: f.name === 'progress' ? 'progress' : f.kind,
          options: [],
          required: f.required,
          extra: false,
        }
      }
      const raw = !!f.raw
      const custom = raw ? { options: f.options.map(String), colors: meta.statusColors } : undefined
      return {
        name: f.name,
        label,
        kind: 'select',
        options: f.options.map((o) => {
          const oo = ov[f.name]?.options?.[String(o)]
          return {
            value: o,
            label:
              oo?.label ??
              (raw || typeof o === 'number'
                ? f.name === 'mood'
                  ? t(`entry.mood.${o}`, { defaultValue: String(o) })
                  : String(o)
                : t(`entry.fieldValue.${o}`, { defaultValue: String(o) })),
            tone: (oo?.color as PaletteColor | undefined) ?? valueTone(f.name, o, custom),
            ...(oo?.hidden ? { hidden: true } : {}),
          }
        }),
        required: f.required,
        extra: false,
      }
    })
}

/**
 * (kind, typeId, templateId?) → 字段规格：内置字段（套代码字段覆盖，ADR-0042；进度改为 progress 类型）+
 * 追加 / 自定义字段，按属性顺序排列；给了来源模板（记录的 `templateId`）再套上模板元数据。
 * 自定义状态：选项色取类型的 statusColors，未设按位置轮换。
 */
export function useFieldSpecs() {
  const { t } = useTranslation()
  const kindOf = useKindLabel()
  const tplOf = useTemplateMetaOf()
  return useCallback(
    (kind: EntryKind, typeId?: string | null, templateId?: string | null): FieldSpec[] => {
      const meta = kindOf(kind, typeId)
      const all = sortByFieldOrder(
        [...baseSpecsOf(kind, meta, t), ...meta.fieldDefs.map(defSpec)],
        (f) => f.name,
        meta.fieldOrder,
      )
      return withTemplateSpecs(all, tplOf(templateId), kind, typeId)
    },
    [kindOf, t, tplOf],
  )
}

/**
 * 某类型下可作条件的模板属性规格（ADR-0040 · 0041、REQ-ENTRY-033 · REQ-BUG-013）：记录页筛选 / 分组与查询块设置共用。
 * 来源 = 绑该类型的模板（按元数据目录，不看已加载的行）；`keep` = 正在用的键，即使其模板不绑该类型也保留；
 * 与类型字段或别的模板属性同名时标签带模板名。
 */
export function useTypeTemplateSpecs() {
  const { t } = useTranslation()
  const { data } = useQuery(templateFieldsQuery)
  return useCallback(
    (
      type: { kind: string; typeId: string | null } | null,
      typeSpecs: readonly FieldSpec[],
      keep: readonly string[] = [],
    ): FieldSpec[] =>
      type
        ? typeTemplateFields(data ?? [], type, typeSpecs, keep).map((f) => ({
            ...defSpec(f.def),
            label:
              f.ambiguous && f.template
                ? t('entry.templateField', { label: f.def.label, template: f.template })
                : f.def.label,
          }))
        : [],
    [data, t],
  )
}

/** 操作者时区的今天（YYYY-MM-DD） */
export function useToday(): string {
  const { tz } = useUserTimeZone()
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

/** 彩色胶囊（状态 / 选项 / 文本值共用 .xz-kind-badge + 色调类） */
export function Pill({
  tone,
  children,
  className,
  dot,
  ...rest
}: {
  tone: PaletteColor
  children: ReactNode
  className?: string
  /** 前置实色圆点（状态类） */
  dot?: boolean
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      className={cn('xz-kind-badge h-6 gap-1.5 px-2 text-xs', toneClass(tone), className)}
      {...rest}
    >
      {dot ? <span className="xz-pill-dot" aria-hidden /> : null}
      {children}
    </span>
  )
}

export function StatusPill({
  value,
  spec,
  size = 'md',
}: {
  value: string
  spec?: FieldSpec
  size?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  const opt = spec?.options.find((o) => String(o.value) === value)
  return (
    <Pill
      tone={opt?.tone ?? valueTone('status', value)}
      dot
      className={size === 'sm' ? 'h-5 px-1.5 text-[11px]' : undefined}
      data-status={value}
    >
      {opt?.label ?? t(`entry.fieldValue.${value}`, { defaultValue: value })}
    </Pill>
  )
}

export function ProgressBar({ value }: { value: number }) {
  const { t } = useTranslation()
  const v = Math.max(0, Math.min(100, value))
  return (
    <span
      className={cn('inline-flex items-center gap-2', toneClass(progressTone(v)))}
      data-testid="entry-progress"
    >
      <span
        className="relative h-1.5 w-16 overflow-hidden rounded-full bg-active"
        role="progressbar"
        aria-label={t('entry.list.progress')}
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="xz-progress-fill absolute inset-y-0 left-0" style={{ width: `${v}%` }} />
      </span>
      <span className="text-(--k-fg) text-xs tabular-nums">{v}%</span>
    </span>
  )
}

/** 日期胶囊：日历图标 + 月日（跨年带年），色按字段角色与临近程度（REQ-UI-044） */
export function DateChip({
  field,
  value,
  closed,
  size = 'md',
}: {
  field: string
  value: string
  closed?: boolean
  size?: 'sm' | 'md'
}) {
  const today = useToday()
  const tone = dateTone(field, value, today, closed)
  const sameYear = value.slice(0, 4) === today.slice(0, 4)
  const text = `${sameYear ? '' : `${value.slice(0, 4)}/`}${+value.slice(5, 7)}/${+value.slice(8, 10)}`
  return (
    <Pill
      tone={tone}
      className={size === 'sm' ? 'h-5 px-1.5 text-[11px]' : undefined}
      data-date={value}
      data-tone={tone}
    >
      <CalendarDays className="size-3" aria-hidden />
      <time dateTime={value} title={value}>
        {text}
      </time>
    </Pill>
  )
}

/**
 * 只读展示某字段的值；空值显示「—」（或属性面板里的「空」占位由调用方给 `empty`）。
 * `fields` 为整条记录的 fields（判断是否已关闭、截止日不再告警）。
 */
export function FieldValue({
  spec,
  value,
  fields,
  statuses,
  size = 'md',
  empty,
}: {
  spec: FieldSpec
  value: unknown
  fields?: Record<string, unknown>
  /** 自定义类型的状态列表（判断「已完成」） */
  statuses?: string[] | null
  size?: 'sm' | 'md'
  empty?: ReactNode
}) {
  const { t } = useTranslation()
  if (isEmpty(value)) return <>{empty ?? <span className="text-fg-faint">—</span>}</>
  const small = size === 'sm' ? 'h-5 px-1.5 text-[11px]' : undefined
  switch (spec.kind) {
    case 'select': {
      if (spec.name === 'status')
        return <StatusPill value={String(value)} spec={spec} size={size} />
      const opt = spec.options.find((o) => String(o.value) === String(value))
      return (
        <Pill tone={opt?.tone ?? 'gray'} className={small} data-value={String(value)}>
          {spec.name === 'priority' ? <Flag className="size-3" aria-hidden /> : null}
          {opt?.label ?? String(value)}
        </Pill>
      )
    }
    case 'multiselect': {
      const vs = Array.isArray(value) ? value.map(String) : [String(value)]
      return (
        <span className="inline-flex flex-wrap gap-1">
          {vs.map((v) => (
            <Pill
              key={v}
              tone={spec.options.find((o) => o.value === v)?.tone ?? 'gray'}
              className={small}
              data-value={v}
            >
              {v}
            </Pill>
          ))}
        </span>
      )
    }
    case 'date':
      return (
        <DateChip
          field={spec.name}
          value={String(value)}
          closed={isClosedStatus(fields?.status, statuses)}
          size={size}
        />
      )
    case 'progress':
      return typeof value === 'number' ? <ProgressBar value={value} /> : null
    case 'checkbox':
      return value ? (
        <Pill tone="green" className={small}>
          <Check className="size-3" aria-hidden />
          {t('field.yes')}
        </Pill>
      ) : (
        <span className="text-fg-faint">{t('field.no')}</span>
      )
    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-64 items-center gap-1 truncate text-primary-text hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <Link2 className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{String(value).replace(/^https?:\/\//, '')}</span>
        </a>
      )
    case 'number':
      return <span className="tabular-nums">{String(value)}</span>
    default:
      // 模块 / 版本等短文本：中性胶囊；长文本原样
      return String(value).length <= 24 ? (
        <Pill tone="gray" className={small}>
          {String(value)}
        </Pill>
      ) : (
        <span className="line-clamp-2">{String(value)}</span>
      )
  }
}

/**
 * 点值弹出的编辑器。`onCommit(undefined)` = 清空。勾选类直接切换，不弹。
 * `trigger` 是一个可聚焦的元素（按钮）；只读时调用方不要包 FieldEditor。
 */
export function FieldEditor({
  spec,
  value,
  onCommit,
  trigger,
  suggestions,
  align = 'start',
  dateMin,
  dateMax,
}: {
  spec: FieldSpec
  value: unknown
  onCommit: (v: unknown) => void
  trigger: ReactNode
  /** 文本字段的候选（如 Bug 模块） */
  suggestions?: string[]
  align?: 'start' | 'center' | 'end'
  /** 日期字段的可选范围（含端点，`dateBounds()` 推出，ADR-0056） */
  dateMin?: string
  dateMax?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const commit = (v: unknown) => {
    onCommit(isEmpty(v) ? undefined : v)
    setOpen(false)
  }
  if (spec.kind === 'checkbox')
    return (
      <span
        onClickCapture={(e) => {
          e.preventDefault()
          onCommit(!value || undefined)
        }}
      >
        {trigger}
      </span>
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn(spec.kind === 'date' ? 'w-64' : 'w-60', 'p-1.5')}
        data-testid={`field-editor-${spec.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        {spec.kind === 'select' ? (
          <div role="listbox" aria-label={spec.label} className="flex flex-col gap-0.5">
            {pickableOptions(spec, value).map((o) => {
              const on = String(o.value) === String(value)
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-value={String(o.value)}
                  onClick={() => commit(o.value)}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover',
                    on && 'bg-selected',
                  )}
                >
                  <Pill
                    tone={o.tone}
                    dot={spec.name === 'status'}
                    className="h-5 px-1.5 text-[11px]"
                  >
                    {o.label}
                  </Pill>
                  {on ? <Check className="ms-auto size-3.5 text-primary-text" aria-hidden /> : null}
                </button>
              )
            })}
            {spec.required ? null : (
              <ClearButton onClick={() => commit(undefined)} disabled={isEmpty(value)} />
            )}
          </div>
        ) : spec.kind === 'date' ? (
          <DateFieldPicker
            name={spec.name}
            label={spec.label}
            value={value}
            required={spec.required}
            min={dateMin}
            max={dateMax}
            onCommit={commit}
          />
        ) : spec.kind === 'multiselect' ? (
          <MultiEditor
            spec={spec}
            value={value}
            onCommit={(v) => onCommit(isEmpty(v) ? undefined : v)}
          />
        ) : (
          <InputEditor
            spec={spec}
            value={value}
            onCommit={commit}
            suggestions={suggestions}
            clearLabel={t('field.clear')}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function ClearButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-1 h-8 rounded-md border-divider border-t px-2 text-left text-fg-muted text-xs hover:bg-hover disabled:opacity-50"
      data-testid="field-clear"
    >
      {t('field.clear')}
    </button>
  )
}

function MultiEditor({
  spec,
  value,
  onCommit,
}: {
  spec: FieldSpec
  value: unknown
  onCommit: (v: string[]) => void
}) {
  const cur = Array.isArray(value) ? value.map(String) : []
  return (
    <div
      role="listbox"
      aria-multiselectable
      aria-label={spec.label}
      className="flex flex-col gap-0.5"
    >
      {spec.options.map((o) => {
        const on = cur.includes(String(o.value))
        return (
          <button
            key={String(o.value)}
            type="button"
            role="option"
            aria-selected={on}
            data-value={String(o.value)}
            onClick={() =>
              onCommit(
                on
                  ? cur.filter((v) => v !== o.value)
                  : spec.options
                      .map((x) => String(x.value))
                      .filter((v) => v === o.value || cur.includes(v)),
              )
            }
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover"
          >
            <span
              className={cn(
                'grid size-4 place-items-center rounded border border-border',
                on && 'border-primary bg-primary text-primary-fg',
              )}
              aria-hidden
            >
              {on ? <Check className="size-3" /> : null}
            </span>
            <Pill tone={o.tone} className="h-5 px-1.5 text-[11px]">
              {o.label}
            </Pill>
          </button>
        )
      })}
    </div>
  )
}

function InputEditor({
  spec,
  value,
  onCommit,
  suggestions,
  clearLabel,
}: {
  spec: FieldSpec
  value: unknown
  onCommit: (v: unknown) => void
  suggestions?: string[]
  clearLabel: string
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(isEmpty(value) ? '' : String(value))
  const numeric = spec.kind === 'number' || spec.kind === 'progress'
  const parse = (s: string): unknown => {
    if (s.trim() === '') return undefined
    if (!numeric) return s.trim()
    const n = Number(s)
    if (!Number.isFinite(n)) return value
    return spec.kind === 'progress' ? Math.max(0, Math.min(100, Math.round(n))) : n
  }
  const listId = suggestions?.length ? `field-sugg-${spec.name}` : undefined
  return (
    <form
      className="flex flex-col gap-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        onCommit(parse(draft))
      }}
    >
      <Input
        autoFocus
        aria-label={spec.label}
        type={numeric ? 'number' : spec.kind === 'url' ? 'url' : 'text'}
        min={spec.kind === 'progress' ? 0 : undefined}
        max={spec.kind === 'progress' ? 100 : undefined}
        value={draft}
        list={listId}
        onChange={(e) => setDraft(e.target.value)}
        data-testid={`field-input-${spec.name}`}
      />
      {listId ? (
        <datalist id={listId}>
          {suggestions?.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {spec.kind === 'progress' ? (
        <div className="flex gap-1">
          {[0, 25, 50, 75, 100].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onCommit(n)}
              className="h-7 flex-1 rounded-md bg-surface-2 text-xs tabular-nums hover:bg-hover"
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        <button
          type="submit"
          className="h-7 rounded-md px-2 text-primary-text text-xs hover:bg-hover"
        >
          {t('field.save')}
        </button>
        {spec.required ? null : (
          <button
            type="button"
            onClick={() => onCommit(undefined)}
            disabled={isEmpty(value)}
            className="ms-auto h-7 rounded-md px-2 text-fg-muted text-xs hover:bg-hover disabled:opacity-50"
            data-testid="field-clear"
          >
            {clearLabel}
          </button>
        )}
      </div>
    </form>
  )
}

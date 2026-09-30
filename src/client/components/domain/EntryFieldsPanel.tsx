/**
 * 记录页属性面板（ADR-0035 · 0037、REQ-ENTRY-024 · 025 · 030 · 031）：标题下常显的紧凑属性列表。
 * - 每行 = 淡色属性名 · 彩色值；点值弹出编辑器，选定即保存（useFieldCommit 串行 PATCH）；只读时只显示。
 * - 空的非必填属性默认收起为一行「+ 显示 N 个空属性」（只读者不显示空属性）；必填缺失标红。
 * - 标签是列表里普通的一行（个人标签，ADR-0017）；Bug 的解决日期只在已关闭时出现（服务端维护）。
 * - 流转缩成列表下一行摘要（次数 · 最近一次变化 · 时间），点开弹层看按事件分组的彩色时间线，不推开正文。
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronRight, History, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BUG_CLOSED_STATUSES } from '../../../shared/schemas/entryFields.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { useFieldCommit } from '../../hooks/useFieldCommit.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { valueTone } from '../../lib/field-tones.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { useBugModules } from './EntryFieldsForm.tsx'
import { FieldEditor, type FieldSpec, FieldValue, Pill, useFieldSpecs } from './FieldValue.tsx'
import { toneClass } from './KindIcon.tsx'
import { TagPicker, tagsQuery } from './TagPicker.tsx'

/** 流转里记录的字段（ADR-0033 TRACKED_ENTRY_FIELDS） */
const TRACKED = ['status', 'priority', 'severity']

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

export default function EntryFieldsPanel({
  entry,
  disabled,
}: {
  entry: Entry
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const specsOf = useFieldSpecs()
  const meta = useKindLabel()(entry.kind, entry.typeId)
  const commit = useFieldCommit()
  const actions = useEntryActions()
  const allTags = useQuery(tagsQuery)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showEmpty, setShowEmpty] = useState(false)
  const closed = BUG_CLOSED_STATUSES.includes(String(entry.fields.status))
  const specs = specsOf(entry.kind, entry.typeId).filter(
    (f) => !(entry.kind === 'bug' && f.name === 'resolvedAt' && !closed),
  )
  // 空的非必填属性收起（有错误的保持显示）；只读者直接不显示
  const hidden = specs.filter(
    (f) => !f.required && isEmpty(entry.fields[f.name]) && !errors[f.name],
  )
  const visible = specs.filter((f) => (showEmpty && !disabled ? true : !hidden.includes(f)))
  const modules = useBugModules(!disabled && specs.some((f) => f.name === 'module'))
  const tracked = specs.some((f) => TRACKED.includes(f.name))
  const tags = (entry.tagIds ?? [])
    .map((id) => allTags.data?.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x)

  const save = async (name: string, v: unknown) => {
    const r = await commit(entry, name, v)
    setErrors(r.ok ? {} : r.errors)
  }

  return (
    <section
      className="xz-props"
      aria-label={t('entry.fieldsLabel')}
      data-testid="entry-properties"
    >
      <dl className="xz-prop-list" data-testid="entry-fields">
        {visible.map((f) => (
          <PropRow
            key={f.name}
            spec={f}
            entry={entry}
            statuses={meta.statuses}
            disabled={disabled}
            error={errors[f.name]}
            suggestions={f.name === 'module' ? modules : undefined}
            onCommit={(v) => void save(f.name, v)}
          />
        ))}
        {disabled && !tags.length ? null : (
          <div className="xz-prop-row" data-field="tags" data-testid="entry-tags">
            <dt className="xz-prop-label">{t('kb.tags')}</dt>
            <dd className="min-w-0">
              <TagPicker
                value={tags}
                onChange={(ids) => void actions.patch(entry, { tagIds: ids })}
                disabled={disabled}
                placeholder={t('entry.props.addTag')}
              />
            </dd>
          </div>
        )}
      </dl>
      {(!disabled && hidden.length) || tracked ? (
        <div className="xz-props-foot">
          {!disabled && hidden.length ? (
            <button
              type="button"
              className="xz-props-link"
              aria-expanded={showEmpty}
              onClick={() => setShowEmpty((v) => !v)}
              data-testid="entry-props-empty-toggle"
            >
              <Plus className={cn('size-3.5 transition-transform', showEmpty && 'rotate-45')} />
              {showEmpty
                ? t('entry.props.hideEmpty')
                : t('entry.props.showEmpty', { n: hidden.length })}
            </button>
          ) : null}
          {tracked ? <FieldChanges entryId={entry.id} specs={specs} /> : null}
        </div>
      ) : null}
    </section>
  )
}

function PropRow({
  spec,
  entry,
  statuses,
  disabled,
  error,
  suggestions,
  onCommit,
}: {
  spec: FieldSpec
  entry: Entry
  statuses: string[] | null
  disabled?: boolean
  error?: string
  suggestions?: string[]
  onCommit: (v: unknown) => void
}) {
  const { t } = useTranslation()
  const value = entry.fields[spec.name]
  const missing = isEmpty(value)
  const shown = (
    <FieldValue
      spec={spec}
      value={value}
      fields={entry.fields}
      statuses={statuses}
      empty={
        <span className={cn('text-sm', spec.required ? 'text-danger' : 'text-fg-faint')}>
          {spec.required ? t('field.required') : t('field.empty')}
        </span>
      }
    />
  )
  return (
    <div className="xz-prop-row" data-field={spec.name}>
      <dt className="xz-prop-label" id={`prop-${spec.name}`} title={spec.label}>
        {spec.label}
      </dt>
      <dd className="min-w-0">
        {disabled ? (
          <span className="inline-flex min-h-7 items-center">{shown}</span>
        ) : (
          <FieldEditor
            spec={spec}
            value={value}
            onCommit={onCommit}
            suggestions={suggestions}
            trigger={
              <button
                type="button"
                className={cn('xz-prop-value', missing && 'xz-prop-value-empty')}
                aria-labelledby={`prop-${spec.name}`}
                aria-describedby={error ? `prop-err-${spec.name}` : undefined}
                data-testid={`entry-prop-${spec.name}`}
              >
                {shown}
              </button>
            }
          />
        )}
        {error ? (
          <p
            id={`prop-err-${spec.name}`}
            className="pb-1 text-danger text-xs"
            role="alert"
            data-testid={`field-error-${spec.name}`}
          >
            {error}
          </p>
        ) : null}
      </dd>
    </div>
  )
}

interface FieldChange {
  id: string
  field: string
  from: string | null
  to: string | null
  actor: { id: string | null; displayName: string }
  createdAt: string
}

/** 同一人、2 秒内的变化合为一个事件（新建时的状态 / 优先级 / 严重度是一次） */
function groupChanges(items: FieldChange[]): FieldChange[][] {
  const out: FieldChange[][] = []
  for (const c of items) {
    const last = out[out.length - 1]
    const head = last?.[0]
    if (
      head &&
      head.actor.id === c.actor.id &&
      Math.abs(Date.parse(head.createdAt) - Date.parse(c.createdAt)) <= 2000
    )
      last.push(c)
    else out.push([c])
  }
  return out
}

/** 流转（REQ-ENTRY-031）：一行摘要，点开弹层 = 按事件分组的彩色时间线（新的在上）。 */
function FieldChanges({ entryId, specs }: { entryId: string; specs: FieldSpec[] }) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['entry', entryId, 'changes'],
    queryFn: () =>
      unwrap<{ items: FieldChange[] }>(
        api.entries[':id']['field-changes'].$get({ param: { id: entryId } }),
      ).then((r) => r.items),
    staleTime: 10_000,
  })
  const label = (field: string) =>
    specs.find((s) => s.name === field)?.label ?? t(`entry.field.${field}`)
  const optOf = (field: string, v: string) =>
    specs.find((s) => s.name === field)?.options.find((o) => String(o.value) === v)
  const text = (v: string | null) =>
    v === null ? '—' : t(`entry.fieldValue.${v}`, { defaultValue: v })
  const pill = (field: string, v: string | null): ReactNode => {
    if (v === null) return <span className="text-fg-faint">—</span>
    const opt = optOf(field, v)
    return (
      <Pill
        tone={opt?.tone ?? valueTone(field, v)}
        dot={field === 'status'}
        className="h-5 px-1.5 text-[11px]"
      >
        {opt?.label ?? text(v)}
      </Pill>
    )
  }
  const items = data ?? []
  const latest = items[items.length - 1]
  const groups = groupChanges(items).reverse()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="xz-props-link" data-testid="entry-changes-toggle">
          <History className="size-3.5" aria-hidden />
          <span>{t('entry.changes.label')}</span>
          <span className="tabular-nums" data-testid="entry-changes-count">
            {t('entry.changes.count', { n: items.length })}
          </span>
          {latest && latest.from !== null ? (
            <span className="xz-props-latest">
              <span aria-hidden>·</span>
              {label(latest.field)}
              {pill(latest.field, latest.from)}
              <ArrowRight className="size-3 text-fg-faint" aria-hidden />
              {pill(latest.field, latest.to)}
              <span aria-hidden>·</span>
              <RelativeTime date={latest.createdAt} />
            </span>
          ) : null}
          <ChevronRight className="size-3.5 text-fg-faint" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <h3 className="mb-2 font-medium text-sm">{t('entry.changes.label')}</h3>
        <ol
          className="xz-timeline flex max-h-80 flex-col gap-3 overflow-y-auto"
          data-testid="entry-changes"
        >
          {groups.map((g) => {
            const top = g[g.length - 1] as FieldChange
            const tone = top.to
              ? (optOf(top.field, top.to)?.tone ?? valueTone(top.field, top.to))
              : 'gray'
            return (
              <li key={top.id} className={cn('xz-timeline-item text-xs', toneClass(tone))}>
                <span className="text-fg-muted">
                  {top.actor.displayName} · <RelativeTime date={top.createdAt} />
                </span>
                <ul className="flex flex-col gap-1">
                  {g.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-1.5"
                      data-field={c.field}
                    >
                      <span className="text-fg-muted">{label(c.field)}</span>
                      {pill(c.field, c.from)}
                      <ArrowRight className="size-3 text-fg-faint" aria-hidden />
                      {pill(c.field, c.to)}
                      {/* 文本形态（读屏与用例断言）：旧值 → 新值 */}
                      <span className="sr-only">
                        {text(c.from)} → {text(c.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
          {data && !data.length ? (
            <li className="text-fg-faint text-xs">{t('entry.changes.empty')}</li>
          ) : null}
        </ol>
      </PopoverContent>
    </Popover>
  )
}

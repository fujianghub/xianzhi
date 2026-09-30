/**
 * 记录页属性面板（ADR-0035 §B、REQ-ENTRY-024 · 025；取代 ADR-0033 的折叠表单）：标题下常显。
 * 每行 = 图标 · 属性名 · 彩色值；点值弹出编辑器，选定即保存（useFieldCommit 串行 PATCH）；只读时只显示。
 * 空值为淡色「空」占位，必填缺失标红；Bug 的解决日期只在已关闭时出现（服务端维护）。
 * 末行「标签」（个人标签，ADR-0017）；底部「流转」：状态 / 优先级 / 严重度的变化，展开为彩色竖向时间线。
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Tags } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BUG_CLOSED_STATUSES } from '../../../shared/schemas/entryFields.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { useFieldCommit } from '../../hooks/useFieldCommit.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { valueTone } from '../../lib/field-tones.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { useBugModules } from './EntryFieldsForm.tsx'
import {
  FieldEditor,
  type FieldSpec,
  FieldValue,
  fieldIcon,
  Pill,
  useFieldSpecs,
} from './FieldValue.tsx'
import { toneClass } from './KindIcon.tsx'
import { TagPicker, tagsQuery } from './TagPicker.tsx'

/** 流转里记录的字段（ADR-0033 TRACKED_ENTRY_FIELDS） */
const TRACKED = ['status', 'priority', 'severity']

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
  const closed = BUG_CLOSED_STATUSES.includes(String(entry.fields.status))
  const specs = specsOf(entry.kind, entry.typeId).filter(
    (f) => !(entry.kind === 'bug' && f.name === 'resolvedAt' && !closed),
  )
  const modules = useBugModules(!disabled && specs.some((f) => f.name === 'module'))
  const tracked = specs.some((f) => TRACKED.includes(f.name))

  const save = async (name: string, v: unknown) => {
    const r = await commit(entry, name, v)
    setErrors(r.ok ? {} : r.errors)
  }

  return (
    <section
      className="xz-props mb-6"
      aria-label={t('entry.fieldsLabel')}
      data-testid="entry-properties"
    >
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2" data-testid="entry-fields">
        {specs.map((f) => (
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
        <div className="xz-prop-row sm:col-span-2" data-testid="entry-tags">
          <dt className="xz-prop-label">
            <Tags className="size-3.5" aria-hidden />
            {t('kb.tags')}
          </dt>
          <dd className="min-w-0 py-1">
            <TagPicker
              value={(entry.tagIds ?? [])
                .map((id) => allTags.data?.find((x) => x.id === id))
                .filter((x): x is NonNullable<typeof x> => !!x)}
              onChange={(ids) => void actions.patch(entry, { tagIds: ids })}
              disabled={disabled}
            />
          </dd>
        </div>
      </dl>
      {tracked ? <FieldChanges entryId={entry.id} specs={specs} /> : null}
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
  const Icon = fieldIcon(spec)
  const value = entry.fields[spec.name]
  const missing = value === undefined || value === null || value === ''
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
      <dt className="xz-prop-label" id={`prop-${spec.name}`}>
        <Icon className="size-3.5" aria-hidden />
        <span className="truncate">{spec.label}</span>
      </dt>
      <dd className="min-w-0">
        {disabled ? (
          <span className="inline-flex min-h-8 items-center">{shown}</span>
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

function FieldChanges({ entryId, specs }: { entryId: string; specs: FieldSpec[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['entry', entryId, 'changes'],
    queryFn: () =>
      unwrap<{ items: FieldChange[] }>(
        api.entries[':id']['field-changes'].$get({ param: { id: entryId } }),
      ).then((r) => r.items),
    staleTime: 10_000,
  })
  const pill = (field: string, v: string | null) => {
    if (v === null) return <span className="text-fg-faint">—</span>
    const opt = specs.find((s) => s.name === field)?.options.find((o) => String(o.value) === v)
    return (
      <Pill
        tone={opt?.tone ?? valueTone(field, v)}
        dot={field === 'status'}
        className="h-5 px-1.5 text-[11px]"
      >
        {opt?.label ?? t(`entry.fieldValue.${v}`, { defaultValue: v })}
      </Pill>
    )
  }
  const items = (data ?? []).slice().reverse()
  return (
    <div className="mt-2 border-divider border-t pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-fg-muted text-xs hover:text-fg"
        data-testid="entry-changes-toggle"
      >
        <Disclosure open={open} />
        {t('entry.changes.label')}
        {data ? (
          <span className="tabular-nums" data-testid="entry-changes-count">
            {t('entry.changes.count', { n: data.length })}
          </span>
        ) : null}
      </button>
      {open ? (
        <ol className="xz-timeline mt-2 flex flex-col gap-2" data-testid="entry-changes">
          {items.map((c) => {
            const tone = c.to
              ? (specs
                  .find((s) => s.name === c.field)
                  ?.options.find((o) => String(o.value) === c.to)?.tone ?? valueTone(c.field, c.to))
              : 'gray'
            return (
              <li
                key={c.id}
                className={cn('xz-timeline-item text-xs', toneClass(tone))}
                data-field={c.field}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-fg-muted">
                    {specs.find((s) => s.name === c.field)?.label ?? t(`entry.field.${c.field}`)}
                  </span>
                  {pill(c.field, c.from)}
                  <ArrowRight className="size-3 text-fg-faint" aria-hidden />
                  {pill(c.field, c.to)}
                  <span className="sr-only">
                    {/* 文本形态（读屏与用例断言）：旧值 → 新值 */}
                    {t(`entry.fieldValue.${c.from ?? ''}`, { defaultValue: c.from ?? '—' })} →{' '}
                    {t(`entry.fieldValue.${c.to ?? ''}`, { defaultValue: c.to ?? '—' })}
                  </span>
                </span>
                <span className="text-fg-faint">
                  {c.actor.displayName} · <RelativeTime date={c.createdAt} />
                </span>
              </li>
            )
          })}
          {data && !data.length ? (
            <li className="text-fg-faint text-xs">{t('entry.changes.empty')}</li>
          ) : null}
        </ol>
      ) : null}
    </div>
  )
}

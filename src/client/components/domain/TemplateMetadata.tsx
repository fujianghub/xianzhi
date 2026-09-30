/**
 * 模板元数据（ADR-0039、REQ-TPL-016 · 017）：模板编辑页里「用此模板新建的记录带哪些属性」。
 * - 类型属性：所绑类型的字段（内置 + 类型的自定义字段）——可预填值；可省的可从本模板「移除」（收进「已移除」，可恢复）；
 *   必填、状态 / 优先级 / 严重度不可移除（类型的校验、统计与流转要它们）。
 * - 模板属性：本模板自有的字段，增 / 删 / 改（名、必填、选项与颜色、顺序；类型建好后不可改）都在这里，
 *   每个字段下可预填值；随模板「保存」一起提交，不需要类型管理权限、不影响该类型的其它记录。
 * - 「编辑类型的字段」（ADR-0036）仍在底部：改的是类型本身，影响该类型的全部记录。
 */
import { Lock, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hideableBaseFields } from '../../../shared/schemas/entryFields.ts'
import type { BuiltinEntryKind, EntryKind } from '../../../shared/schemas/enums.ts'
import { type FieldDef, newExtraFieldKey } from '../../../shared/schemas/fieldDefs.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { FieldDefsEditor, type FieldDraft, TypeFieldsSection } from './FieldDefsEditor.tsx'
import {
  defSpec,
  FieldEditor,
  type FieldSpec,
  FieldValue,
  fieldIcon,
  useFieldSpecs,
} from './FieldValue.tsx'

const isChoice = (d: FieldDraft) => d.type === 'select' || d.type === 'multiselect'

/** 草稿 → 定义（只为渲染预填值：空选项名略去） */
const draftDef = (d: FieldDraft): FieldDef => ({
  key: d.key ?? '',
  label: d.label.trim(),
  type: d.type,
  ...(isChoice(d)
    ? {
        options: d.options
          .filter((o) => o.name.trim())
          .map((o) => ({ name: o.name.trim(), color: o.color })),
      }
    : {}),
  ...(d.required ? { required: true } : {}),
})

/**
 * 自有字段草稿变了，预填值跟着走：字段删了 / 换了类型 → 清掉；选项改名 → 值跟着改名（按选项的本地 id 对应）；
 * 选项删了 → 单选清掉、多选去掉该项。
 */
export function syncPresets(
  fields: Record<string, unknown>,
  prev: FieldDraft[],
  next: FieldDraft[],
): Record<string, unknown> {
  const out = { ...fields }
  for (const p of prev) {
    if (!p.key || !(p.key in out)) continue
    const n = next.find((d) => d.id === p.id)
    if (!n || n.type !== p.type) {
      delete out[p.key]
      continue
    }
    if (!isChoice(n)) continue
    const rename = (v: string) => {
      const o = p.options.find((x) => x.name.trim() === v)
      return (o && n.options.find((x) => x.id === o.id)?.name.trim()) || undefined
    }
    const v = out[p.key]
    if (n.type === 'select') {
      const nv = typeof v === 'string' ? rename(v) : undefined
      if (nv) out[p.key] = nv
      else delete out[p.key]
    } else {
      const arr = (Array.isArray(v) ? v : [])
        .map((x) => rename(String(x)))
        .filter((x): x is string => !!x)
      if (arr.length) out[p.key] = [...new Set(arr)]
      else delete out[p.key]
    }
  }
  return out
}

export function TemplateMetadata({
  kind,
  typeId,
  fields,
  onFields,
  own,
  onOwn,
  hidden,
  onHidden,
  editable,
  canManageType,
}: {
  kind: EntryKind
  typeId: string | null
  /** 预填值（类型属性与模板属性共用一个 fields） */
  fields: Record<string, unknown>
  onFields: (v: Record<string, unknown>) => void
  /** 模板自有字段草稿 */
  own: FieldDraft[]
  onOwn: (v: FieldDraft[]) => void
  /** 本模板移除的类型字段名 */
  hidden: string[]
  onHidden: (v: string[]) => void
  editable: boolean
  canManageType: boolean
}) {
  const { t } = useTranslation()
  const meta = useKindLabel()(kind, typeId)
  // 类型的字段（不套模板）；Bug 的发现 / 解决日期由服务端维护，模板不涉及
  const typeSpecs = useFieldSpecs()(kind, typeId).filter(
    (f) => !(kind === 'bug' && (f.name === 'foundAt' || f.name === 'resolvedAt')),
  )
  const hideable = hideableBaseFields(kind)
  const canRemove = (f: FieldSpec) => !f.required && (f.extra || hideable.includes(f.name))
  const removed = typeSpecs.filter((f) => hidden.includes(f.name) && canRemove(f))
  const shown = typeSpecs.filter((f) => !removed.includes(f))
  const [open, setOpen] = useState(false)

  const setValue = (name: string, v: unknown) => {
    const next = { ...fields }
    if (v === undefined) delete next[name]
    else next[name] = v
    onFields(next)
  }
  const remove = (f: FieldSpec) => {
    onHidden([...hidden.filter((n) => n !== f.name), f.name])
    if (f.name in fields) setValue(f.name, undefined)
  }
  const restore = (f: FieldSpec) => onHidden(hidden.filter((n) => n !== f.name))
  const changeOwn = (next: FieldDraft[]) => {
    // 新字段先给一个临时键（x 键规则）：预填值按它存，保存时服务端换成正式键
    const taken = [
      ...meta.fieldDefs.map((d) => d.key),
      ...next.flatMap((d) => (d.key ? [d.key] : [])),
    ]
    const keyed = next.map((d) => {
      if (d.key) return d
      const key = newExtraFieldKey(taken)
      taken.push(key)
      return { ...d, key, fresh: true }
    })
    onOwn(keyed)
    const synced = syncPresets(fields, own, keyed)
    if (JSON.stringify(synced) !== JSON.stringify(fields)) onFields(synced)
  }
  const empty = <span className="text-fg-faint text-sm">{t('field.empty')}</span>

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-divider p-3"
      data-testid="template-fields"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium text-sm">{t('template.meta.title')}</h3>
        <p className="text-fg-muted text-xs">{t('template.meta.hint')}</p>
      </div>

      <div className="flex flex-col gap-1.5" data-testid="template-type-fields">
        <h4 className="text-fg-muted text-xs">
          {t('template.meta.typeFields', { type: meta.label })}
        </h4>
        {shown.length ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {shown.map((f) => {
              const Icon = fieldIcon(f)
              const value = (
                <FieldValue spec={f} value={fields[f.name]} fields={fields} empty={empty} />
              )
              return (
                <div key={f.name} className="xz-prop-row" data-field={f.name}>
                  <dt className="xz-prop-label">
                    <Icon className="me-1 size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{f.label}</span>
                  </dt>
                  <dd className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 flex-1">
                      {editable ? (
                        <FieldEditor
                          spec={f}
                          value={fields[f.name]}
                          onCommit={(v) => setValue(f.name, v)}
                          trigger={
                            <button
                              type="button"
                              className="xz-prop-value"
                              data-testid={`template-field-${f.name}`}
                            >
                              {value}
                            </button>
                          }
                        />
                      ) : (
                        <span className="inline-flex min-h-8 items-center">{value}</span>
                      )}
                    </span>
                    {!editable ? null : canRemove(f) ? (
                      <button
                        type="button"
                        onClick={() => remove(f)}
                        aria-label={t('template.meta.remove', { name: f.label })}
                        title={t('template.meta.remove', { name: f.label })}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-danger"
                        data-testid={`template-field-remove-${f.name}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : (
                      <span
                        className="grid size-7 shrink-0 place-items-center text-fg-faint"
                        title={t('template.meta.locked')}
                      >
                        <Lock className="size-3" aria-hidden />
                        <span className="sr-only">{t('template.meta.locked')}</span>
                      </span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        ) : (
          <p className="text-fg-muted text-sm">{t('template.noFields')}</p>
        )}
        {removed.length ? (
          <div
            className="flex flex-wrap items-center gap-1.5 text-fg-muted text-xs"
            data-testid="template-removed-fields"
          >
            <span>{t('template.meta.removed', { count: removed.length })}</span>
            {removed.map((f) => (
              <span
                key={f.name}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-divider ps-2 pe-1"
              >
                <span className="line-through">{f.label}</span>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => restore(f)}
                    aria-label={t('template.meta.restore', { name: f.label })}
                    title={t('template.meta.restore', { name: f.label })}
                    className="grid size-5 place-items-center rounded-full hover:bg-hover"
                    data-testid={`template-field-restore-${f.name}`}
                  >
                    <RotateCcw className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5" data-testid="template-own-fields">
        <h4 className="text-fg-muted text-xs">{t('template.meta.ownFields')}</h4>
        <FieldDefsEditor
          value={own}
          onChange={changeOwn}
          disabled={!editable}
          emptyText={t('template.meta.ownEmpty')}
          addLabel={t('template.meta.add')}
          rowExtra={(d) => {
            if (!d.key) return null
            const spec = defSpec(draftDef(d))
            const value = (
              <FieldValue spec={spec} value={fields[d.key]} fields={fields} empty={empty} />
            )
            return (
              <div className="flex items-center gap-2 ps-1">
                <span className="shrink-0 text-fg-muted text-xs">{t('template.meta.preset')}</span>
                {editable ? (
                  <FieldEditor
                    spec={spec}
                    value={fields[d.key]}
                    onCommit={(v) => setValue(d.key as string, v)}
                    trigger={
                      <button
                        type="button"
                        className="xz-prop-value"
                        data-testid="template-own-preset"
                      >
                        {value}
                      </button>
                    }
                  />
                ) : (
                  <span className="inline-flex min-h-8 items-center">{value}</span>
                )}
              </div>
            )
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex w-fit items-center gap-1 text-fg-muted text-xs hover:text-fg"
          data-testid="template-type-fields-toggle"
        >
          <Disclosure open={open} />
          {t('template.editTypeFields', { type: meta.label })}
        </button>
        {open ? (
          <>
            <p className="text-fg-muted text-xs">{t('template.editTypeFieldsHint')}</p>
            <TypeFieldsSection
              typeId={kind === 'custom' ? (typeId ?? undefined) : undefined}
              kind={kind === 'custom' ? undefined : (kind as BuiltinEntryKind)}
              defs={meta.fieldDefs}
              canManage={canManageType}
              compact
            />
          </>
        ) : null}
      </div>
    </section>
  )
}

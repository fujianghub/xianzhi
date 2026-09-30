/**
 * 字段定义编辑（ADR-0036、REQ-ENTRY-027 · 028、REQ-TPL-011）：
 * - `FieldDefsEditor`：受控列表——字段名 · 类型（建好后不可改）· 必填 · 单选 / 多选的带色选项 · 上下移 · 删除。
 *   选项草稿记住原名，保存时算出 optionRenames（记录里的值同步改名）。
 * - `TypeFieldsSection`：某个类型（自定义 / 空间类型，或内置类型的追加字段）的字段区：草稿 + 保存 / 撤销，
 *   删掉字段或选项前提示会清空记录里的值。空间类型对话框、设置 · 类型、模板表单共用。
 * - 模板自有字段（ADR-0039、REQ-TPL-016）也用 `FieldDefsEditor`：`rowExtra` 在每个字段下多一行（预填值）；
 *   新字段带临时键（`fresh`，好给它预填值，服务端保存时换成正式键），类型仍可改。
 */
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BuiltinEntryKind, PaletteColor } from '../../../shared/schemas/enums.ts'
import {
  FIELD_DEF_TYPES,
  type FieldDef,
  type FieldDefType,
} from '../../../shared/schemas/fieldDefs.ts'
import {
  type FieldDefInput,
  type OptionRenames,
  useEntryTypeActions,
} from '../../hooks/useEntryTypeActions.ts'
import { cn } from '../../lib/cn.ts'
import { positionTone } from '../../lib/field-tones.ts'
import { newId } from '../../lib/uuid.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Input } from '../ui/input.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import type { PaletteName } from './SpaceIcon.tsx'

export interface OptionDraft {
  /** 本地键（React key） */
  id: string
  name: string
  color: PaletteColor
  /** 已保存的原名（新选项无） */
  orig?: string
}
export interface FieldDraft {
  id: string
  /** 已保存字段的键；新字段无（模板自有字段的新字段带临时键，见 fresh） */
  key?: string
  /** key 是客户端临时生成的、尚未保存（ADR-0039）：类型仍可改、不算选项改名 */
  fresh?: boolean
  label: string
  type: FieldDefType
  required: boolean
  options: OptionDraft[]
}

const isChoice = (t: FieldDefType) => t === 'select' || t === 'multiselect'

/** 字段名 / 选项名输入框里回车不提交外层表单（模板编辑页整页是一个 form） */
const noSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.preventDefault()
}

/** 草稿是否还不能提交：字段名为空，或单选 / 多选没有选项、有空选项名 */
export const draftsInvalid = (drafts: FieldDraft[]) =>
  drafts.some(
    (d) =>
      !d.label.trim() ||
      (isChoice(d.type) && (!d.options.length || d.options.some((o) => !o.name.trim()))),
  )

export const draftsOf = (defs: FieldDef[]): FieldDraft[] =>
  defs.map((d) => ({
    id: d.key,
    key: d.key,
    label: d.label,
    type: d.type,
    required: !!d.required,
    options: (d.options ?? []).map((o) => ({
      id: newId(),
      name: o.name,
      color: o.color,
      orig: o.name,
    })),
  }))

/** 草稿 → 提交体（fieldDefs + optionRenames） */
export function toPayload(drafts: FieldDraft[]): {
  fieldDefs: FieldDefInput[]
  optionRenames: OptionRenames
} {
  const optionRenames: OptionRenames = {}
  const fieldDefs = drafts.map((d) => {
    if (d.key && !d.fresh && isChoice(d.type)) {
      const r = Object.fromEntries(
        d.options
          .filter((o) => o.orig && o.orig !== o.name.trim())
          .map((o) => [o.orig as string, o.name.trim()]),
      )
      if (Object.keys(r).length) optionRenames[d.key] = r
    }
    return {
      ...(d.key ? { key: d.key } : {}),
      label: d.label.trim(),
      type: d.type,
      ...(isChoice(d.type)
        ? { options: d.options.map((o) => ({ name: o.name.trim(), color: o.color })) }
        : {}),
      ...(d.required ? { required: true } : {}),
    }
  })
  return { fieldDefs, optionRenames }
}

/** 保存会清掉哪些数据：删掉的字段、删掉的选项（用于确认提示） */
export function lossOf(prev: FieldDef[], drafts: FieldDraft[]): string[] {
  const out: string[] = []
  for (const p of prev) {
    const d = drafts.find((x) => x.key === p.key)
    if (!d) {
      out.push(p.label)
      continue
    }
    const kept = new Set(d.options.map((o) => o.orig).filter(Boolean))
    for (const o of p.options ?? []) if (!kept.has(o.name)) out.push(`${p.label} · ${o.name}`)
  }
  return out
}

export function FieldDefsEditor({
  value,
  onChange,
  disabled,
  rowExtra,
  emptyText,
  addLabel,
}: {
  value: FieldDraft[]
  onChange: (next: FieldDraft[]) => void
  disabled?: boolean
  /** 每个字段卡片底部的附加内容（模板：预填值） */
  rowExtra?: (d: FieldDraft) => ReactNode
  emptyText?: string
  addLabel?: string
}) {
  const { t } = useTranslation()
  const set = (id: string, patch: Partial<FieldDraft>) =>
    onChange(value.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j] as FieldDraft, next[i] as FieldDraft]
    onChange(next)
  }
  const add = () =>
    onChange([...value, { id: newId(), label: '', type: 'text', required: false, options: [] }])
  return (
    <div className="flex flex-col gap-2" data-testid="field-defs-editor">
      {value.length ? null : (
        <p className="text-fg-muted text-sm">{emptyText ?? t('fieldDefs.empty')}</p>
      )}
      {value.map((d, i) => (
        <div
          key={d.id}
          className="flex flex-col gap-2 rounded-lg border border-divider p-2.5"
          data-testid="field-def-row"
          data-field-key={d.key ?? ''}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={d.label}
              onChange={(e) => set(d.id, { label: e.target.value })}
              onKeyDown={noSubmit}
              placeholder={t('fieldDefs.labelPlaceholder')}
              aria-label={t('fieldDefs.label')}
              maxLength={20}
              disabled={disabled}
              className="h-8 w-40"
              data-testid="field-def-label"
            />
            <select
              value={d.type}
              disabled={disabled || (!!d.key && !d.fresh)}
              title={d.key && !d.fresh ? t('fieldDefs.typeLocked') : undefined}
              onChange={(e) => {
                const type = e.target.value as FieldDefType
                set(d.id, {
                  type,
                  options: isChoice(type)
                    ? d.options.length
                      ? d.options
                      : [{ id: newId(), name: '', color: 'blue' }]
                    : [],
                })
              }}
              aria-label={t('fieldDefs.type')}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
              data-testid="field-def-type"
            >
              {FIELD_DEF_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {t(`fieldDefs.types.${ft}`)}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-fg-muted text-xs">
              <input
                type="checkbox"
                checked={d.required}
                disabled={disabled}
                onChange={(e) => set(d.id, { required: e.target.checked })}
              />
              {t('fieldDefs.required')}
            </label>
            <div className="ms-auto flex items-center">
              <IconBtn
                label={t('fieldDefs.up')}
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="size-3.5" />
              </IconBtn>
              <IconBtn
                label={t('fieldDefs.down')}
                disabled={disabled || i === value.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-3.5" />
              </IconBtn>
              <IconBtn
                label={t('fieldDefs.remove')}
                disabled={disabled}
                danger
                onClick={() => onChange(value.filter((x) => x.id !== d.id))}
                testId="field-def-remove"
              >
                <Trash2 className="size-3.5" />
              </IconBtn>
            </div>
          </div>
          {isChoice(d.type) ? (
            <OptionsEditor
              options={d.options}
              disabled={disabled}
              onChange={(options) => set(d.id, { options })}
            />
          ) : null}
          {rowExtra?.(d)}
        </div>
      ))}
      {disabled ? null : (
        <button
          type="button"
          onClick={add}
          className="inline-flex h-8 items-center gap-1 self-start rounded-md px-2 text-primary-text text-sm hover:bg-hover"
          data-testid="field-def-add"
        >
          <Plus className="size-4" />
          {addLabel ?? t('fieldDefs.add')}
        </button>
      )}
    </div>
  )
}

function OptionsEditor({
  options,
  onChange,
  disabled,
}: {
  options: OptionDraft[]
  onChange: (next: OptionDraft[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const set = (id: string, patch: Partial<OptionDraft>) =>
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  return (
    <div className="flex flex-wrap items-center gap-1.5 ps-1" data-testid="field-def-options">
      {options.map((o) => (
        <span
          key={o.id}
          className="inline-flex items-center gap-0.5 rounded-full border border-divider py-0.5 ps-0.5 pe-1"
        >
          <ColorPicker
            value={o.color as PaletteName}
            onChange={(c) => set(o.id, { color: c })}
            label={t('fieldDefs.optionColor')}
            disabled={disabled}
            testId="field-option-color"
          />
          <input
            value={o.name}
            onChange={(e) => set(o.id, { name: e.target.value })}
            onKeyDown={noSubmit}
            placeholder={t('fieldDefs.optionPlaceholder')}
            aria-label={t('fieldDefs.option')}
            maxLength={20}
            disabled={disabled}
            className="w-20 bg-transparent text-sm outline-none"
            data-testid="field-option-name"
          />
          {disabled ? null : (
            <button
              type="button"
              aria-label={t('fieldDefs.removeOption')}
              onClick={() => onChange(options.filter((x) => x.id !== o.id))}
              className="grid size-5 place-items-center rounded-full text-fg-muted hover:bg-hover"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {disabled ? null : (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...options,
              {
                id: newId(),
                name: '',
                color: positionTone(options.length, options.length + 2),
              },
            ])
          }
          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-fg-muted text-xs hover:bg-hover"
          data-testid="field-option-add"
        >
          <Plus className="size-3" />
          {t('fieldDefs.addOption')}
        </button>
      )}
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid size-7 place-items-center rounded-md hover:bg-hover disabled:opacity-40',
        danger ? 'text-danger' : 'text-fg-muted',
      )}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

/**
 * 某个类型的字段区：自定义 / 空间类型给 `typeId`，内置类型给 `kind`（追加字段，仅所有者）。
 * `canManage` = 能改；否则只读展示。
 */
export function TypeFieldsSection({
  typeId,
  kind,
  defs,
  canManage,
  compact,
}: {
  typeId?: string
  kind?: BuiltinEntryKind
  defs: FieldDef[]
  canManage: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const actions = useEntryTypeActions()
  const initial = useMemo(() => draftsOf(defs), [defs])
  const [drafts, setDrafts] = useState<FieldDraft[]>(initial)
  const [confirm, setConfirm] = useState<string[] | null>(null)
  useEffect(() => setDrafts(initial), [initial])
  const dirty = JSON.stringify(toPayload(drafts)) !== JSON.stringify(toPayload(initial))
  const invalid = draftsInvalid(drafts)
  const pending = actions.patch.isPending || actions.patchBuiltin.isPending
  const save = () => {
    const body = toPayload(drafts)
    if (typeId) actions.patch.mutate({ id: typeId, ...body })
    else if (kind) actions.patchBuiltin.mutate({ kind, ...body })
  }
  const trySave = () => {
    const loss = lossOf(defs, drafts)
    if (loss.length) setConfirm(loss)
    else save()
  }
  return (
    <section className={cn('flex flex-col gap-2', !compact && 'pt-1')} data-testid="type-fields">
      <FieldDefsEditor value={drafts} onChange={setDrafts} disabled={!canManage} />
      {canManage && dirty ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={trySave}
            disabled={invalid}
            loading={pending}
            data-testid="type-fields-save"
          >
            {t('fieldDefs.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDrafts(initial)}>
            {t('fieldDefs.reset')}
          </Button>
          {invalid ? <span className="text-danger text-xs">{t('fieldDefs.invalid')}</span> : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('fieldDefs.lossTitle')}
        description={t('fieldDefs.lossBody', { items: (confirm ?? []).join('、') })}
        confirmLabel={t('fieldDefs.save')}
        onConfirm={() => {
          setConfirm(null)
          save()
        }}
      />
    </section>
  )
}

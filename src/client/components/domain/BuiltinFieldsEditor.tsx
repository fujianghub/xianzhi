/**
 * 内置类型的代码字段覆盖（ADR-0042、REQ-ENTRY-034 · 036）：逐字段 显示 / 隐藏、改显示名、排序；
 * 选项字段逐项改显示名 / 色、隐藏（默认值选项不能隐藏）。字段键与选项值不变，隐藏的字段记录里的值保留。
 * 顺序与追加字段（`TypeFieldsSection`）混排：追加字段在此只可调顺序。仅所有者可改，否则只读。
 */
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type BaseFieldOverride,
  type BaseFieldOverrides,
  sortByFieldOrder,
} from '../../../shared/schemas/baseFields.ts'
import { defaultEntryFields } from '../../../shared/schemas/entryFields.ts'
import type { BuiltinEntryKind } from '../../../shared/schemas/enums.ts'
import { useEntryTypeActions } from '../../hooks/useEntryTypeActions.ts'
import { cn } from '../../lib/cn.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { baseSpecsOf, type FieldSpec } from './FieldValue.tsx'
import type { PaletteName } from './SpaceIcon.tsx'

interface Draft {
  order: string[]
  ov: BaseFieldOverrides
}

/** 去掉空项，便于比较与提交 */
function clean(ov: BaseFieldOverrides): BaseFieldOverrides {
  const out: BaseFieldOverrides = {}
  for (const [k, o] of Object.entries(ov)) {
    const next: BaseFieldOverride = {}
    if (o.hidden) next.hidden = true
    if (o.label?.trim()) next.label = o.label.trim()
    const opts = Object.fromEntries(
      Object.entries(o.options ?? {})
        .map(([v, oo]) => {
          const c: NonNullable<BaseFieldOverride['options']>[string] = {}
          if (oo.label?.trim()) c.label = oo.label.trim()
          if (oo.color) c.color = oo.color
          if (oo.hidden) c.hidden = true
          return [v, c] as const
        })
        .filter(([, c]) => Object.keys(c).length),
    )
    if (Object.keys(opts).length) next.options = opts
    if (Object.keys(next).length) out[k] = next
  }
  return out
}

export function BuiltinFieldsEditor({
  kind,
  canManage,
}: {
  kind: BuiltinEntryKind
  canManage: boolean
}) {
  const { t } = useTranslation()
  const actions = useEntryTypeActions()
  const meta = useKindLabel()(kind)
  // 代码默认（不套覆盖）：显示名 / 选项名 / 色作占位。meta 每次渲染都是新对象 → 以序列化值作依赖
  const sig = JSON.stringify([meta.baseFields, meta.fieldOrder, meta.fieldDefs.map((d) => d.key)])
  // biome-ignore lint/correctness/useExhaustiveDependencies: sig 概括了 meta 的相关部分
  const defaults = useMemo(
    () => baseSpecsOf(kind, { ...meta, baseFields: {} }, t, { includeHidden: true }),
    [kind, t],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: 同上
  const initial = useMemo<Draft>(
    () => ({
      order: sortByFieldOrder(
        [...defaults.map((f) => f.name), ...meta.fieldDefs.map((d) => d.key)],
        (k) => k,
        meta.fieldOrder,
      ),
      ov: meta.baseFields,
    }),
    [defaults, sig],
  )
  const [draft, setDraft] = useState<Draft>(initial)
  useEffect(() => setDraft(initial), [initial])
  const payload = (d: Draft) => ({ baseFields: clean(d.ov), fieldOrder: d.order })
  const dirty = JSON.stringify(payload(draft)) !== JSON.stringify(payload(initial))
  const customized = Object.keys(meta.baseFields).length > 0 || meta.fieldOrder.length > 0
  const disabled = !canManage

  const setField = (name: string, patch: Partial<BaseFieldOverride>) =>
    setDraft((d) => ({ ...d, ov: { ...d.ov, [name]: { ...d.ov[name], ...patch } } }))
  const setOption = (
    name: string,
    value: string,
    patch: NonNullable<BaseFieldOverride['options']>[string],
  ) =>
    setDraft((d) => {
      const f = d.ov[name] ?? {}
      return {
        ...d,
        ov: {
          ...d.ov,
          [name]: { ...f, options: { ...f.options, [value]: { ...f.options?.[value], ...patch } } },
        },
      }
    })
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir
      if (j < 0 || j >= d.order.length) return d
      const order = [...d.order]
      ;[order[i], order[j]] = [order[j] as string, order[i] as string]
      return { ...d, order }
    })

  return (
    <section className="flex flex-col gap-2" data-testid="builtin-fields">
      <p className="text-fg-muted text-xs">{t('builtinFields.hint')}</p>
      <ol className="flex flex-col gap-1.5">
        {draft.order.map((key, i) => {
          const spec = defaults.find((f) => f.name === key)
          const extra = meta.fieldDefs.find((d) => d.key === key)
          if (!spec && !extra) return null
          const o = draft.ov[key] ?? {}
          return (
            <li
              key={key}
              className={cn(
                'flex flex-col gap-2 rounded-lg border border-divider p-2',
                o.hidden && 'opacity-60',
              )}
              data-testid="builtin-field-row"
              data-field={key}
              data-hidden={o.hidden ? '' : undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                {spec ? (
                  <button
                    type="button"
                    aria-pressed={!o.hidden}
                    aria-label={t(o.hidden ? 'builtinFields.show' : 'builtinFields.hide', {
                      name: o.label || spec.label,
                    })}
                    title={t(o.hidden ? 'builtinFields.show' : 'builtinFields.hide', {
                      name: o.label || spec.label,
                    })}
                    disabled={disabled}
                    onClick={() => setField(key, { hidden: !o.hidden })}
                    className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover disabled:opacity-60"
                    data-testid="builtin-field-visibility"
                  >
                    {o.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                ) : (
                  <span className="grid size-8 place-items-center" aria-hidden />
                )}
                {spec ? (
                  <Input
                    value={o.label ?? ''}
                    placeholder={spec.label}
                    onChange={(e) => setField(key, { label: e.target.value })}
                    aria-label={t('builtinFields.label', { name: spec.label })}
                    maxLength={20}
                    disabled={disabled}
                    className="h-8 w-40"
                    data-testid="builtin-field-label"
                  />
                ) : (
                  <span className="w-40 truncate px-1 text-sm">{extra?.label}</span>
                )}
                <span className="text-fg-muted text-xs">
                  {extra
                    ? t('builtinFields.extra')
                    : t(`fieldDefs.types.${spec?.kind === 'select' ? 'select' : spec?.kind}`)}
                </span>
                {spec?.required && o.hidden ? (
                  <span className="text-fg-muted text-xs">{t('builtinFields.requiredHidden')}</span>
                ) : null}
                <span className="ms-auto flex items-center">
                  <button
                    type="button"
                    aria-label={t('fieldDefs.up')}
                    disabled={disabled || i === 0}
                    onClick={() => move(i, -1)}
                    className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-hover disabled:opacity-40"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('fieldDefs.down')}
                    disabled={disabled || i === draft.order.length - 1}
                    onClick={() => move(i, 1)}
                    className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-hover disabled:opacity-40"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </span>
              </div>
              {spec?.kind === 'select' && !o.hidden ? (
                <OptionList
                  kind={kind}
                  spec={spec}
                  ov={o}
                  disabled={disabled}
                  onChange={(value, patch) => setOption(key, value, patch)}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <>
              <Button
                size="sm"
                loading={actions.patchBuiltin.isPending}
                onClick={() => actions.patchBuiltin.mutate({ kind, ...payload(draft) })}
                data-testid="builtin-fields-save"
              >
                {t('fieldDefs.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(initial)}>
                {t('fieldDefs.reset')}
              </Button>
            </>
          ) : null}
          {customized ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                actions.patchBuiltin.mutate({ kind, baseFields: null, fieldOrder: null })
              }
              data-testid="builtin-fields-restore"
            >
              <RotateCcw className="size-3.5" />
              {t('builtinFields.restore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function OptionList({
  kind,
  spec,
  ov,
  disabled,
  onChange,
}: {
  kind: BuiltinEntryKind
  spec: FieldSpec
  ov: BaseFieldOverride
  disabled: boolean
  onChange: (value: string, patch: NonNullable<BaseFieldOverride['options']>[string]) => void
}) {
  const { t } = useTranslation()
  const def = defaultEntryFields[kind][spec.name]
  return (
    <ul className="flex flex-col gap-1 ps-10" data-testid="builtin-field-options">
      {spec.options.map((opt) => {
        const v = String(opt.value)
        const oo = ov.options?.[v] ?? {}
        const isDefault = def !== undefined && String(def) === v
        const name = oo.label || opt.label
        return (
          <li
            key={v}
            className={cn('flex items-center gap-2', oo.hidden && 'opacity-60')}
            data-option={v}
            data-hidden={oo.hidden ? '' : undefined}
          >
            <ColorPicker
              value={(oo.color ?? opt.tone) as PaletteName}
              onChange={(c) => onChange(v, { color: c })}
              label={t('builtinFields.optionColor', { name })}
              disabled={disabled}
              testId="builtin-option-color"
            />
            <Input
              value={oo.label ?? ''}
              placeholder={opt.label}
              onChange={(e) => onChange(v, { label: e.target.value })}
              aria-label={t('builtinFields.optionLabel', { name: opt.label })}
              maxLength={20}
              disabled={disabled}
              className="h-8 w-36"
              data-testid="builtin-option-label"
            />
            <button
              type="button"
              aria-pressed={!oo.hidden}
              aria-label={t(oo.hidden ? 'builtinFields.show' : 'builtinFields.hide', { name })}
              title={
                isDefault
                  ? t('builtinFields.defaultOption')
                  : t(oo.hidden ? 'builtinFields.show' : 'builtinFields.hide', { name })
              }
              disabled={disabled || isDefault}
              onClick={() => onChange(v, { hidden: !oo.hidden })}
              className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover disabled:opacity-40"
              data-testid="builtin-option-visibility"
            >
              {oo.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

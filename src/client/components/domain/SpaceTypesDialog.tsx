/**
 * 空间的「类型与字段」（ADR-0036、REQ-KB-014 · 015、REQ-ENTRY-027）：
 * 左 = 启用清单（勾选即启用、上下移排序、恢复默认；候选 = 内置类型 · 本空间的空间类型 · 我的个人类型）+ 新建空间类型；
 * 右 = 选中类型的编辑：空间类型可改名 / 改色 / 状态（带色）/ 字段 / 删除；内置类型只可追加字段（所有者）；
 * 个人类型在「设置 · 类型」里管理（这里只能启用）。
 * 启用清单即改即存（PATCH /spaces/:id enabledKinds，乐观锁取最新 updatedAt）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BuiltinEntryKind, PaletteColor } from '../../../shared/schemas/enums.ts'
import { apiErrorMessage, useEntryTypeActions } from '../../hooks/useEntryTypeActions.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { ENTRY_KINDS } from '../../lib/entry-queries.ts'
import { entryTypesQuery, useEnabledKinds, useKindLabel } from '../../lib/entry-types.ts'
import { positionTone } from '../../lib/field-tones.ts'
import type { Space } from '../../lib/space-queries.ts'
import { Button } from '../ui/button.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { InlineEdit } from '../ui/inline-edit.tsx'
import { Input } from '../ui/input.tsx'
import { BuiltinFieldsEditor } from './BuiltinFieldsEditor.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { TypeFieldsSection } from './FieldDefsEditor.tsx'
import { StatusPill } from './FieldValue.tsx'
import { KindIcon } from './KindIcon.tsx'
import type { PaletteName } from './SpaceIcon.tsx'

export function SpaceTypesDialog({
  space: given,
  open,
  onOpenChange,
  canManage,
}: {
  space: Space
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 空间管理员（服务端 can() 为准）：能改启用清单、管空间类型 */
  canManage: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const types = useQuery(entryTypesQuery)
  const [space, setSpace] = useState(given)
  useEffect(() => setSpace(given), [given])
  const enabled = useEnabledKinds(space) ?? []
  const kindOf = useKindLabel()
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const items = types.data?.items ?? []
  const deleted = new Set(types.data?.builtin.filter((b) => b.deleted).map((b) => b.kind) ?? [])
  // 候选：内置（未删除）· 本空间的空间类型 · 我的个人类型
  const candidates = [
    ...ENTRY_KINDS.filter((k) => !deleted.has(k)),
    ...items.filter((ty) => ty.spaceId === space.id).map((ty) => `type:${ty.id}`),
    ...(space.isPersonal ? [] : items.filter((ty) => ty.mine).map((ty) => `type:${ty.id}`)),
  ]
  const disabled = candidates.filter((k) => !enabled.includes(k))
  const cur = selected ?? enabled[0] ?? candidates[0] ?? null

  const metaOf = (item: string) =>
    item.startsWith('type:') ? kindOf('custom', item.slice(5)) : kindOf(item)
  const typeOf = (item: string) =>
    item.startsWith('type:') ? items.find((x) => x.id === item.slice(5)) : undefined

  const saveEnabled = async (next: string[] | null) => {
    setSaving(true)
    try {
      const s = await unwrap<Space>(
        api.spaces[':id'].$patch({
          param: { id: space.id },
          json: { enabledKinds: next, ifUpdatedAt: space.updatedAt } as never,
        }),
      )
      setSpace(s)
      qc.setQueryData(['space', s.slug], s)
      void qc.invalidateQueries({ queryKey: ['spaces'] })
    } catch (err) {
      toast.error(apiErrorMessage(err, t('task.saveFailed')))
      void qc.invalidateQueries({ queryKey: ['space', space.slug] })
    } finally {
      setSaving(false)
    }
  }
  const toggle = (item: string, on: boolean) =>
    void saveEnabled(on ? [...enabled, item] : enabled.filter((k) => k !== item))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= enabled.length) return
    const next = [...enabled]
    ;[next[i], next[j]] = [next[j] as string, next[i] as string]
    void saveEnabled(next)
  }

  const row = (item: string, on: boolean, i: number) => {
    const m = metaOf(item)
    const ty = typeOf(item)
    return (
      <li
        key={item}
        className={cn(
          'group flex items-center gap-2 rounded-md px-1.5 py-1',
          cur === item ? 'bg-selected' : 'hover:bg-hover',
        )}
        data-testid="space-type-item"
        data-item={item}
        data-enabled={on ? '1' : '0'}
      >
        <Checkbox
          checked={on}
          disabled={!canManage || saving}
          onCheckedChange={(v) => toggle(item, v === true)}
          aria-label={t('spaceTypes.enable', { name: m.label })}
          className="size-4"
          data-testid="space-type-toggle"
        />
        <button
          type="button"
          onClick={() => setSelected(item)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <KindIcon kind={m.kind} typeId={m.typeId} size="xs" />
          <span className={cn('truncate', !on && 'text-fg-muted')}>{m.label}</span>
          <span className="ms-auto shrink-0 text-[11px] text-fg-faint">
            {ty ? (ty.spaceId ? t('spaceTypes.spaceType') : t('spaceTypes.personalType')) : ''}
          </span>
        </button>
        {on && canManage ? (
          <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              aria-label={t('fieldDefs.up')}
              disabled={i === 0 || saving}
              onClick={() => move(i, -1)}
              className="grid size-6 place-items-center rounded text-fg-muted hover:bg-hover disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('fieldDefs.down')}
              disabled={i === enabled.length - 1 || saving}
              onClick={() => move(i, 1)}
              className="grid size-6 place-items-center rounded text-fg-muted hover:bg-hover disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </span>
        ) : null}
      </li>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,56rem)]" data-testid="space-types-dialog">
        <DialogTitle>
          {t('spaceTypes.title', { name: space.isPersonal ? t('space.personal') : space.name })}
        </DialogTitle>
        <DialogDescription className="text-fg-muted text-sm">
          {t('spaceTypes.hint')}
        </DialogDescription>
        <div className="mt-4 grid max-h-[70vh] grid-cols-1 gap-4 overflow-y-auto md:grid-cols-[16rem_minmax(0,1fr)] md:overflow-visible">
          <div className="flex min-h-0 flex-col gap-3 md:max-h-[64vh] md:overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-fg-muted text-xs">{t('spaceTypes.enabled')}</h3>
              {canManage && space.enabledKindsRaw ? (
                <button
                  type="button"
                  onClick={() => void saveEnabled(null)}
                  className="inline-flex items-center gap-1 text-fg-muted text-xs hover:text-fg"
                  data-testid="space-types-reset"
                >
                  <RotateCcw className="size-3" />
                  {t('spaceTypes.resetDefault')}
                </button>
              ) : null}
            </div>
            <ul className="flex flex-col gap-0.5" data-testid="space-types-enabled">
              {enabled.map((k, i) => row(k, true, i))}
            </ul>
            {disabled.length ? (
              <>
                <h3 className="font-medium text-fg-muted text-xs">{t('spaceTypes.available')}</h3>
                <ul className="flex flex-col gap-0.5" data-testid="space-types-available">
                  {disabled.map((k, i) => row(k, false, i))}
                </ul>
              </>
            ) : null}
            {canManage && !space.isPersonal ? (
              <NewSpaceType spaceId={space.id} onCreated={(id) => setSelected(`type:${id}`)} />
            ) : null}
          </div>
          <div
            className="min-w-0 rounded-lg border border-divider p-3"
            data-testid="space-type-editor"
          >
            {cur ? (
              <TypeEditor
                key={cur}
                item={cur}
                canManage={canManage}
                canManageBuiltin={!!types.data?.canManageBuiltin}
                onDeleted={() => setSelected(null)}
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewSpaceType({
  spaceId,
  onCreated,
}: {
  spaceId: string
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const actions = useEntryTypeActions()
  const [name, setName] = useState('')
  const [color, setColor] = useState<PaletteName>('blue')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    actions.create.mutate(
      {
        name: name.trim(),
        color,
        spaceId,
        statuses: [
          t('spaceTypes.defaultTodo'),
          t('spaceTypes.defaultDoing'),
          t('spaceTypes.defaultDone'),
        ],
      },
      {
        onSuccess: (ty) => {
          setName('')
          onCreated(ty.id)
        },
      },
    )
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1 border-divider border-t pt-3">
      <ColorPicker
        value={color}
        onChange={setColor}
        label={t('settings.tags.color')}
        testId="space-type-new-color"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('spaceTypes.newPlaceholder')}
        aria-label={t('spaceTypes.new')}
        maxLength={20}
        className="h-8 flex-1"
        data-testid="space-type-new-name"
      />
      <Button type="submit" size="sm" disabled={!name.trim()} loading={actions.create.isPending}>
        <Plus className="size-4" />
        <span className="sr-only">{t('spaceTypes.new')}</span>
      </Button>
    </form>
  )
}

/** 选中类型的编辑区 */
function TypeEditor({
  item,
  canManage,
  canManageBuiltin,
  onDeleted,
}: {
  item: string
  canManage: boolean
  canManageBuiltin: boolean
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const types = useQuery(entryTypesQuery)
  const kindOf = useKindLabel()
  const actions = useEntryTypeActions()
  const [del, setDel] = useState(false)
  if (!item.startsWith('type:')) {
    const kind = item as BuiltinEntryKind
    const m = kindOf(kind)
    const defs = types.data?.builtin.find((b) => b.kind === kind)?.fieldDefs ?? []
    return (
      <div className="flex flex-col gap-3">
        <Header
          icon={<KindIcon kind={kind} size="sm" />}
          name={m.label}
          note={t('spaceTypes.builtinNote')}
        />
        <h4 className="font-medium text-sm">{t('builtinFields.title')}</h4>
        <BuiltinFieldsEditor kind={kind} canManage={canManageBuiltin} />
        <h4 className="font-medium text-sm">{t('spaceTypes.extraFields')}</h4>
        <TypeFieldsSection kind={kind} defs={defs} canManage={canManageBuiltin} compact />
      </div>
    )
  }
  const ty = types.data?.items.find((x) => x.id === item.slice(5))
  if (!ty) return null
  if (!ty.spaceId)
    return (
      <div className="flex flex-col gap-3">
        <Header
          icon={<KindIcon kind="custom" typeId={ty.id} size="sm" />}
          name={ty.name}
          note={t('spaceTypes.personalNote')}
        />
      </div>
    )
  const manage = canManage && ty.canManage
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ColorPicker
          value={ty.color as PaletteName}
          onChange={(c) => actions.patch.mutate({ id: ty.id, color: c })}
          label={t('settings.tags.color')}
          disabled={!manage}
          testId="space-type-color"
        />
        <div className="min-w-0 flex-1">
          {manage ? (
            <InlineEdit
              value={ty.name}
              label={t('settings.types.name')}
              onSave={(v) =>
                v.trim() && v.trim() !== ty.name
                  ? actions.patch.mutateAsync({ id: ty.id, name: v.trim() })
                  : undefined
              }
              className="font-semibold"
              testId="space-type-name"
            />
          ) : (
            <span className="font-semibold">{ty.name}</span>
          )}
        </div>
        <span className="text-fg-muted text-xs tabular-nums">
          {t('settings.types.usage', { count: ty.usage })}
        </span>
        {manage ? (
          <button
            type="button"
            aria-label={t('settings.types.delete')}
            title={t('settings.types.delete')}
            onClick={() => setDel(true)}
            className="grid size-8 place-items-center rounded-md text-danger hover:bg-hover"
            data-testid="space-type-delete"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      <StatusesEditor
        statuses={ty.statuses}
        colors={ty.statusColors}
        disabled={!manage}
        onSave={(v) => actions.patch.mutateAsync({ id: ty.id, ...v })}
      />
      <div className="flex flex-col gap-2">
        <h4 className="font-medium text-sm">{t('fieldDefs.title')}</h4>
        <TypeFieldsSection typeId={ty.id} defs={ty.fieldDefs} canManage={manage} compact />
      </div>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('spaceTypes.deleteTitle', { name: ty.name })}
        description={t('spaceTypes.deleteBody', { count: ty.usage })}
        confirmLabel={t('settings.types.delete')}
        onConfirm={() =>
          actions.remove.mutate(
            { id: ty.id },
            {
              onSuccess: () => {
                setDel(false)
                onDeleted()
              },
            },
          )
        }
      />
    </div>
  )
}

function Header({ icon, name, note }: { icon: React.ReactNode; name: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 font-semibold">
        {icon}
        {name}
      </div>
      <p className="text-fg-muted text-xs">{note}</p>
    </div>
  )
}

/**
 * 状态列表（带色）：每个状态一枚胶囊 + 选色；改名 / 增删改后「保存状态」一次提交
 *（renames 按位置对应原状态；删掉的状态其记录改为第一项，服务端处理）。
 */
function StatusesEditor({
  statuses,
  colors,
  disabled,
  onSave,
}: {
  statuses: string[]
  colors: Record<string, string>
  disabled: boolean
  onSave: (v: {
    statuses: string[]
    renames: Record<string, string>
    statusColors: Record<string, PaletteColor>
  }) => Promise<unknown>
}) {
  const { t } = useTranslation()
  type Row = { id: string; name: string; orig?: string; color: PaletteColor }
  const init = (): Row[] =>
    statuses.map((s, i) => ({
      id: s,
      name: s,
      orig: s,
      color: (colors[s] as PaletteColor | undefined) ?? positionTone(i, statuses.length),
    }))
  const [rows, setRows] = useState<Row[]>(init)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 服务端数据变化时重置草稿
  useEffect(() => setRows(init()), [statuses, colors])
  const dirty =
    JSON.stringify(rows.map((r) => [r.name, r.color])) !==
    JSON.stringify(init().map((r) => [r.name, r.color]))
  const valid =
    rows.every((r) => r.name.trim()) && new Set(rows.map((r) => r.name.trim())).size === rows.length
  const set = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <div className="flex flex-col gap-2" data-testid="space-type-statuses">
      <h4 className="font-medium text-sm">{t('spaceTypes.statuses')}</h4>
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map((r) => (
          <span
            key={r.id}
            className="inline-flex items-center gap-0.5 rounded-full border border-divider py-0.5 ps-0.5 pe-1"
          >
            <ColorPicker
              value={r.color as PaletteName}
              onChange={(c) => set(r.id, { color: c })}
              label={t('fieldDefs.optionColor')}
              disabled={disabled}
              testId="status-color"
            />
            {disabled ? (
              <StatusPill value={r.name} />
            ) : (
              <input
                value={r.name}
                onChange={(e) => set(r.id, { name: e.target.value })}
                maxLength={20}
                aria-label={t('spaceTypes.statusName')}
                className="w-20 bg-transparent text-sm outline-none"
                data-testid="status-name"
              />
            )}
            {disabled ? null : (
              <button
                type="button"
                aria-label={t('fieldDefs.removeOption')}
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                className="grid size-5 place-items-center rounded-full text-fg-muted hover:bg-hover"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {disabled || rows.length >= 12 ? null : (
          <button
            type="button"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  id: `new-${rs.length}-${Date.now()}`,
                  name: '',
                  color: positionTone(rs.length, rs.length + 2),
                },
              ])
            }
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-fg-muted text-xs hover:bg-hover"
            data-testid="status-add"
          >
            <Plus className="size-3" />
            {t('spaceTypes.addStatus')}
          </button>
        )}
      </div>
      {dirty && !disabled ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!valid}
            onClick={() =>
              void onSave({
                statuses: rows.map((r) => r.name.trim()),
                renames: Object.fromEntries(
                  rows
                    .filter((r) => r.orig && r.orig !== r.name.trim())
                    .map((r) => [r.orig as string, r.name.trim()]),
                ),
                statusColors: Object.fromEntries(rows.map((r) => [r.name.trim(), r.color])),
              })
            }
            data-testid="statuses-save"
          >
            {t('spaceTypes.saveStatuses')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRows(init())}>
            {t('fieldDefs.reset')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

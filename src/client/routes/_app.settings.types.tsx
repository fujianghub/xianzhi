/**
 * 类型管理（ADR-0016 · 0017、REQ-ENTRY-018 ~ 020）：
 * - 内置类型：全工作区统一，仅所有者可改名 · 改色（可恢复默认）· 删除（其下记录转到另一内置类型）· 恢复；属性与状态流转由代码定义。
 * - 自定义类型：个人的，只列本人的；本人可新建（名 + 色 + 状态列表）· 改名 · 改色 · 编辑状态 · 删除（其下记录转到所选类型）；guest 只读。
 * - 用量 · 查看记录。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultEntryFields, entryFieldsByKind } from '../../shared/schemas/entryFields.ts'
import { ColorPicker } from '../components/domain/ColorPicker.tsx'
import { KindIcon } from '../components/domain/KindIcon.tsx'
import type { PaletteName } from '../components/domain/SpaceIcon.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { InlineEdit } from '../components/ui/inline-edit.tsx'
import { Input } from '../components/ui/input.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import type { EntryKind } from '../lib/entry-queries.ts'
import {
  type EntryType,
  type EntryTypesList,
  entryTypesQuery,
  type KindMeta,
  kindKey,
  useKindLabel,
  useKindOptions,
} from '../lib/entry-types.ts'
import { newId } from '../lib/uuid.ts'

export const Route = createFileRoute('/_app/settings/types')({ component: TypesPage })

/** 状态输入：逗号 / 顿号 / 空白分隔，去重，最多 12 项 */
const splitStatuses = (s: string) =>
  [
    ...new Set(
      s
        .split(/[,，、|=\s]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12)

type BuiltinKind = EntryTypesList['builtin'][number]['kind']

function useTypeMutations() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const done = () => {
    void qc.invalidateQueries({ queryKey: entryTypesQuery.queryKey })
    void qc.invalidateQueries({ queryKey: ['entries'] })
    void qc.invalidateQueries({ queryKey: ['entry'] })
  }
  const ok = (key: string) => () => {
    toast.success(t(key))
    done()
  }
  const fail = (err: unknown) =>
    toast.error(
      err instanceof ApiError
        ? (err.problem.errors?.[0]?.message ?? err.message)
        : t('task.saveFailed'),
    )
  const create = useMutation({
    mutationFn: (v: { name: string; color: PaletteName; statuses: string[] }) =>
      unwrap<EntryType>(
        api['entry-types'].$post({ json: v }, { headers: { 'idempotency-key': newId() } }),
      ),
    onSuccess: ok('settings.types.created'),
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: (v: {
      id: string
      name?: string
      color?: PaletteName
      statuses?: string[]
      renames?: Record<string, string>
    }) => {
      const { id, ...json } = v
      return unwrap<EntryType>(
        api['entry-types'][':id'].$patch({ param: { id }, json: json as never }),
      )
    },
    onSuccess: ok('settings.types.saved'),
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (v: { id: string; moveTo?: string }) =>
      unwrap<void>(
        api['entry-types'][':id'].$delete({
          param: { id: v.id },
          query: v.moveTo ? { moveTo: v.moveTo } : {},
        }),
      ),
    onSuccess: ok('settings.types.deleted'),
    onError: fail,
  })
  const patchBuiltin = useMutation({
    mutationFn: (v: { kind: BuiltinKind; name?: string | null; color?: PaletteName | null }) => {
      const { kind, ...json } = v
      return unwrap<EntryTypesList>(
        api['entry-types'].builtin[':kind'].$patch({ param: { kind }, json }),
      )
    },
    onSuccess: ok('settings.types.saved'),
    onError: fail,
  })
  const removeBuiltin = useMutation({
    mutationFn: (v: { kind: BuiltinKind; moveTo?: string }) =>
      unwrap<EntryTypesList>(
        api['entry-types'].builtin[':kind'].$delete({
          param: { kind: v.kind },
          query: v.moveTo ? { moveTo: v.moveTo } : {},
        }),
      ),
    onSuccess: ok('settings.types.deleted'),
    onError: fail,
  })
  const restoreBuiltin = useMutation({
    mutationFn: (kind: BuiltinKind) =>
      unwrap<EntryTypesList>(
        api['entry-types'].builtin[':kind'].restore.$post({ param: { kind } }),
      ),
    onSuccess: ok('settings.types.restored'),
    onError: fail,
  })
  return { create, patch, remove, patchBuiltin, removeBuiltin, restoreBuiltin }
}
type M = ReturnType<typeof useTypeMutations>

/**
 * 删除时可选的转入目标：未删除的其它类型，且默认属性可直接成立（排除迭代 / 变更 / 复盘）；
 * 删内置类型时只能转到内置类型（大家的记录不能转进某人的私有类型）。
 */
function useMoveTargets(source: { kind: string; typeId: string | null }): KindMeta[] {
  return useKindOptions().filter(
    (o) =>
      kindKey(o) !== kindKey(source) &&
      (source.kind === 'custom' || o.kind !== 'custom') &&
      entryFieldsByKind[o.kind].safeParse(defaultEntryFields[o.kind]).success,
  )
}

/** 删除确认：选择其下记录转到哪个类型（默认随笔；删随笔时默认第一个可选项）。 */
function DeleteTypeDialog({
  open,
  onOpenChange,
  source,
  name,
  usage,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  source: { kind: string; typeId: string | null }
  name: string
  usage: number
  onConfirm: (moveTo: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const targets = useMoveTargets(source)
  const fallback = targets.find((o) => o.kind === 'note') ?? targets[0]
  const [pick, setPick] = useState<string | null>(null)
  const moveTo = pick ?? (fallback ? kindKey(fallback) : '')
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.types.deleteTitle', { name })}
      description={t('settings.types.deleteBody', { count: usage })}
      confirmLabel={t('settings.types.delete')}
      onConfirm={() => (moveTo ? onConfirm(moveTo) : undefined)}
    >
      <label className="mt-4 flex items-center gap-2 text-sm">
        <span className="shrink-0 text-fg-muted">{t('settings.types.moveTo')}</span>
        <select
          value={moveTo}
          onChange={(e) => setPick(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-2"
          data-testid="type-delete-move-to"
        >
          {targets.map((o) => (
            <option key={kindKey(o)} value={kindKey(o)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </ConfirmDialog>
  )
}

function TypesPage() {
  const { t } = useTranslation()
  const q = useQuery(entryTypesQuery)
  const m = useTypeMutations()
  const [name, setName] = useState('')
  const [color, setColor] = useState<PaletteName>('purple')
  const [statuses, setStatuses] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    m.create.mutate(
      { name: name.trim(), color, statuses: splitStatuses(statuses) },
      {
        onSuccess: () => {
          setName('')
          setStatuses('')
        },
      },
    )
  }
  const items = (q.data?.items ?? []).filter((ty) => ty.mine)
  const builtin = q.data?.builtin ?? []
  const alive = builtin.filter((b) => !b.deleted)
  const gone = builtin.filter((b) => b.deleted)
  const canManage = !!q.data?.canManageBuiltin
  return (
    <div className="flex flex-col gap-8" data-testid="types-page">
      <PageHeader title={t('settings.types.title')} description={t('settings.types.hint')} />
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-base">{t('settings.types.builtin')}</h2>
        <p className="text-fg-muted text-sm">{t('settings.types.builtinHint')}</p>
        {q.isPending ? <Skeleton className="h-40 w-full" /> : null}
        <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
          {alive.map((b) => (
            <BuiltinRow key={b.kind} b={b} canManage={canManage} m={m} />
          ))}
        </ul>
        {gone.length ? (
          <div className="flex flex-col gap-2" data-testid="deleted-builtins">
            <h3 className="text-fg-muted text-sm">{t('settings.types.deletedBuiltin')}</h3>
            <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider border-dashed">
              {gone.map((b) => (
                <li
                  key={b.kind}
                  className="flex items-center gap-3 px-3 py-2 text-fg-muted"
                  data-testid="deleted-builtin-row"
                  data-kind={b.kind}
                >
                  <KindIcon kind={b.kind} size="sm" />
                  <span className="flex-1 text-sm">{b.name ?? t(`entry.kind.${b.kind}`)}</span>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={m.restoreBuiltin.isPending}
                      onClick={() => m.restoreBuiltin.mutate(b.kind)}
                      data-testid="builtin-restore"
                    >
                      <Undo2 className="size-4" />
                      {t('settings.types.restore')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-base">{t('settings.types.custom')}</h2>
        {q.data?.canCreate ? (
          <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <ColorPicker
              value={color}
              onChange={setColor}
              label={t('settings.tags.color')}
              testId="type-color"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.types.namePlaceholder')}
              aria-label={t('settings.types.name')}
              maxLength={20}
              className="h-9 w-48"
              data-testid="type-new-name"
            />
            <Input
              value={statuses}
              onChange={(e) => setStatuses(e.target.value)}
              placeholder={t('settings.types.statusesPlaceholder')}
              aria-label={t('settings.types.statuses')}
              className="h-9 min-w-64 flex-1"
              data-testid="type-new-statuses"
            />
            <Button type="submit" size="sm" loading={m.create.isPending} disabled={!name.trim()}>
              <Plus className="size-4" />
              {t('settings.types.new')}
            </Button>
          </form>
        ) : null}
        {!q.isPending && !items.length ? (
          <p className="text-fg-muted text-sm">{t('settings.types.empty')}</p>
        ) : null}
        {items.length ? (
          <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
            {items.map((ty) => (
              <TypeRow key={ty.id} ty={ty} m={m} />
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}

function BuiltinRow({
  b,
  canManage,
  m,
}: {
  b: EntryTypesList['builtin'][number]
  canManage: boolean
  m: M
}) {
  const { t } = useTranslation()
  const meta = useKindLabel()(b.kind)
  const [del, setDel] = useState(false)
  const customized = b.name !== null || b.color !== null
  return (
    <li
      className="flex flex-wrap items-center gap-3 px-3 py-2"
      data-testid="builtin-row"
      data-kind={b.kind}
    >
      <ColorPicker
        value={meta.tone}
        onChange={(c) => m.patchBuiltin.mutate({ kind: b.kind, color: c })}
        label={t('settings.tags.color')}
        disabled={!canManage}
        testId="builtin-color"
      />
      <KindIcon kind={b.kind} size="sm" />
      <div className="min-w-24 flex-1">
        {canManage ? (
          <InlineEdit
            value={meta.label}
            label={t('settings.types.name')}
            onSave={(v) => {
              const next = v.trim()
              if (!next) return m.patchBuiltin.mutateAsync({ kind: b.kind, name: null })
              return next !== meta.label
                ? m.patchBuiltin.mutateAsync({ kind: b.kind, name: next })
                : undefined
            }}
            className="text-sm"
            testId="builtin-name"
          />
        ) : (
          <span className="text-sm">{meta.label}</span>
        )}
      </div>
      <span className="text-fg-muted text-xs tabular-nums">
        {t('settings.types.usage', { count: b.usage })}
      </span>
      <Link
        to="/entries"
        search={{ kind: b.kind as EntryKind }}
        className="text-primary-text text-xs hover:underline"
      >
        {t('settings.tags.viewEntries')}
      </Link>
      {canManage ? (
        <>
          {customized ? (
            <button
              type="button"
              title={t('settings.types.resetDefault')}
              aria-label={`${t('settings.types.resetDefault')} ${meta.label}`}
              onClick={() => m.patchBuiltin.mutate({ kind: b.kind, name: null, color: null })}
              className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover"
              data-testid="builtin-reset"
            >
              <RotateCcw className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            title={t('settings.types.delete')}
            aria-label={`${t('settings.types.delete')} ${meta.label}`}
            onClick={() => setDel(true)}
            className="grid size-8 place-items-center rounded-md text-danger hover:bg-hover"
            data-testid="builtin-delete"
          >
            <Trash2 className="size-4" />
          </button>
          <DeleteTypeDialog
            open={del}
            onOpenChange={setDel}
            source={{ kind: b.kind, typeId: null }}
            name={meta.label}
            usage={b.usage}
            onConfirm={(moveTo) => m.removeBuiltin.mutateAsync({ kind: b.kind, moveTo })}
          />
        </>
      ) : null}
    </li>
  )
}

function TypeRow({ ty, m }: { ty: EntryType; m: M }) {
  const { t } = useTranslation()
  const [del, setDel] = useState(false)
  const ro = !ty.canManage
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-testid="type-row" data-type-name={ty.name}>
      <div className="flex flex-wrap items-center gap-3">
        <ColorPicker
          value={ty.color as PaletteName}
          onChange={(c) => m.patch.mutate({ id: ty.id, color: c })}
          label={t('settings.tags.color')}
          disabled={ro}
          testId="type-color"
        />
        <KindIcon kind="custom" typeId={ty.id} size="sm" />
        <div className="min-w-32 flex-1">
          {ro ? (
            <span className="text-sm">{ty.name}</span>
          ) : (
            <InlineEdit
              value={ty.name}
              label={t('settings.types.name')}
              onSave={(v) =>
                v.trim() && v.trim() !== ty.name
                  ? m.patch.mutateAsync({ id: ty.id, name: v.trim() })
                  : undefined
              }
              className="text-sm"
              testId="type-name"
            />
          )}
        </div>
        <span className="text-fg-muted text-xs tabular-nums">
          {t('settings.types.usage', { count: ty.usage })}
        </span>
        <Link
          to="/entries"
          search={{ typeId: ty.id }}
          className="text-primary-text text-xs hover:underline"
        >
          {t('settings.tags.viewEntries')}
        </Link>
        {ro ? null : (
          <button
            type="button"
            title={t('settings.types.delete')}
            aria-label={`${t('settings.types.delete')} ${ty.name}`}
            onClick={() => setDel(true)}
            className="grid size-8 place-items-center rounded-md text-danger hover:bg-hover"
            data-testid="type-delete"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      <StatusEditor ty={ty} readOnly={ro} m={m} />
      {ro ? null : (
        <DeleteTypeDialog
          open={del}
          onOpenChange={setDel}
          source={{ kind: 'custom', typeId: ty.id }}
          name={ty.name}
          usage={ty.usage}
          onConfirm={(moveTo) => m.remove.mutateAsync({ id: ty.id, moveTo })}
        />
      )}
    </li>
  )
}

/**
 * 状态列表编辑：改名（同步其下记录）· 删除（其下记录改为第一项）· 左移（排序；第一项 = 新建默认值）· 添加。
 * 本地编辑，点「保存状态」一次提交 { statuses, renames }。
 */
function StatusEditor({ ty, readOnly, m }: { ty: EntryType; readOnly: boolean; m: M }) {
  const { t } = useTranslation()
  // 每项记住原名（新增项为 null），保存时得出 renames
  const init = () => ty.statuses.map((s) => ({ from: s as string | null, name: s }))
  const [rows, setRows] = useState(init)
  const [add, setAdd] = useState('')
  const next = rows.map((r) => r.name.trim()).filter(Boolean)
  const dirty = JSON.stringify(next) !== JSON.stringify(ty.statuses)
  const invalid = new Set(next).size !== next.length || next.some((s) => /[,|=]/.test(s))
  const save = () => {
    const renames: Record<string, string> = {}
    for (const r of rows)
      if (r.from && r.name.trim() && r.name.trim() !== r.from) renames[r.from] = r.name.trim()
    m.patch.mutate({ id: ty.id, statuses: next, renames })
  }
  const addOne = () => {
    for (const s of splitStatuses(add))
      if (!rows.some((r) => r.name === s)) setRows((rs) => [...rs, { from: null, name: s }])
    setAdd('')
  }
  if (readOnly)
    return (
      <p className="ps-12 text-fg-muted text-xs">
        {ty.statuses.length ? ty.statuses.join(' → ') : t('settings.types.noStatuses')}
      </p>
    )
  return (
    <div className="flex flex-wrap items-center gap-1.5 ps-12" data-testid="type-statuses">
      <span className="text-fg-muted text-xs">{t('settings.types.statuses')}</span>
      {rows.map((r, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 行内编辑时名字会变，按位置稳定
          key={i}
          className="inline-flex h-7 items-center gap-0.5 rounded-full border border-border ps-1 pe-0.5"
        >
          {i > 0 ? (
            <button
              type="button"
              aria-label={t('settings.types.moveLeft', { name: r.name })}
              onClick={() =>
                setRows((rs) => {
                  const c = [...rs]
                  const [x] = c.splice(i, 1)
                  if (x) c.splice(i - 1, 0, x)
                  return c
                })
              }
              className="grid size-5 place-items-center rounded-full text-fg-muted hover:bg-hover"
            >
              <ArrowLeft className="size-3" />
            </button>
          ) : null}
          <input
            value={r.name}
            onChange={(e) =>
              setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
            }
            aria-label={t('settings.types.statusName', { n: i + 1 })}
            maxLength={20}
            size={Math.max(2, r.name.length + 1)}
            className="bg-transparent px-1 text-xs outline-none"
            data-testid="type-status-input"
          />
          <button
            type="button"
            aria-label={t('settings.types.removeStatus', { name: r.name })}
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            className="grid size-5 place-items-center rounded-full text-fg-muted hover:bg-hover"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={add}
        onChange={(e) => setAdd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            addOne()
          }
        }}
        onBlur={() => add.trim() && addOne()}
        placeholder={t('settings.types.addStatus')}
        aria-label={t('settings.types.addStatus')}
        className="h-7 w-28 rounded-full border border-border border-dashed bg-transparent px-2.5 text-xs outline-none focus:border-selected-border"
        data-testid="type-status-add"
      />
      {dirty ? (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={invalid || rows.length > 12}
            loading={m.patch.isPending}
            onClick={save}
            data-testid="type-status-save"
          >
            {t('settings.types.saveStatuses')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRows(init())}>
            {t('settings.types.reset')}
          </Button>
        </>
      ) : null}
      {dirty ? (
        <p className="basis-full text-fg-muted text-xs">{t('settings.types.statusesHint')}</p>
      ) : null}
    </div>
  )
}

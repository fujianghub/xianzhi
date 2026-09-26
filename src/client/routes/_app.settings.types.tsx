/**
 * 记录类型管理（ADR-0016、REQ-ENTRY-018 · 019）：
 * - 自定义类型：新建（名 + 色 + 状态列表）· 改名 · 改色 · 编辑状态（增 / 删 / 改名 / 左移排序）· 删除（其下记录转为随手记）· 用量 · 查看记录；
 *   可管理 = 管理员或创建者（服务端 `can('entry_type.manage')`，每项带 canManage），不可管理的行只读。
 * - 内置类型：用量 · 查看记录 · 隐藏 / 显示（管理员；隐藏只影响筛选条与新建菜单）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { cn } from '../lib/cn.ts'
import type { EntryKind } from '../lib/entry-queries.ts'
import { type EntryType, type EntryTypesList, entryTypesQuery } from '../lib/entry-types.ts'
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

function useTypeMutations() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const done = () => {
    void qc.invalidateQueries({ queryKey: entryTypesQuery.queryKey })
    void qc.invalidateQueries({ queryKey: ['entries'] })
    void qc.invalidateQueries({ queryKey: ['entry'] })
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
    onSuccess: () => {
      toast.success(t('settings.types.created'))
      done()
    },
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
    onSuccess: () => {
      toast.success(t('settings.types.saved'))
      done()
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap<void>(api['entry-types'][':id'].$delete({ param: { id } })),
    onSuccess: () => {
      toast.success(t('settings.types.deleted'))
      done()
    },
    onError: fail,
  })
  const hide = useMutation({
    mutationFn: (v: { kind: string; hidden: boolean }) =>
      unwrap<EntryTypesList>(
        api['entry-types'].builtin[':kind'].$put({
          param: { kind: v.kind as never },
          json: { hidden: v.hidden },
        }),
      ),
    onSuccess: done,
    onError: fail,
  })
  return { create, patch, remove, hide }
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
  const items = q.data?.items ?? []
  return (
    <div className="flex flex-col gap-8" data-testid="types-page">
      <PageHeader title={t('settings.types.title')} description={t('settings.types.hint')} />
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
        {q.isPending ? <Skeleton className="h-24 w-full" /> : null}
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

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-base">{t('settings.types.builtin')}</h2>
        <p className="text-fg-muted text-sm">{t('settings.types.builtinHint')}</p>
        <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
          {(q.data?.builtin ?? []).map((b) => (
            <li
              key={b.kind}
              className={cn('flex items-center gap-3 px-3 py-2', b.hidden && 'opacity-60')}
              data-testid="builtin-row"
              data-kind={b.kind}
            >
              <KindIcon kind={b.kind} size="sm" />
              <span className="min-w-24 flex-1 text-sm">{t(`entry.kind.${b.kind}`)}</span>
              {b.hidden ? (
                <span className="text-fg-muted text-xs">{t('settings.types.hidden')}</span>
              ) : null}
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
              {q.data?.canManageBuiltin ? (
                <button
                  type="button"
                  onClick={() => m.hide.mutate({ kind: b.kind, hidden: !b.hidden })}
                  title={t(b.hidden ? 'settings.types.show' : 'settings.types.hide')}
                  aria-label={`${t(b.hidden ? 'settings.types.show' : 'settings.types.hide')} ${t(`entry.kind.${b.kind}`)}`}
                  className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover"
                  data-testid="builtin-toggle"
                >
                  {b.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function TypeRow({ ty, m }: { ty: EntryType; m: ReturnType<typeof useTypeMutations> }) {
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
            <span className="text-sm" title={t('settings.tags.readonly')}>
              {ty.name}
            </span>
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
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('settings.types.deleteTitle', { name: ty.name })}
        description={t('settings.types.deleteBody', { count: ty.usage })}
        confirmLabel={t('settings.types.delete')}
        onConfirm={() => m.remove.mutateAsync(ty.id).then(() => setDel(false))}
      />
    </li>
  )
}

/**
 * 状态列表编辑：改名（同步其下记录）· 删除（其下记录改为第一项）· 左移（排序；第一项 = 新建默认值）· 添加。
 * 本地编辑，点「保存状态」一次提交 { statuses, renames }。
 */
function StatusEditor({
  ty,
  readOnly,
  m,
}: {
  ty: EntryType
  readOnly: boolean
  m: ReturnType<typeof useTypeMutations>
}) {
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

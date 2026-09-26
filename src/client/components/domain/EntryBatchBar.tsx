/**
 * 记录批量操作条（ADR-0014、REQ-ENTRY-013；ADR-0016、REQ-ENTRY-017）：有选中时吸底显示；
 * 移动到空间 · 改类型 · 改状态 · 加 / 去标签 · 固定 · 归档 / 取消归档 · 删除。
 * 一次 `POST /entries/batch`，逐条鉴权；部分失败时 Toast 给出数量与首个原因。编辑类操作后保留选择，删除 / 归档 / 移动后只留失败项。
 * 改状态：按所选记录的类型分组列出各自的状态，只对该组记录下发（不同类型的状态互不相通）。
 * 改类型：迭代 / 变更 / 复盘有无默认值的必填属性，不在批量目标里（单篇在属性栏改）。
 */
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  FolderInput,
  Pin,
  Shapes,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultEntryFields, entryFieldsByKind } from '../../../shared/schemas/entryFields.ts'
import { type BatchInput, useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { kindKey, useKindLabel, useKindOptions } from '../../lib/entry-types.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'
import { KindIcon } from './KindIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { tagsQuery } from './TagPicker.tsx'

/** 去掉 ids 的批量入参（按 op 分配，保持判别联合） */
type OpInput = BatchInput extends infer U ? (U extends unknown ? Omit<U, 'ids'> : never) : never

export function EntryBatchBar({
  selected,
  items,
  setSelected,
  onSelectAll,
  archivedView,
}: {
  selected: string[]
  /** 当前页已加载的记录（按类型分组状态用） */
  items: Entry[]
  setSelected: (ids: string[]) => void
  onSelectAll: () => void
  /** 已归档视图里给「取消归档」，否则给「归档」 */
  archivedView: boolean
}) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  const spaces = useQuery(spacesQuery())
  const tags = useQuery(tagsQuery)
  const kindOf = useKindLabel()
  // 批量改类型的目标：默认 fields 能通过校验的类型
  const retypeTargets = useKindOptions().filter(
    (o) => entryFieldsByKind[o.kind].safeParse(defaultEntryFields[o.kind]).success,
  )
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const n = selected.length
  const selSet = new Set(selected)
  const chosen = items.filter((e) => selSet.has(e.id))
  // 所选记录按类型分组，列出各自可选的状态
  const groups = [
    ...new Map(chosen.map((e) => [kindKey({ kind: e.kind, typeId: e.typeId }), e])).values(),
  ]
    .map((e) => {
      const meta = kindOf(e.kind, e.typeId)
      const spec = fieldSpecs(e.kind, meta.statuses).find((f) => f.name === 'status')
      const ids = chosen.filter((x) => x.kind === e.kind && x.typeId === e.typeId).map((x) => x.id)
      return spec?.kind === 'select'
        ? { meta, ids, options: spec.options.map(String), raw: !!spec.raw }
        : null
    })
    .filter((g) => g !== null)

  const run = async (input: OpInput, ids: string[] = selected) => {
    setBusy(true)
    try {
      const r = await actions.batch({ ...input, ids } as BatchInput)
      if (r.failed.length)
        toast.error(
          t('entry.batch.partial', {
            ok: r.ok.length,
            failed: r.failed.length,
            reason: r.failed[0]?.message ?? '',
          }),
        )
      else toast.success(t('entry.batch.result', { ok: r.ok.length }))
      // 编辑类操作（改类型 / 状态 / 标签 / 固定）保留选择，便于接着改；删除 / 归档 / 移动后记录离开当前视图 → 只留失败项
      const keep =
        input.op === 'retype' ||
        input.op === 'fields' ||
        input.op === 'tags' ||
        input.op === 'pin' ||
        input.op === 'unpin'
      if (!keep) {
        const untouched = selected.filter((id) => !ids.includes(id))
        setSelected([...untouched, ...r.failed.map((f) => f.id)])
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const iconBtn = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-hover'
  const menuItem =
    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover'
  return (
    <div
      role="toolbar"
      aria-label={t('entry.batch.bar')}
      data-testid="entry-batch-bar"
      className="glass sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-1 rounded-full border border-border px-3 py-1.5 shadow-card"
    >
      <span className="px-2 font-medium text-sm tabular-nums" data-testid="batch-count">
        {t('entry.batch.selected', { count: n })}
      </span>
      <button type="button" className={iconBtn} onClick={onSelectAll}>
        {t('entry.batch.selectAll')}
      </button>
      <span className="mx-1 h-5 w-px bg-divider" aria-hidden />
      <Popover>
        <PopoverTrigger asChild disabled={!n || busy}>
          <button type="button" className={iconBtn} data-testid="batch-retype">
            <Shapes className="size-4" />
            {t('entry.batch.retype')}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
          {retypeTargets.map((o) => (
            <button
              key={kindKey(o)}
              type="button"
              onClick={() =>
                void run({
                  op: 'retype',
                  kind: o.kind,
                  ...(o.typeId ? { typeId: o.typeId } : {}),
                })
              }
              className={menuItem}
              data-testid="batch-retype-target"
              data-kind={kindKey(o)}
            >
              <KindIcon kind={o.kind} typeId={o.typeId} size="xs" />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild disabled={!n || busy || !groups.length}>
          <button
            type="button"
            className={iconBtn}
            data-testid="batch-status"
            title={groups.length ? undefined : t('entry.batch.noStatus')}
          >
            <CircleDot className="size-4" />
            {t('entry.batch.status')}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-60 overflow-y-auto p-1">
          {groups.map((g) => (
            <div key={kindKey(g.meta)} className="py-1">
              <p className="px-2 pb-1 text-fg-muted text-xs">
                {g.meta.label} · {t('entry.batch.count', { count: g.ids.length })}
              </p>
              {g.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => void run({ op: 'fields', set: { status: o } }, g.ids)}
                  className={menuItem}
                  data-testid="batch-status-option"
                  data-status={o}
                >
                  {g.raw ? o : t(`entry.fieldValue.${o}`, { defaultValue: o })}
                </button>
              ))}
            </div>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild disabled={!n || busy}>
          <button type="button" className={iconBtn} data-testid="batch-move">
            <FolderInput className="size-4" />
            {t('entry.batch.moveTo')}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
          {(spaces.data ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void run({ op: 'move', spaceId: s.id })}
              className={menuItem}
              data-testid="batch-move-target"
            >
              <span className="truncate">{s.isPersonal ? t('space.personal') : s.name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild disabled={!n || busy}>
          <button type="button" className={iconBtn} data-testid="batch-tags">
            <TagIcon className="size-4" />
            {t('entry.batch.addTag')}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-1">
          {(tags.data ?? []).map((tag) => (
            <div key={tag.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void run({ op: 'tags', add: [tag.id], remove: [] })}
                className={cn(menuItem, 'flex-1')}
                data-testid="batch-tag-add"
              >
                <span
                  aria-hidden
                  className={cn('size-3 rounded-full', PALETTE_CLASS[tag.color as PaletteName])}
                />
                <span className="truncate">{tag.name}</span>
              </button>
              <button
                type="button"
                title={t('entry.batch.removeTag')}
                aria-label={`${t('entry.batch.removeTag')} ${tag.name}`}
                onClick={() => void run({ op: 'tags', add: [], remove: [tag.id] })}
                className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        className={iconBtn}
        disabled={!n || busy}
        onClick={() =>
          void run({ op: chosen.every((e) => e.pinned) && chosen.length ? 'unpin' : 'pin' })
        }
        data-testid="batch-pin"
      >
        <Pin className="size-4" />
        {t(chosen.length && chosen.every((e) => e.pinned) ? 'entry.unpin' : 'entry.batch.pin')}
      </button>
      <button
        type="button"
        className={iconBtn}
        disabled={!n || busy}
        onClick={() => void run({ op: archivedView ? 'unarchive' : 'archive' })}
        data-testid="batch-archive"
      >
        {archivedView ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        {t(archivedView ? 'entry.batch.unarchive' : 'entry.batch.archive')}
      </button>
      <button
        type="button"
        className={cn(iconBtn, 'text-danger')}
        disabled={!n || busy}
        onClick={() => setConfirm(true)}
        data-testid="batch-delete"
      >
        <Trash2 className="size-4" />
        {t('entry.batch.delete')}
      </button>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={() => setSelected([])}
        disabled={!n}
      >
        {t('entry.batch.clear')}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('entry.batch.deleteTitle', { count: n })}
        description={t('entry.batch.deleteBody')}
        confirmLabel={t('entry.batch.delete')}
        onConfirm={() => run({ op: 'delete' })}
      />
    </div>
  )
}

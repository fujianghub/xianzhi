/**
 * 记录批量操作条（ADR-0014、REQ-ENTRY-013）：多选模式下吸底显示；移动到空间 · 加 / 去标签 · 归档 / 取消归档 · 删除。
 * 一次 `POST /entries/batch`，逐条鉴权；部分失败时 Toast 给出数量与首个原因，失败项保持选中。
 */
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, FolderInput, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type BatchInput, useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { tagsQuery } from './TagPicker.tsx'

/** 去掉 ids 的批量入参（按 op 分配，保持判别联合） */
type OpInput = BatchInput extends infer U ? (U extends unknown ? Omit<U, 'ids'> : never) : never

export function EntryBatchBar({
  selected,
  setSelected,
  onSelectAll,
  archivedView,
}: {
  selected: string[]
  setSelected: (ids: string[]) => void
  onSelectAll: () => void
  /** 已归档视图里给「取消归档」，否则给「归档」 */
  archivedView: boolean
}) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  const spaces = useQuery(spacesQuery())
  const tags = useQuery(tagsQuery)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const n = selected.length

  const run = async (input: OpInput) => {
    setBusy(true)
    try {
      const r = await actions.batch({ ...input, ids: selected } as BatchInput)
      if (r.failed.length)
        toast.error(
          t('entry.batch.partial', {
            ok: r.ok.length,
            failed: r.failed.length,
            reason: r.failed[0]?.message ?? '',
          }),
        )
      else toast.success(t('entry.batch.result', { ok: r.ok.length }))
      setSelected(r.failed.map((f) => f.id))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const iconBtn = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-hover'
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
              className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-hover"
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
                className="flex h-8 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover"
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

/**
 * 空间批量操作条（ADR-0021、REQ-SPACE-010 · 011）：批量管理模式下吸底显示；
 * 归档 / 取消归档 · 移到大类 · 删除（仅工作区 owner / admin）。一次 `POST /spaces/batch`，逐个鉴权；部分失败时 Toast 给出数量与首个原因。
 * 删除先 dryRun 取可删项与影响计数（记录 / 任务）写进确认弹层；删除与归档后 Toast 带「撤销」（restore / unarchive 刚成功的那几个）。
 */
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, FolderInput, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  type Space,
  type SpaceBatchInput,
  type SpaceBatchResult,
  spaceGroupsQuery,
  useSpaceBatch,
} from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE_DOT, type PaletteName } from './SpaceIcon.tsx'

const RETENTION_DAYS = 30

/** 去掉 ids 的批量入参（按 op 分配，保持判别联合） */
type OpInput = SpaceBatchInput extends infer U
  ? U extends unknown
    ? Omit<U, 'ids'>
    : never
  : never

export function SpaceBatchBar({
  selected,
  chosen,
  setSelected,
  onSelectAll,
  canDelete,
}: {
  selected: string[]
  /** 已选空间对象（判断归档态） */
  chosen: Space[]
  setSelected: (ids: string[]) => void
  onSelectAll: () => void
  /** 工作区 owner / admin 才显示删除 */
  canDelete: boolean
}) {
  const { t } = useTranslation()
  const batch = useSpaceBatch()
  const groups = useQuery(spaceGroupsQuery)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SpaceBatchResult | null>(null)
  const n = selected.length
  const allArchived = chosen.length > 0 && chosen.every((s) => !!s.archivedAt)

  const report = (r: SpaceBatchResult) => {
    if (r.failed.length)
      toast.error(
        t('space.batch.partial', {
          ok: r.ok.length,
          failed: r.failed.length,
          reason: r.failed[0]?.message ?? '',
        }),
      )
  }
  const undo = (op: 'restore' | 'unarchive' | 'archive', ids: string[]) => ({
    label: t('space.batch.undo'),
    onClick: () =>
      void batch({ op, ids })
        .then(() => toast.success(t('space.batch.undone')))
        .catch(() => toast.error(t('task.saveFailed'))),
  })

  const run = async (input: OpInput, ids: string[] = selected) => {
    setBusy(true)
    try {
      const r = await batch({ ...input, ids } as SpaceBatchInput)
      report(r)
      if (!r.failed.length) {
        if (input.op === 'archive' || input.op === 'unarchive')
          toast.success(
            input.op === 'archive'
              ? t('space.batch.archived', { count: r.ok.length })
              : t('space.batch.result', { ok: r.ok.length }),
            { action: undo(input.op === 'archive' ? 'unarchive' : 'archive', r.ok) },
          )
        else if (input.op === 'delete')
          toast.success(t('space.batch.deleted', { count: r.ok.length }), {
            action: undo('restore', r.ok),
          })
        else toast.success(t('space.batch.result', { ok: r.ok.length }))
      }
      // 归档 / 删除后空间离开当前分区；移动后仍在页上但换了分区 —— 统一只留失败项，便于看清哪些没处理
      setSelected(r.failed.map((f) => f.id))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const askDelete = async () => {
    setBusy(true)
    try {
      const r = await batch({ op: 'delete', ids: selected, dryRun: true })
      if (!r.ok.length) report(r)
      else setPreview(r)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-hover'
  const menuItem =
    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover'
  return (
    <div
      role="toolbar"
      aria-label={t('space.batch.bar')}
      data-testid="space-batch-bar"
      className="glass xz-batch-in sticky bottom-4 z-20 mt-6 flex flex-wrap items-center gap-1 rounded-full px-3 py-1.5"
    >
      <span className="px-2 font-medium text-sm tabular-nums" data-testid="space-batch-count">
        {t('space.batch.selected', { count: n })}
      </span>
      <button type="button" className={btn} onClick={onSelectAll} data-testid="space-batch-all">
        {t('space.batch.selectAll')}
      </button>
      <span className="mx-1 h-5 w-px bg-divider" aria-hidden />
      <button
        type="button"
        className={btn}
        disabled={!n || busy}
        onClick={() => void run({ op: allArchived ? 'unarchive' : 'archive' })}
        data-testid="space-batch-archive"
      >
        {allArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        {t(allArchived ? 'space.batch.unarchive' : 'space.batch.archive')}
      </button>
      <Popover>
        <PopoverTrigger asChild disabled={!n || busy}>
          <button type="button" className={btn} data-testid="space-batch-move">
            <FolderInput className="size-4" />
            {t('space.batch.moveTo')}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
          {[...(groups.data ?? []), null].map((g) => (
            <button
              key={g?.id ?? 'none'}
              type="button"
              onClick={() => void run({ op: 'move', groupId: g?.id ?? null })}
              className={menuItem}
              data-testid="space-batch-move-target"
              data-group-id={g?.id ?? 'none'}
            >
              <span
                aria-hidden
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  PALETTE_DOT[(g?.color as PaletteName | null) ?? 'gray'],
                )}
              />
              <span className="truncate">{g?.name ?? t('space.ungrouped')}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {canDelete ? (
        <button
          type="button"
          className={cn(btn, 'text-danger')}
          disabled={!n || busy}
          onClick={() => void askDelete()}
          data-testid="space-batch-delete"
        >
          <Trash2 className="size-4" />
          {t('space.batch.delete')}
        </button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={() => setSelected([])}
        disabled={!n}
      >
        {t('space.batch.clear')}
      </Button>
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(v) => !v && setPreview(null)}
        title={t('space.batch.deleteTitle', { count: preview?.ok.length ?? 0 })}
        description={t('space.batch.deleteBody', {
          entries: preview?.counts.entries ?? 0,
          tasks: preview?.counts.tasks ?? 0,
          days: RETENTION_DAYS,
        })}
        confirmLabel={t('space.batch.delete')}
        onConfirm={() => (preview ? run({ op: 'delete' }, preview.ok) : undefined)}
      >
        {preview?.failed.length ? (
          <p className="mt-2 text-fg-muted text-sm" data-testid="space-batch-skipped">
            {t('space.batch.deleteSkipped', { count: preview.failed.length })}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

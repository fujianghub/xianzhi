/**
 * 历史版本预览（REQ-COLLAB-008、03 §5）：只读 schemaKit 编辑器渲染快照正文（与编辑页同一套节点视图）；
 * 「对比当前」按顶层块 LCS 合并（与 collab 恢复同一算法，预览所见 = 恢复所得）：
 * 绿 = 此版本有、当前没有（恢复后出现）；红删除线 = 当前有、此版本没有（恢复后消失）。
 * 恢复经 API 审计后由 collab 写回在线文档，编辑页经协同实时看到结果。
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type BlockOp, diffBlocks } from '../../shared/editor/diff.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { ReadOnlyDoc } from './ReadOnlyDoc.tsx'

export interface SnapshotMeta {
  id: string
  label: string | null
  ydocVersion: number
  createdAt: string
}

interface SnapshotContent extends SnapshotMeta {
  pmJson: PmNode
  currentPmJson: PmNode
}

export default function SnapshotPreview({
  entryId,
  snap,
  canWrite,
  onOpenChange,
  onRestored,
}: {
  entryId: string
  snap: SnapshotMeta | null
  canWrite: boolean
  onOpenChange: (open: boolean) => void
  onRestored: () => void
}) {
  const { t } = useTranslation()
  const [compare, setCompare] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const q = useQuery({
    queryKey: ['entry', entryId, 'snapshots', snap?.id, 'content'],
    enabled: !!snap,
    queryFn: () =>
      unwrap<SnapshotContent>(
        api.entries[':id'].snapshots[':sid'].content.$get({
          param: { id: entryId, sid: snap?.id ?? '' },
        }),
      ),
  })
  const view = useMemo(() => {
    const data = q.data
    if (!data) return null
    if (!compare) return { doc: data.pmJson, ops: [] as BlockOp[] }
    const d = diffBlocks(data.currentPmJson.content ?? [], data.pmJson.content ?? [])
    return {
      doc: { type: 'doc', content: d.map((x) => x.node) } as PmNode,
      ops: d.map((x) => x.op),
      added: d.filter((x) => x.op === 'add').length,
      removed: d.filter((x) => x.op === 'del').length,
    }
  }, [q.data, compare])
  const restore = useMutation({
    mutationFn: () =>
      unwrap<{ accepted: true }>(
        api.entries[':id'].snapshots[':sid'].restore.$post({
          param: { id: entryId, sid: snap?.id ?? '' },
        }),
      ),
    onSuccess: () => {
      toast.success(t('entry.history.restored'))
      onRestored()
      onOpenChange(false)
    },
    onError: () => toast.error(t('entry.history.restoreFailed')),
  })

  return (
    <Dialog open={!!snap} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] w-[min(96vw,60rem)] flex-col"
        data-testid="snapshot-preview"
      >
        <div className="flex flex-wrap items-center gap-3 pe-8">
          <DialogTitle className="truncate">
            {snap?.label ?? t('entry.history.auto', { version: snap?.ydocVersion ?? 0 })}
          </DialogTitle>
          {snap ? <RelativeTime date={snap.createdAt} className="text-fg-muted text-sm" /> : null}
          <div className="ms-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={compare}
              data-testid="snapshot-compare"
              onClick={() => setCompare((v) => !v)}
              className={cn(compare && 'bg-selected')}
            >
              {t('entry.history.compare')}
            </Button>
            {canWrite ? (
              <Button
                variant="primary"
                size="sm"
                data-testid="snapshot-restore"
                disabled={!q.data}
                onClick={() => setConfirm(true)}
              >
                {t('entry.history.restore')}
              </Button>
            ) : null}
          </div>
        </div>
        <DialogDescription className="mt-1 text-fg-muted text-xs">
          {compare && view && 'added' in view
            ? t('entry.history.diffSummary', { added: view.added, removed: view.removed })
            : t('entry.history.previewHint')}
        </DialogDescription>
        {compare ? (
          <div className="mt-2 flex gap-3 text-xs" aria-hidden>
            <span className="xz-diff-add rounded px-1.5">{t('entry.history.legendAdd')}</span>
            <span className="xz-diff-del rounded px-1.5">{t('entry.history.legendDel')}</span>
          </div>
        ) : null}
        <div className="mt-3 min-h-40 flex-1 overflow-y-auto rounded-md border border-border p-4">
          {view ? (
            <ReadOnlyDoc doc={view.doc} ops={view.ops} />
          ) : q.isError ? (
            <p className="text-danger text-sm">{t('entry.history.loadFailed')}</p>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t('entry.history.confirmTitle')}
          description={t('entry.history.confirmBody')}
          confirmLabel={t('entry.history.restore')}
          onConfirm={() => restore.mutateAsync()}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * 合并空间对话框（ADR-0022、REQ-SPACE-015）：从空间卡片 ⋯「合并到…」打开。
 * 第一步选目标空间（排除自己、个人空间、已归档与无权管理的）；选中即 dryRun，写明将搬移的记录 / 任务数、并入成员数，
 * 可见性会扩大时单独警告；确认后执行，源空间移入回收站，Toast 可直接打开目标空间。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Merge } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type Space, spacesQuery } from '../../hooks/useSpaces.ts'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'

interface Preview {
  entries: number
  tasks: number
  members: number
  visibilityWidened: boolean
}

export function MergeSpaceDialog({
  space,
  open,
  onOpenChange,
}: {
  space: Space
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const nav = useNavigate()
  const spaces = useQuery({ ...spacesQuery(), enabled: open })
  const [target, setTarget] = useState<Space | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const targets = (spaces.data ?? []).filter(
    (s) => s.id !== space.id && !s.isPersonal && !s.archivedAt && s.myRole === 'admin',
  )

  useEffect(() => {
    if (!open) {
      setTarget(null)
      setPreview(null)
    }
  }, [open])

  const call = (into: string, dryRun: boolean) =>
    unwrap<{ preview: Preview; into?: Space }>(
      api.spaces[':id'].merge.$post({ param: { id: space.id }, json: { into, dryRun } }),
    )

  const pick = async (s: Space) => {
    setTarget(s)
    setPreview(null)
    setBusy(true)
    try {
      setPreview((await call(s.id, true)).preview)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
      setTarget(null)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    try {
      const r = await call(target.id, false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['spaces'] }),
        qc.invalidateQueries({ queryKey: ['space'] }),
        qc.invalidateQueries({ queryKey: ['entries'] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
      ])
      onOpenChange(false)
      const slug = r.into?.slug ?? target.slug
      toast.success(t('space.merge.done', { from: space.name, into: target.name }), {
        action: {
          label: t('space.merge.open'),
          onClick: () => void nav({ to: '/spaces/$spaceSlug/home', params: { spaceSlug: slug } }),
        },
      })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,30rem)]" data-testid="merge-space-dialog">
        <DialogTitle>{t('space.merge.title', { name: space.name })}</DialogTitle>
        <DialogDescription className="mt-2 text-fg-muted text-sm">
          {t('space.merge.hint')}
        </DialogDescription>
        <p className="mt-4 mb-2 font-medium text-sm">{t('space.merge.pick')}</p>
        {targets.length ? (
          <ul
            className="max-h-56 overflow-y-auto rounded-lg border border-border p-1"
            aria-label={t('space.merge.pick')}
          >
            {targets.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={target?.id === s.id}
                  onClick={() => void pick(s)}
                  disabled={busy}
                  className={cn(
                    'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover',
                    target?.id === s.id && 'bg-selected',
                  )}
                  data-testid="merge-target"
                  data-space-id={s.id}
                >
                  <SpaceIcon
                    icon={s.icon}
                    kind={s.kind}
                    color={s.color}
                    className="size-6 text-xs"
                  />
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted text-sm">{t('space.merge.noTarget')}</p>
        )}
        {target && preview ? (
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm" data-testid="merge-preview">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">{space.name}</span>
              <ArrowRight className="size-4 shrink-0 text-fg-muted" />
              <span className="truncate">{target.name}</span>
            </p>
            <p className="mt-2 text-fg-muted">
              {t('space.merge.summary', {
                entries: preview.entries,
                tasks: preview.tasks,
                members: preview.members,
              })}
            </p>
            {preview.visibilityWidened ? (
              <p
                className="mt-2 flex gap-2 text-danger"
                role="alert"
                data-testid="merge-visibility-warning"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {t('space.merge.widened', { from: space.name })}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('ui.action.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!preview}
            loading={busy && !!preview}
            onClick={() => void confirm()}
            data-testid="merge-confirm"
          >
            <Merge className="size-4" />
            {t('space.merge.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

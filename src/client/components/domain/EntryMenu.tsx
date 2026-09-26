/**
 * 记录 ⋯ 菜单（ADR-0014、REQ-ENTRY-014）：收藏 · 固定 · 导出 md / html · 归档 / 取消归档 · 删除（确认 + Toast 撤销）。
 * 详情页页头与卡片悬停共用；写操作按乐观权限显示，最终由服务端 `can()` 判定。
 */
import { Archive, ArchiveRestore, Download, MoreHorizontal, Pin, Star, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { downloadEntryExport } from '../../lib/entry-export.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'

export function EntryMenu({
  entry,
  canWrite,
  onDeleted,
  className,
}: {
  entry: Entry
  canWrite: boolean
  /** 删除成功后（详情页据此返回列表） */
  onDeleted?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const title = entry.title || t('entry.untitled')
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const run = (fn: () => Promise<unknown> | unknown) => () => {
    setOpen(false)
    void Promise.resolve()
      .then(fn)
      .catch(() => undefined)
  }
  const item = (
    key: string,
    icon: ReactNode,
    label: string,
    onClick: () => void,
    danger?: boolean,
  ) => (
    <li key={key}>
      <button
        type="button"
        onClick={onClick}
        data-testid={`entry-menu-${key}`}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover',
          danger && 'text-danger',
        )}
      >
        {icon}
        {label}
      </button>
    </li>
  )
  const archived = !!entry.archivedAt
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('entry.menu.label')}
            title={t('entry.menu.label')}
            data-testid="entry-menu"
            className={cn(
              'grid size-7 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg',
              className,
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-48 p-1">
          <ul aria-label={t('entry.menu.label')}>
            {item(
              'favorite',
              <Star className={cn('size-4', entry.favorited && 'fill-current text-warning')} />,
              t(entry.favorited ? 'entry.menu.unfavorite' : 'entry.menu.favorite'),
              run(() => actions.favorite(entry, !entry.favorited)),
            )}
            {canWrite
              ? item(
                  'pin',
                  <Pin className="size-4" />,
                  t(entry.pinned ? 'entry.unpin' : 'entry.pin'),
                  run(() => actions.patch(entry, { pinned: !entry.pinned })),
                )
              : null}
            {item(
              'export-md',
              <Download className="size-4" />,
              t('entry.menu.exportMd'),
              run(() =>
                downloadEntryExport(entry.id, 'md').catch(() =>
                  toast.error(t('entry.menu.exportFailed')),
                ),
              ),
            )}
            {item(
              'export-html',
              <Download className="size-4" />,
              t('entry.menu.exportHtml'),
              run(() =>
                downloadEntryExport(entry.id, 'html').catch(() =>
                  toast.error(t('entry.menu.exportFailed')),
                ),
              ),
            )}
            {canWrite
              ? item(
                  'archive',
                  archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />,
                  t(archived ? 'entry.menu.unarchive' : 'entry.menu.archive'),
                  run(() =>
                    actions
                      .archive(entry, !archived)
                      .then(() =>
                        toast.success(
                          archived
                            ? t('entry.menu.unarchivedToast')
                            : t('entry.menu.archivedToast', { title }),
                        ),
                      )
                      .catch(fail),
                  ),
                )
              : null}
            {canWrite
              ? item(
                  'delete',
                  <Trash2 className="size-4" />,
                  t('entry.menu.delete'),
                  () => {
                    setOpen(false)
                    setConfirm(true)
                  },
                  true,
                )
              : null}
          </ul>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('entry.menu.deleteTitle')}
        description={t('entry.menu.deleteBody')}
        confirmLabel={t('entry.menu.delete')}
        onConfirm={async () => {
          try {
            await actions.remove(entry)
          } catch (err) {
            fail(err)
            return
          }
          onDeleted?.()
          toast.success(t('entry.menu.deleted', { title }), {
            action: {
              label: t('entry.menu.undo'),
              onClick: () =>
                void actions
                  .restore(entry.id)
                  .then(() => toast.success(t('entry.menu.restored')))
                  .catch(fail),
            },
          })
        }}
      />
    </>
  )
}

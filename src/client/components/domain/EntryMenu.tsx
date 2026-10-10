/**
 * 记录 ⋯ 菜单（ADR-0014、REQ-ENTRY-014）：收藏 · 固定 · 导出 md / html · 归档 / 取消归档 · 删除（确认 + Toast 撤销）。
 * ADR-0018（REQ-ENTRY-023）：新建子页面（仅当本篇在目录里）· 新建关联记录（同级、自动关联「相关」）。
 * ADR-0054 §C（REQ-ENTRY-038 · 039）：创建副本 · 复制到… · 移动到…。
 * 详情页页头与卡片悬停共用；写操作按乐观权限显示，最终由服务端 `can()` 判定。
 */

import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Clipboard,
  Copy,
  CopyPlus,
  Download,
  FilePlus2,
  FolderInput,
  Link2,
  MoreHorizontal,
  Pin,
  Star,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { hotkeyParts } from '../../hooks/useCommands.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { useMe } from '../../hooks/useMe.ts'
import { entryPageContext } from '../../hooks/useNewEntryContext.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { COPY_TITLE_HOTKEY, copyTitle } from '../../lib/copy-title.ts'
import { downloadEntryExport } from '../../lib/entry-export.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import type { Space } from '../../lib/space-queries.ts'
import { useNewEntry } from '../../lib/stores.ts'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { KeyHint } from '../ui/key-hint.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { EntryPlaceDialog, useQuickDuplicate } from './EntryPlaceDialog.tsx'

export function EntryMenu({
  entry,
  canWrite,
  onDeleted,
  navigateAfterDelete,
  className,
}: {
  entry: Entry
  canWrite: boolean
  /** 删除成功后 */
  onDeleted?: () => void
  /**
   * 详情页用（ADR-0035、REQ-KB-013）：删除后回到父页 → 否则所在空间概览 → 个人空间（或空间未缓存）回 /entries。
   */
  navigateAfterDelete?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const nav = useNavigate()
  const afterDelete = () => {
    onDeleted?.()
    if (!navigateAfterDelete) return
    if (entry.parentId)
      return void nav({ to: '/entries/$entryId', params: { entryId: entry.parentId } })
    const space = qc.getQueryData<Space>(['space', entry.spaceSlug])
    if (space && !space.isPersonal)
      return void nav({ to: '/spaces/$spaceSlug/home', params: { spaceSlug: entry.spaceSlug } })
    void nav({ to: '/entries', search: {} })
  }
  const actions = useEntryActions()
  const openNew = useNewEntry((s) => s.setOpen)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [place, setPlace] = useState<'move' | 'copy' | null>(null)
  const duplicate = useQuickDuplicate()
  // 复制只要能读 + 能在某处建记录（访客不能建，ADR-0054 §C）；移动要能写本篇
  const { data: me } = useMe()
  const canCopy = !!me && me.workspaceRole !== 'guest'
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
    hint?: string,
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
        {hint ? <KeyHint keys={hotkeyParts(hint)} className="ms-auto" /> : null}
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
        <PopoverContent align="end" className="w-56 p-1">
          <ul aria-label={t('entry.menu.label')}>
            {/* 子页须挂在目录里的父页下（服务端 placeNew），不在目录的记录不给此项 */}
            {canWrite && entry.treeOrder !== null
              ? item(
                  'new-child',
                  <FilePlus2 className="size-4" />,
                  t('entry.menu.newChild'),
                  run(() => openNew(true, { spaceId: entry.spaceId, parentId: entry.id })),
                )
              : null}
            {canWrite
              ? item(
                  'new-linked',
                  <Link2 className="size-4" />,
                  t('entry.menu.newLinked'),
                  run(() =>
                    openNew(true, {
                      ...entryPageContext(entry),
                      linkFrom: { entryId: entry.id, title: entry.title, kind: 'relates' },
                    }),
                  ),
                )
              : null}
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
              'copy-title',
              <Clipboard className="size-4" />,
              t('cmd.copyTitle'),
              run(() => copyTitle(title)),
              false,
              COPY_TITLE_HOTKEY,
            )}
            {canCopy
              ? item(
                  'duplicate',
                  <CopyPlus className="size-4" />,
                  t('entry.menu.duplicate'),
                  run(() => duplicate(entry)),
                )
              : null}
            {canCopy
              ? item('copy-to', <Copy className="size-4" />, t('entry.menu.copyTo'), () => {
                  setOpen(false)
                  setPlace('copy')
                })
              : null}
            {canWrite
              ? item('move-to', <FolderInput className="size-4" />, t('entry.menu.moveTo'), () => {
                  setOpen(false)
                  setPlace('move')
                })
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
      <EntryDeleteConfirm
        entry={entry}
        open={confirm}
        onOpenChange={setConfirm}
        onDeleted={afterDelete}
      />
      {place ? (
        <EntryPlaceDialog
          entry={entry}
          mode={place}
          open
          onOpenChange={(v) => !v && setPlace(null)}
        />
      ) : null}
    </>
  )
}

/**
 * 删除记录的确认弹层 + 撤销 Toast（REQ-ENTRY-014）：记录 ⋯ 菜单与行菜单（ADR-0035、REQ-KB-013）共用。
 */
export function EntryDeleteConfirm({
  entry,
  open,
  onOpenChange,
  onDeleted,
}: {
  entry: Pick<Entry, 'id' | 'title'>
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted?: () => void
}) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  const title = entry.title || t('entry.untitled')
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
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
  )
}

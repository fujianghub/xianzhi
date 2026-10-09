/**
 * 记录行菜单（ADR-0035 §A、REQ-KB-013）：目录树节点 / 表格行悬停出 ⋯，行上右键同样打开；全部就地完成、不跳页：
 * 改名（Enter / 失焦保存，Esc 放弃）· 新建子页 · 置顶 / 取消 · 归档 / 取消归档 · 删除（确认 + Toast 撤销）；
 * ADR-0054 §C：创建副本 · 复制到… · 移动到…（对话框）。
 * 目录节点只有 id / 标题：打开菜单时才取整条记录（`ifUpdatedAt`、置顶 / 归档态），表格行直接传 `entry`。
 * 写操作按乐观权限显示（调用方按空间角色给 `canWrite`），最终由服务端 `can()` 判定。
 */
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  Copy,
  CopyPlus,
  FilePlus2,
  FolderInput,
  MoreHorizontal,
  Pin,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { type Entry, entryQuery } from '../../lib/entry-queries.ts'
import { ContextAnchor, type Point } from '../ui/context-anchor.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { EntryDeleteConfirm } from './EntryMenu.tsx'
import { EntryPlaceDialog, useQuickDuplicate } from './EntryPlaceDialog.tsx'

export function EntryRowMenu({
  entryId,
  title,
  entry: given,
  canWrite,
  onNewChild,
  onDeleted,
  contextPoint = null,
  onContextClose,
  triggerClassName,
}: {
  entryId: string
  title: string
  /** 已有整条记录（表格行）时直接用，不再请求 */
  entry?: Entry
  canWrite: boolean
  /** 传入 = 显示「新建子页」 */
  onNewChild?: () => void
  onDeleted?: () => void
  contextPoint?: Point | null
  onContextClose?: () => void
  triggerClassName?: string
}) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(title)
  const [confirm, setConfirm] = useState(false)
  const [place, setPlace] = useState<'move' | 'copy' | null>(null)
  const duplicate = useQuickDuplicate()
  const q = useQuery({ ...entryQuery(entryId), enabled: (open || !!place) && !given })
  const entry = given ?? q.data
  useEffect(() => {
    if (contextPoint) setOpen(true)
  }, [contextPoint])
  if (!canWrite) return null

  const shown = title || t('entry.untitled')
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const setMenu = (v: boolean) => {
    setOpen(v)
    if (v) setName(title)
    else onContextClose?.()
  }
  const run = (fn: (e: Entry) => Promise<unknown> | unknown) => () => {
    if (!entry) return
    setMenu(false)
    void Promise.resolve()
      .then(() => fn(entry))
      .catch(() => undefined)
  }
  const rename = () => {
    const v = name.trim()
    if (!entry || !v || v === entry.title) return setName(entry?.title ?? title)
    void actions
      .patch(entry, { title: v })
      .then(() => toast.success(t('entry.menu.renamed', { title: v })))
      .catch(() => setName(entry.title))
  }
  const item = (
    key: string,
    icon: ReactNode,
    label: string,
    onClick: () => void,
    danger?: boolean,
  ) => (
    <button
      key={key}
      type="button"
      disabled={!entry}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover disabled:opacity-50',
        danger && 'text-danger',
      )}
      data-testid={`entry-row-${key}`}
    >
      {icon}
      {label}
    </button>
  )
  const archived = !!entry?.archivedAt
  return (
    <>
      <Popover open={open} onOpenChange={setMenu}>
        <ContextAnchor point={contextPoint} />
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('entry.menu.rowLabel', { title: shown })}
            title={t('entry.menu.label')}
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg',
              triggerClassName,
            )}
            data-testid="entry-row-menu"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5" data-testid="entry-row-menu-panel">
          <Input
            value={name}
            disabled={!entry}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                rename()
              }
              if (e.key === 'Escape') setName(entry?.title ?? title)
            }}
            onBlur={rename}
            maxLength={200}
            aria-label={t('entry.menu.rename')}
            className="h-8"
            data-testid="entry-row-rename"
          />
          <div className="mt-1.5 flex flex-col">
            {onNewChild
              ? item(
                  'new-child',
                  <FilePlus2 className="size-4" />,
                  t('entry.menu.newChild'),
                  () => {
                    setMenu(false)
                    onNewChild()
                  },
                )
              : null}
            {item(
              'pin',
              <Pin className="size-4" />,
              t(entry?.pinned ? 'entry.unpin' : 'entry.pin'),
              run((e) => actions.patch(e, { pinned: !e.pinned })),
            )}
            {item(
              'archive',
              archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />,
              t(archived ? 'entry.menu.unarchive' : 'entry.menu.archive'),
              run((e) =>
                actions
                  .archive(e, !archived)
                  .then(() =>
                    toast.success(
                      archived
                        ? t('entry.menu.unarchivedToast')
                        : t('entry.menu.archivedToast', { title: shown }),
                    ),
                  )
                  .catch(fail),
              ),
            )}
            {item(
              'duplicate',
              <CopyPlus className="size-4" />,
              t('entry.menu.duplicate'),
              run((e) => duplicate(e)),
            )}
            {item('copy-to', <Copy className="size-4" />, t('entry.menu.copyTo'), () => {
              setMenu(false)
              setPlace('copy')
            })}
            {item('move-to', <FolderInput className="size-4" />, t('entry.menu.moveTo'), () => {
              setMenu(false)
              setPlace('move')
            })}
            <div className="mt-1 border-divider border-t pt-1">
              {item(
                'delete',
                <Trash2 className="size-4" />,
                t('entry.menu.delete'),
                () => {
                  setMenu(false)
                  setConfirm(true)
                },
                true,
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <EntryDeleteConfirm
        entry={{ id: entryId, title }}
        open={confirm}
        onOpenChange={setConfirm}
        onDeleted={onDeleted}
      />
      {place && entry ? (
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

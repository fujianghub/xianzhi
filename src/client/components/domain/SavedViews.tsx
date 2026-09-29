/**
 * 保存视图（ADR-0033、REQ-BUG-009）：记录页左栏「我的视图」+ 筛选行「保存视图」。
 * 视图是个人的；点击 = 套用其筛选（带空间的在该空间记录页打开）；⋯ 改名 / 覆盖为当前筛选 / 删除。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bookmark, BookmarkPlus, MoreHorizontal } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type EntryFilterSearch, sanitizeEntryFilter } from '../../../shared/entry-search.ts'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { navRowCls } from './DirTree.tsx'

export interface SavedView {
  id: string
  name: string
  spaceId: string | null
  search: EntryFilterSearch
  updatedAt: string
}

export const entryViewsQuery = {
  queryKey: ['entry-views'] as const,
  queryFn: () => unwrap<{ items: SavedView[] }>(api['entry-views'].$get()).then((r) => r.items),
  staleTime: 60_000,
}

/** 与视图比较时忽略键序（清洗后的对象）。 */
const same = (a: EntryFilterSearch, b: EntryFilterSearch) => {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return (
    ka.length === kb.length &&
    ka.every(
      (k, i) => k === kb[i] && a[k as keyof EntryFilterSearch] === b[k as keyof EntryFilterSearch],
    )
  )
}

function useViewMutations() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const done = () => qc.invalidateQueries({ queryKey: ['entry-views'] })
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const create = useMutation({
    mutationFn: (input: { name: string; spaceId: string | null; search: EntryFilterSearch }) =>
      unwrap<SavedView>(api['entry-views'].$post({ json: input as never })),
    onSuccess: () => {
      void done()
      toast.success(t('entry.views.saved'))
    },
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: ({ id, ...json }: { id: string; name?: string; search?: EntryFilterSearch }) =>
      unwrap<SavedView>(api['entry-views'][':id'].$patch({ param: { id }, json: json as never })),
    onSuccess: () => void done(),
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap<unknown>(api['entry-views'][':id'].$delete({ param: { id } })),
    onSuccess: () => void done(),
    onError: fail,
  })
  return { create, patch, remove }
}

/** 左栏「我的视图」：空间页签内只列本空间的视图。 */
export function SavedViewsNav({
  current,
  spaceId,
}: {
  current: EntryFilterSearch
  /** 空间页签内 */
  spaceId?: string
}) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const views = useQuery(entryViewsQuery)
  const spaces = useQuery(spacesQuery())
  const m = useViewMutations()
  const [renaming, setRenaming] = useState<SavedView | null>(null)
  const [deleting, setDeleting] = useState<SavedView | null>(null)
  const items = (views.data ?? []).filter((v) => !spaceId || v.spaceId === spaceId)
  if (!items.length) return null
  const open = (v: SavedView) => {
    const slug = v.spaceId ? spaces.data?.find((s) => s.id === v.spaceId)?.slug : undefined
    if (v.spaceId && slug)
      void nav({ to: '/spaces/$spaceSlug/entries', params: { spaceSlug: slug }, search: v.search })
    else void nav({ to: '/entries', search: v.search })
  }
  const here = sanitizeEntryFilter(current as Record<string, unknown>)
  return (
    <div className="mb-3 border-divider border-b pb-3" data-testid="saved-views">
      <p className="px-2 pb-1 text-fg-muted text-xs">{t('entry.views.title')}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((v) => {
          const active = same(v.search, spaceId ? { ...here, spaceId: undefined } : here)
          return (
            <li key={v.id} className="group/view flex items-center">
              <button
                type="button"
                className={cn(navRowCls(active), 'h-8 min-w-0 flex-1')}
                aria-current={active ? 'page' : undefined}
                onClick={() => open(v)}
                data-testid="saved-view"
                data-view-name={v.name}
              >
                <Bookmark className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="truncate">{v.name}</span>
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover/view:opacity-100 [@media(hover:none)]:opacity-100"
                    aria-label={t('entry.views.menu', { name: v.name })}
                    data-testid="saved-view-menu"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  <MenuItem onClick={() => setRenaming(v)}>{t('entry.views.rename')}</MenuItem>
                  <MenuItem
                    onClick={() =>
                      m.patch.mutate(
                        { id: v.id, search: here },
                        { onSuccess: () => toast.success(t('entry.views.updated')) },
                      )
                    }
                    disabled={!Object.keys(here).length}
                    testId="saved-view-overwrite"
                  >
                    {t('entry.views.overwrite')}
                  </MenuItem>
                  <MenuItem onClick={() => setDeleting(v)} danger testId="saved-view-delete">
                    {t('entry.views.delete')}
                  </MenuItem>
                </PopoverContent>
              </Popover>
            </li>
          )
        })}
      </ul>
      <NameDialog
        open={!!renaming}
        initial={renaming?.name ?? ''}
        title={t('entry.views.rename')}
        onClose={() => setRenaming(null)}
        onSubmit={(name) =>
          renaming
            ? m.patch.mutateAsync({ id: renaming.id, name }).then(() => undefined)
            : undefined
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('entry.views.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('entry.views.deleteBody')}
        confirmLabel={t('entry.views.delete')}
        onConfirm={() => (deleting ? m.remove.mutateAsync(deleting.id) : undefined)}
      />
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  testId,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-hover disabled:opacity-50',
        danger && 'text-danger',
      )}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

/** 筛选行「保存视图」：当前有筛选时可用。 */
export function SaveViewButton({
  current,
  spaceId,
}: {
  current: EntryFilterSearch
  spaceId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const m = useViewMutations()
  const search = sanitizeEntryFilter(current as Record<string, unknown>)
  const empty = !Object.keys(search).length
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={empty}
        title={empty ? t('entry.views.needFilter') : undefined}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm hover:bg-hover disabled:opacity-50"
        data-testid="save-view"
      >
        <BookmarkPlus className="size-4" />
        {t('entry.views.save')}
      </button>
      <NameDialog
        open={open}
        initial=""
        title={t('entry.views.save')}
        onClose={() => setOpen(false)}
        onSubmit={(name) =>
          m.create.mutateAsync({ name, spaceId: spaceId ?? null, search }).then(() => undefined)
        }
      />
    </>
  )
}

function NameDialog({
  open,
  initial,
  title,
  onClose,
  onSubmit,
}: {
  open: boolean
  initial: string
  title: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void> | undefined
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName(initial)
  }, [open, initial])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (!v) return
    setBusy(true)
    try {
      await onSubmit(v)
      onClose()
    } catch {
      // 错误已由 mutation 提示
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(92vw,24rem)]" data-testid="view-name-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">{t('entry.views.nameHint')}</DialogDescription>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('entry.views.namePlaceholder')}
            aria-label={t('entry.views.name')}
            maxLength={40}
            autoFocus
            data-testid="view-name"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('ui.action.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
              {t('ui.action.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

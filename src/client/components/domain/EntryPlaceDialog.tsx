/**
 * 移动到… / 复制到…（ADR-0054 §C、REQ-ENTRY-038 · 039）：记录 ⋯ 菜单与行菜单共用的位置对话框。
 * 选「空间 › 目录位置」（目录顶层 / 不放进目录 / 某页之下；复制同空间且原记录在目录里时另有「紧跟原记录之后」）。
 * - 移动：同空间只改目录位置（PATCH move）；换空间 = PATCH spaceId（进个人空间改仅自己、离开个人空间改空间可见），
 *   再按所选位置放进目标目录。移动时排除自身与子孙。
 * - 复制：POST duplicate，可改副本标题；完成后 Toast 带「打开」。
 * 空间只列本人可建记录的（个人空间 + 成员 / 管理员角色），已归档的不列。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { openEntryDetail } from '../../lib/entry-dock.ts'
import { type Entry, treeQuery } from '../../lib/entry-queries.ts'
import { canCreateIn, type Space, spacesQuery } from '../../lib/space-queries.ts'
import { childrenMap, flatten } from '../../lib/tree.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'

const ROOT = '__root'
const NONE = '__none'
const AFTER = '__after'

export function EntryPlaceDialog({
  entry,
  mode,
  open,
  onOpenChange,
}: {
  entry: Entry
  mode: 'move' | 'copy'
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const actions = useEntryActions()
  const spaces = useQuery({ ...spacesQuery(), enabled: open })
  const writable = useMemo(
    () => (spaces.data ?? []).filter((s) => !s.archivedAt && canCreateIn(s)),
    [spaces.data],
  )
  const inTree = entry.treeOrder !== null
  const initialWhere =
    mode === 'copy' ? (inTree ? AFTER : NONE) : inTree ? (entry.parentId ?? ROOT) : NONE
  const [spaceId, setSpaceId] = useState(entry.spaceId)
  const [where, setWhere] = useState(initialWhere)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // 每次打开从当前位置开始
  useEffect(() => {
    if (!open) return
    setSpaceId(entry.spaceId)
    setWhere(initialWhere)
    setTitle(t('entry.place.copyNameValue', { title: entry.title || t('entry.untitled') }))
  }, [open, entry.spaceId, entry.title, initialWhere, t])
  const same = spaceId === entry.spaceId
  const tree = useQuery({ ...treeQuery(spaceId), enabled: open && !!spaceId })
  const nodes = tree.data ?? []
  // 移动：自身与子孙不能作父页
  const options = flatten(nodes, new Set(), mode === 'move' && same ? entry.id : undefined).filter(
    (n) => !(mode === 'move' && same && n.id === entry.id),
  )
  const target =
    writable.find((s) => s.id === spaceId) ?? spaces.data?.find((s) => s.id === spaceId)
  const spaceName = (s: Space | undefined) =>
    s ? (s.isPersonal ? t('space.personal') : s.name) : ''

  const fail = (err: unknown) =>
    toast.error(
      err instanceof ApiError
        ? (err.problem?.errors?.[0]?.message ?? err.message)
        : t('task.saveFailed'),
    )

  const submitMove = async () => {
    const parentOf = (w: string) => (w === ROOT ? null : w)
    const lastUnder = (parentId: string | null) =>
      (childrenMap(nodes).get(parentId) ?? []).filter((n) => n.id !== entry.id).at(-1)?.id ?? null
    if (same) {
      if (where === initialWhere) {
        toast(t('entry.place.same'))
        return
      }
      if (where === NONE) await actions.move(entry, { detach: true })
      else
        await actions.move(entry, { parentId: parentOf(where), after: lastUnder(parentOf(where)) })
    } else {
      const fromPersonal = !!spaces.data?.find((s) => s.id === entry.spaceId)?.isPersonal
      await actions.patch(entry, {
        spaceId,
        ...(target?.isPersonal
          ? { visibility: 'private' as const }
          : fromPersonal
            ? { visibility: 'space' as const }
            : {}),
      })
      if (where !== NONE)
        await actions.move(entry, { parentId: parentOf(where), after: lastUnder(parentOf(where)) })
    }
    toast.success(t('entry.place.moved', { space: spaceName(target) }))
  }

  const submitCopy = async () => {
    const name = title.trim()
    const r = await actions.duplicate(entry, {
      ...(same ? {} : { spaceId }),
      ...(where === AFTER
        ? {}
        : where === NONE
          ? { detach: true as const }
          : { parentId: where === ROOT ? null : where }),
      ...(name ? { title: name } : {}),
    })
    toast.success(t('entry.place.copied', { space: spaceName(target) }), {
      action: {
        label: t('entry.menu.openCopy'),
        onClick: () => {
          if (!openEntryDetail(r.id))
            void nav({ to: '/entries/$entryId', params: { entryId: r.id } })
        },
      },
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await (mode === 'move' ? submitMove() : submitCopy())
      onOpenChange(false)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,32rem)]" data-testid="entry-place-dialog">
        <DialogTitle>
          {t(mode === 'move' ? 'entry.place.moveTitle' : 'entry.place.copyTitle')}
        </DialogTitle>
        <DialogDescription className="text-fg-muted text-sm">
          {t(mode === 'move' ? 'entry.place.moveHint' : 'entry.place.copyHint')}
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          {mode === 'copy' ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted text-xs">{t('entry.place.copyName')}</span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                data-testid="entry-place-title"
              />
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-sm">
            <MapPin className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <select
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value)
                // 换空间：默认放到目标目录顶层；回到原空间 = 原位置
                setWhere(e.target.value === entry.spaceId ? initialWhere : ROOT)
              }}
              aria-label={t('entry.location.space')}
              className="h-8 min-w-0 max-w-[45%] rounded-md border border-border bg-surface px-2"
              data-testid="entry-place-space"
            >
              {writable.some((s) => s.id === entry.spaceId) ? null : (
                <option value={entry.spaceId}>{spaceName(target)}</option>
              )}
              {writable.map((s) => (
                <option key={s.id} value={s.id}>
                  {spaceName(s)}
                </option>
              ))}
            </select>
            <span className="text-fg-faint" aria-hidden>
              ›
            </span>
            <select
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              aria-label={t('entry.location.where')}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2"
              data-testid="entry-place-where"
            >
              {mode === 'copy' && same && inTree ? (
                <option value={AFTER}>{t('entry.place.after')}</option>
              ) : null}
              <option value={ROOT}>{t('entry.location.root')}</option>
              <option value={NONE}>{t('entry.location.none')}</option>
              {options.length ? (
                <optgroup label={t('entry.location.under')}>
                  {options.map((n) => (
                    <option key={n.id} value={n.id}>
                      {`${'　'.repeat(n.depth)}${n.title || t('entry.untitled')}`}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('ui.action.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !spaceId} data-testid="entry-place-submit">
              {t(mode === 'move' ? 'entry.place.submitMove' : 'entry.place.submitCopy')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 「创建副本」：同空间、紧跟原记录之后（ADR-0054 §C）；Toast 带「打开」（宽屏开详情坞） */
export function useQuickDuplicate() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const actions = useEntryActions()
  return async (entry: Pick<Entry, 'id' | 'title'>) => {
    const title = t('entry.place.copyNameValue', { title: entry.title || t('entry.untitled') })
    try {
      const r = await actions.duplicate(entry, { title })
      toast.success(t('entry.menu.duplicated', { title }), {
        action: {
          label: t('entry.menu.openCopy'),
          onClick: () => {
            if (!openEntryDetail(r.id))
              void nav({ to: '/entries/$entryId', params: { entryId: r.id } })
          },
        },
      })
      return r
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? (err.problem?.errors?.[0]?.message ?? err.message)
          : t('task.saveFailed'),
      )
      return null
    }
  }
}

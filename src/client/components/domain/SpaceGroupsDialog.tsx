/**
 * 管理大类（ADR-0012、REQ-KB-001）：新建 / 改名 / 改色 / 上移下移 / 删除；仅 owner / admin 看到入口（服务端 can('group.manage')）。
 * 删除大类不删空间，其下空间变「未分类」。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type SpaceGroup, spaceGroupsQuery } from '../../hooks/useSpaces.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { PALETTE, PALETTE_DOT, type PaletteName } from './SpaceIcon.tsx'

export function SpaceGroupsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery({ ...spaceGroupsQuery, enabled: open })
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<SpaceGroup | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['space-groups'] })
    void qc.invalidateQueries({ queryKey: ['spaces'] })
  }
  const onError = () => toast.error(t('task.saveFailed'))
  const add = useMutation({
    mutationFn: (n: string) => unwrap<SpaceGroup>(api['space-groups'].$post({ json: { name: n } })),
    onSuccess: () => {
      setName('')
      refresh()
    },
    onError,
  })
  const patch = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: PaletteName | null }) =>
      unwrap<SpaceGroup>(
        api['space-groups'][':id'].$patch({
          param: { id: v.id },
          json: {
            ...(v.name ? { name: v.name } : {}),
            ...(v.color !== undefined ? { color: v.color } : {}),
          },
        }),
      ),
    onSuccess: refresh,
    onError,
  })
  const move = useMutation({
    mutationFn: (v: { id: string; after: string | null }) =>
      unwrap<SpaceGroup>(api['space-groups'].reorder.$patch({ json: v })),
    onSuccess: refresh,
    onError,
  })
  const items = q.data ?? []
  const moveBy = (i: number, dir: -1 | 1) => {
    const g = items[i]
    const j = i + dir
    if (!g || j < 0 || j >= items.length) return
    // 上移：放到 j-1 之后；下移：放到 j 之后
    const after = dir === -1 ? (items[j - 1]?.id ?? null) : (items[j]?.id ?? null)
    move.mutate({ id: g.id, after })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) add.mutate(name.trim())
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,32rem)]" data-testid="space-groups-dialog">
        <DialogTitle>{t('space.groups.manage')}</DialogTitle>
        <DialogDescription className="mt-1 text-fg-muted text-sm">
          {t('space.groups.manageHint')}
        </DialogDescription>
        <ul className="mt-4 flex flex-col gap-1.5">
          {items.map((g, i) => (
            <li
              key={g.id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
              data-testid="space-group-row"
              data-group-id={g.id}
            >
              <select
                aria-label={t('space.color')}
                value={g.color ?? ''}
                onChange={(e) =>
                  patch.mutate({ id: g.id, color: (e.target.value || null) as PaletteName | null })
                }
                className="h-8 w-20 rounded-md border border-border bg-surface px-1 text-xs"
              >
                <option value="">—</option>
                {PALETTE.map((c) => (
                  <option key={c} value={c}>
                    {t(`ui.palette.${c}`)}
                  </option>
                ))}
              </select>
              <span
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  PALETTE_DOT[(g.color as PaletteName) ?? 'gray'],
                )}
                aria-hidden
              />
              <Input
                defaultValue={g.name}
                aria-label={t('space.groups.rename')}
                maxLength={40}
                className="h-8 flex-1"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== g.name) patch.mutate({ id: g.id, name: v })
                }}
                data-testid="space-group-name"
              />
              <Button
                variant="icon"
                aria-label={t('space.groups.moveUp')}
                disabled={i === 0}
                onClick={() => moveBy(i, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="icon"
                aria-label={t('space.groups.moveDown')}
                disabled={i === items.length - 1}
                onClick={() => moveBy(i, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="icon"
                aria-label={t('space.groups.delete')}
                onClick={() => setConfirm(g)}
                data-testid="space-group-delete"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('space.groups.name')}
            aria-label={t('space.groups.name')}
            maxLength={40}
            data-testid="space-group-new-name"
          />
          <Button type="submit" variant="primary" disabled={!name.trim()} loading={add.isPending}>
            {t('space.groups.add')}
          </Button>
        </form>
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={(v) => !v && setConfirm(null)}
          title={t('space.groups.delete')}
          description={t('space.groups.deleteConfirm', { name: confirm?.name ?? '' })}
          confirmLabel={t('space.groups.delete')}
          onConfirm={async () => {
            if (!confirm) return
            await unwrap(api['space-groups'][':id'].$delete({ param: { id: confirm.id } }))
            refresh()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

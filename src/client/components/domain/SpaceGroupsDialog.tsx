/**
 * 管理大类（ADR-0012 · 0018、REQ-KB-001 · 008）：新建 / 改名（Enter 或失焦保存）/ 改色（色块）/ 上移下移 / 删除；
 * 仅 owner / admin 看到入口（空间列表页、侧栏「空间」标题旁；服务端 can('group.manage')）。
 * 删除大类不删空间，其下空间变「未分类」。
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type SpaceGroup, spaceGroupsQuery, useSpaceGroupActions } from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import type { PaletteName } from './SpaceIcon.tsx'

export function SpaceGroupsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const q = useQuery({ ...spaceGroupsQuery, enabled: open })
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<SpaceGroup | null>(null)
  const actions = useSpaceGroupActions()
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const items = q.data ?? []
  const moveBy = (i: number, dir: -1 | 1) => {
    const g = items[i]
    const j = i + dir
    if (!g || j < 0 || j >= items.length) return
    // 上移：放到 j-1 之后；下移：放到 j 之后
    const after = dir === -1 ? (items[j - 1]?.id ?? null) : (items[j]?.id ?? null)
    actions.move.mutate({ id: g.id, after }, { onError })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim())
      actions.create.mutate({ name: name.trim() }, { onSuccess: () => setName(''), onError })
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
              <ColorPicker
                value={(g.color as PaletteName | null) ?? 'gray'}
                onChange={(c) => actions.patch.mutate({ id: g.id, color: c }, { onError })}
                label={t('space.color')}
                testId="space-group-color"
              />
              <Input
                defaultValue={g.name}
                aria-label={t('space.groups.rename')}
                maxLength={40}
                className="h-8 flex-1"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== g.name) actions.patch.mutate({ id: g.id, name: v }, { onError })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur() // 回车即保存（失焦触发）
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
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim()}
            loading={actions.create.isPending}
          >
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
            await actions.remove.mutateAsync(confirm.id).catch(onError)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

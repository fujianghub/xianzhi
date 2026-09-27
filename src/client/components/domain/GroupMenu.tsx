/**
 * 侧栏大类分区的 ⋯ 菜单（ADR-0018、REQ-KB-008）：改名（Enter 保存 / Esc 取消）· 改色（色块）· 在此新建空间 · 删除。
 * 只对 owner / admin 显示（服务端 `can('group.manage')` 为准）；删除大类不删空间，其下空间变「未分类」。
 */
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type SpaceGroup, useSpaceGroupActions } from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { useCreateSpaceDialog } from '../../lib/stores.ts'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE, PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'

export function GroupMenu({ group }: { group: SpaceGroup }) {
  const { t } = useTranslation()
  const actions = useSpaceGroupActions()
  const openCreate = useCreateSpaceDialog((s) => s.setOpen)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(group.name)
  const [del, setDel] = useState(false)
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const rename = () => {
    const v = name.trim()
    if (!v || v === group.name) return setName(group.name)
    actions.patch.mutate(
      { id: group.id, name: v },
      {
        onSuccess: () => toast.success(t('space.groups.renamed', { name: v })),
        onError: (e) => {
          setName(group.name)
          fail(e)
        },
      },
    )
  }
  const item = 'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover'
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (v) setName(group.name)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('space.groups.menu', { name: group.name })}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100 max-lg:opacity-100"
            data-testid="group-menu"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-2" data-testid="group-menu-panel">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                rename()
              }
              if (e.key === 'Escape') setName(group.name)
            }}
            onBlur={rename}
            maxLength={40}
            aria-label={t('space.groups.rename')}
            className="h-8"
            data-testid="group-menu-name"
          />
          <fieldset className="mt-2 grid grid-cols-5 gap-1">
            <legend className="sr-only">{t('space.color')}</legend>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t(`ui.palette.${c}`)}
                aria-pressed={group.color === c}
                onClick={() => actions.patch.mutate({ id: group.id, color: c }, { onError: fail })}
                className={cn(
                  'grid h-8 place-items-center rounded-md hover:bg-hover',
                  group.color === c && 'ring-2 ring-selected-border',
                )}
                data-color={c}
              >
                <span className={cn('size-4 rounded-full', PALETTE_CLASS[c as PaletteName])} />
              </button>
            ))}
          </fieldset>
          <div className="mt-2 border-divider border-t pt-1">
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false)
                openCreate(true, group.id)
              }}
              data-testid="group-menu-new-space"
            >
              <Plus className="size-4" />
              {t('space.groups.addHere')}
            </button>
            <button
              type="button"
              className={cn(item, 'text-danger')}
              onClick={() => {
                setOpen(false)
                setDel(true)
              }}
              data-testid="group-menu-delete"
            >
              <Trash2 className="size-4" />
              {t('space.groups.delete')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('space.groups.delete')}
        description={t('space.groups.deleteConfirm', { name: group.name })}
        confirmLabel={t('space.groups.delete')}
        onConfirm={() => actions.remove.mutateAsync(group.id).catch(fail)}
      />
    </>
  )
}

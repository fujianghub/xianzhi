/**
 * 空间页头（ADR-0012）：图标、名称、大类 · 类型 · 可见性、简介、编辑入口与页签；空间内各页共用。
 * 就地管理（ADR-0035、REQ-KB-011）：空间管理员点标题即改名（Enter / 失焦保存，Esc 放弃），点图标换图标与颜色，⋯ = 空间菜单。
 */
import { useQuery } from '@tanstack/react-query'
import { Archive, Settings2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type Space, spaceGroupsQuery, usePatchSpace } from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { KbEditDialog } from './KbEditDialog.tsx'
import { type KbTab, KbTabs } from './KbTabs.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'
import { SpaceIconPicker } from './SpaceIconPicker.tsx'
import { SpaceMenu, useSpacePerms } from './SpaceMenu.tsx'

export function KbHeader({
  space,
  active,
  actions,
}: {
  space: Space
  active: KbTab
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const [edit, setEdit] = useState(false)
  const groups = useQuery(spaceGroupsQuery)
  const group = groups.data?.find((g) => g.id === space.groupId)
  const name = space.isPersonal ? t('space.personal') : space.name
  const { canManage } = useSpacePerms(space)
  const patch = usePatchSpace()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(space.name)
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const commit = () => {
    setRenaming(false)
    const v = draft.trim()
    if (!v || v === space.name) return
    patch.mutate(
      { space, change: { name: v } },
      { onSuccess: () => toast.success(t('space.menu.renamed', { name: v })), onError: fail },
    )
  }
  const icon = (
    <SpaceIcon
      icon={space.icon}
      kind={space.kind}
      color={space.color}
      isPersonal={space.isPersonal}
      className="size-9 text-base"
    />
  )
  return (
    <>
      {space.archivedAt ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg bg-warning-soft px-4 py-2 text-sm text-warning"
          role="status"
          data-testid="space-archived-banner"
        >
          <Archive className="size-4" />
          {t('space.archivedBanner')}
        </div>
      ) : null}
      <header className="flex flex-wrap items-center gap-3" data-testid="kb-header">
        {canManage ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-lg transition-transform hover:scale-105"
                aria-label={t('space.menu.iconTitle')}
                title={t('space.menu.iconTitle')}
                data-testid="kb-icon-edit"
              >
                {icon}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <SpaceIconPicker
                kind={space.kind}
                color={space.color}
                icon={space.icon}
                onColor={(color) => patch.mutate({ space, change: { color } }, { onError: fail })}
                onIcon={(i) => patch.mutate({ space, change: { icon: i } }, { onError: fail })}
              />
            </PopoverContent>
          </Popover>
        ) : (
          icon
        )}
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={draft}
              maxLength={60}
              aria-label={t('space.menu.rename')}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setDraft(space.name)
                  setRenaming(false)
                }
              }}
              className="h-8 max-w-md font-semibold text-xl"
              data-testid="kb-title-input"
            />
          ) : (
            <h1 className="truncate font-semibold text-xl">
              {canManage ? (
                <button
                  type="button"
                  className="-mx-1 max-w-full truncate rounded-md px-1 text-left hover:bg-hover"
                  title={t('space.menu.renameTitle')}
                  onClick={() => {
                    setDraft(space.name)
                    setRenaming(true)
                  }}
                  data-testid="kb-title-edit"
                >
                  {name}
                </button>
              ) : (
                name
              )}
            </h1>
          )}
          <p className="text-fg-muted text-xs" data-testid="kb-meta">
            {group ? `${group.name} · ` : ''}
            {t(`space.kind.${space.kind}`)} · {t(`space.visibility.${space.visibility}`)} ·{' '}
            {t('space.members', { count: space.memberCount })}
          </p>
        </div>
        {space.myRole === 'admin' ? (
          <Button
            variant="icon"
            aria-label={t('kb.edit')}
            title={t('kb.edit')}
            onClick={() => setEdit(true)}
            data-testid="kb-edit"
          >
            <Settings2 className="size-4" />
          </Button>
        ) : null}
        {canManage ? <SpaceMenu space={space} triggerClassName="size-8" /> : null}
        <KbTabs slug={space.slug} active={active} />
        {actions}
      </header>
      {space.description ? (
        <p className="mt-2 max-w-3xl text-fg-muted text-sm" data-testid="kb-description">
          {space.description}
        </p>
      ) : null}
      <KbEditDialog space={space} open={edit} onOpenChange={setEdit} />
    </>
  )
}

/** 空间页头（ADR-0012）：图标、名称、大类 · 类型 · 可见性、简介、编辑入口与页签；空间内各页共用。 */
import { useQuery } from '@tanstack/react-query'
import { Archive, Settings2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Space, spaceGroupsQuery } from '../../hooks/useSpaces.ts'
import { Button } from '../ui/button.tsx'
import { KbEditDialog } from './KbEditDialog.tsx'
import { type KbTab, KbTabs } from './KbTabs.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'

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
        <SpaceIcon
          icon={space.icon}
          kind={space.kind}
          color={space.color}
          isPersonal={space.isPersonal}
          className="size-9 text-base"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-xl">{name}</h1>
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

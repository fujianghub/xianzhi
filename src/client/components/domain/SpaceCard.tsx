/** 空间卡片（08 §2.5）：纸面卡；空间管理员可归档 / 取消归档（REQ-SPACE-004）。 */
import { Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Lock, MoreHorizontal, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type Space, useArchiveSpace } from '../../hooks/useSpaces.ts'
import { Button } from '../ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'

export function SpaceCard({ space }: { space: Space }) {
  const { t } = useTranslation()
  const archive = useArchiveSpace()
  const name = space.isPersonal ? t('space.personal') : space.name
  const canManage = space.myRole === 'admin' && !space.isPersonal
  const toggleArchive = () =>
    archive.mutate(
      { id: space.id, archived: !space.archivedAt },
      {
        onSuccess: () =>
          toast.success(
            t(space.archivedAt ? 'space.unarchivedToast' : 'space.archivedToast', { name }),
          ),
      },
    )
  return (
    <li
      className="paper relative flex flex-col gap-3 rounded-lg p-4"
      data-testid="space-card"
      data-space-id={space.id}
    >
      <div className="flex items-start gap-3">
        <SpaceIcon
          icon={space.icon}
          kind={space.kind}
          color={space.color}
          isPersonal={space.isPersonal}
          className="size-9 text-base"
        />
        <div className="min-w-0 flex-1">
          <Link
            to="/spaces/$spaceSlug"
            params={{ spaceSlug: space.slug }}
            className="block truncate font-medium after:absolute after:inset-0 after:rounded-lg"
          >
            {name}
          </Link>
          <p className="mt-0.5 text-fg-muted text-xs">
            {t(`space.kind.${space.kind}`)} · <span className="font-mono">{space.slug}</span>
          </p>
        </div>
        {canManage ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="icon"
                className="relative z-1 -mt-1 -mr-1"
                aria-label={t('space.actions')}
                data-testid="space-actions"
              >
                <MoreHorizontal />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-hover"
                onClick={toggleArchive}
                data-testid="space-archive-toggle"
              >
                {space.archivedAt ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
                {space.archivedAt ? t('space.unarchive') : t('space.archive')}
              </button>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-fg-muted text-xs">
        <span className="inline-flex items-center gap-1">
          {space.visibility === 'members' ? (
            <Lock className="size-3.5" />
          ) : (
            <Users className="size-3.5" />
          )}
          {t(`space.visibility.${space.visibility}`)}
        </span>
        <span>{t('space.members', { count: space.memberCount })}</span>
        {space.myRole ? <span className="ml-auto">{t(`space.role.${space.myRole}`)}</span> : null}
      </div>
    </li>
  )
}

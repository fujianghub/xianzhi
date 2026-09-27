/** 空间卡片（08 §2.5）：纸面卡；空间管理员可归档 / 取消归档（REQ-SPACE-004），可移到大类（ADR-0018、REQ-KB-008）。 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Check, Lock, MoreHorizontal, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  type Space,
  spaceGroupsQuery,
  useArchiveSpace,
  useMoveSpaceToGroup,
} from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { Button } from '../ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'

export function SpaceCard({ space, index = 0 }: { space: Space; index?: number }) {
  const { t } = useTranslation()
  const archive = useArchiveSpace()
  const moveTo = useMoveSpaceToGroup()
  const name = space.isPersonal ? t('space.personal') : space.name
  const canManage = space.myRole === 'admin' && !space.isPersonal
  const groups = useQuery({ ...spaceGroupsQuery, enabled: canManage })
  const setGroup = (groupId: string | null) =>
    moveTo.mutate(
      { space, groupId },
      {
        onSuccess: () =>
          toast.success(
            t('space.movedToGroup', {
              name,
              group: groups.data?.find((g) => g.id === groupId)?.name ?? t('space.ungrouped'),
            }),
          ),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t('task.saveFailed')),
      },
    )
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
      style={{ '--i': index } as React.CSSProperties}
      className="paper xz-lift xz-rise group relative flex flex-col gap-3 rounded-lg p-4"
      data-testid="space-card"
      data-space-id={space.id}
    >
      <div className="flex items-start gap-3">
        <SpaceIcon
          icon={space.icon}
          kind={space.kind}
          color={space.color}
          isPersonal={space.isPersonal}
          className="size-9 text-base transition-transform duration-(--xz-dur-base) ease-(--xz-ease-spring) group-hover:scale-105"
        />
        <div className="min-w-0 flex-1">
          <Link
            to="/spaces/$spaceSlug/home"
            params={{ spaceSlug: space.slug }}
            className="block truncate font-medium transition-colors duration-(--xz-dur-fast) after:absolute after:inset-0 after:rounded-lg group-hover:text-primary-text"
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
            <PopoverContent align="end" className="w-52 p-1">
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
              <p className="mt-1 border-divider border-t px-2 pt-2 pb-1 text-fg-muted text-xs">
                {t('space.moveToGroup')}
              </p>
              {[...(groups.data ?? []), null].map((g) => {
                const on = (space.groupId ?? null) === (g?.id ?? null)
                return (
                  <button
                    key={g?.id ?? 'none'}
                    type="button"
                    disabled={on}
                    aria-current={on || undefined}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-hover disabled:text-fg-muted"
                    onClick={() => setGroup(g?.id ?? null)}
                    data-testid="space-move-group"
                    data-group-id={g?.id ?? 'none'}
                  >
                    <span className="truncate">{g?.name ?? t('space.ungrouped')}</span>
                    {on ? <Check className="ms-auto size-4" /> : null}
                  </button>
                )
              })}
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
        {space.myRole ? (
          <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5">
            {t(`space.role.${space.myRole}`)}
          </span>
        ) : null}
      </div>
    </li>
  )
}

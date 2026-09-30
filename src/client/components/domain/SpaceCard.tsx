/**
 * 空间卡片（08 §2.5）：纸面卡；⋯ = 共用的空间菜单（ADR-0035、REQ-KB-011：改名 / 图标与颜色 / 归档 / 移到大类 / 合并 / 删除，
 * 见 SpaceMenu），卡片上右键同样打开。
 * 批量管理模式（ADR-0021、REQ-SPACE-010）：传 `selection` 时整卡是一个勾选按钮（不跳转、不显示 ⋯）；不可选的卡片变淡。
 */
import { Link } from '@tanstack/react-router'
import { Lock, MoreHorizontal, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Space } from '../../hooks/useSpaces.ts'
import { cn } from '../../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { useContextPoint } from '../ui/context-anchor.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'
import { SpaceMenu, useSpacePerms } from './SpaceMenu.tsx'

export interface SpaceSelection {
  selected: boolean
  /** 个人空间、非本人管理的空间不可选 */
  selectable: boolean
  /** 带上事件，便于 Shift 连选 */
  onToggle: (e: React.MouseEvent) => void
}

export function SpaceCard({
  space,
  index = 0,
  selection,
}: {
  space: Space
  index?: number
  selection?: SpaceSelection
}) {
  const { t } = useTranslation()
  const name = space.isPersonal ? t('space.personal') : space.name
  const { canManage } = useSpacePerms(space)
  const selecting = !!selection
  const ctx = useContextPoint()
  return (
    <li
      style={{ '--i': index } as React.CSSProperties}
      className={cn(
        'paper xz-lift xz-rise group relative flex flex-col gap-3 rounded-lg p-4',
        // paper 自带 background 与 box-shadow，选中态用 outline 表达（不与之冲突）
        selection?.selected && 'outline-2 outline-primary -outline-offset-1',
        selecting && !selection?.selectable && 'opacity-55',
      )}
      data-testid="space-card"
      data-space-id={space.id}
      data-selected={selection?.selected || undefined}
      onContextMenu={canManage && !selecting ? ctx.open : undefined}
    >
      {selection?.selectable ? (
        <button
          type="button"
          aria-pressed={selection.selected}
          aria-label={t('space.batch.select', { name })}
          className="absolute inset-0 z-2 rounded-lg"
          onClick={selection.onToggle}
          data-testid="space-select"
        />
      ) : null}
      <div className="flex items-start gap-3">
        {selecting ? (
          <Checkbox
            checked={!!selection?.selected}
            disabled={!selection?.selectable}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none mt-2"
          />
        ) : null}
        <SpaceIcon
          icon={space.icon}
          kind={space.kind}
          color={space.color}
          isPersonal={space.isPersonal}
          className="size-9 text-base transition-transform duration-(--xz-dur-base) ease-(--xz-ease-spring) group-hover:scale-105"
        />
        <div className="min-w-0 flex-1">
          {selecting ? (
            <p className="truncate font-medium">{name}</p>
          ) : (
            <Link
              to="/spaces/$spaceSlug/home"
              params={{ spaceSlug: space.slug }}
              className="block truncate font-medium transition-colors duration-(--xz-dur-fast) after:absolute after:inset-0 after:rounded-lg group-hover:text-primary-text"
            >
              {name}
            </Link>
          )}
          <p className="mt-0.5 text-fg-muted text-xs">
            {t(`space.kind.${space.kind}`)} · <span className="font-mono">{space.slug}</span>
          </p>
        </div>
        {canManage && !selecting ? (
          <SpaceMenu
            space={space}
            contextPoint={ctx.point}
            onContextClose={ctx.clear}
            trigger={
              <Button
                variant="icon"
                className="relative z-1 -mt-1 -mr-1"
                aria-label={t('space.actions')}
                data-testid="space-actions"
              >
                <MoreHorizontal />
              </Button>
            }
          />
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

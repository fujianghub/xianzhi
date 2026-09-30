/**
 * 空间 ⋯ 菜单（ADR-0035 §A、REQ-KB-011）：侧栏空间行（悬停 ⋯ / 右键）、空间页头、/spaces 卡片共用，全部就地完成、不跳页：
 * 改名（Enter / 失焦保存，Esc 放弃）· 图标与颜色 · 编辑空间… · 合并到… · 归档 / 取消归档 · 移到大类 · 删除（计数确认 + Toast 撤销）。
 * 入口按乐观权限显示（空间管理员 = 可管；删除 / 合并另需工作区 owner / admin），最终由服务端 `can()` 判定；个人空间不出菜单。
 * 在该空间页面内删除 → 回到 /spaces；归档留在原页（页头显示归档横幅）。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Check,
  Merge,
  MoreHorizontal,
  Palette,
  Settings2,
  Shapes,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isAdmin, useMe } from '../../hooks/useMe.ts'
import {
  type Space,
  type SpaceBatchResult,
  spaceGroupsQuery,
  useArchiveSpace,
  useMoveSpaceToGroup,
  usePatchSpace,
  useSpaceBatch,
} from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { ContextAnchor, type Point } from '../ui/context-anchor.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { KbEditDialog } from './KbEditDialog.tsx'
import { MergeSpaceDialog } from './MergeSpaceDialog.tsx'
import { SpaceIconPicker } from './SpaceIconPicker.tsx'
import { SpaceTypesDialog } from './SpaceTypesDialog.tsx'

const RETENTION_DAYS = 30

/** 乐观权限：本人是空间管理员、非个人空间；删除 / 合并另需工作区 owner / admin（ADR-0021 · 0022） */
export function useSpacePerms(space: Space) {
  const { data: me } = useMe()
  const canManage = space.myRole === 'admin' && !space.isPersonal
  return { canManage, canDelete: canManage && isAdmin(me) }
}

export function SpaceMenu({
  space,
  contextPoint = null,
  onContextClose,
  triggerTestId = 'space-menu',
  triggerClassName,
  trigger,
}: {
  space: Space
  /** 右键打开：锚到指针位置 */
  contextPoint?: Point | null
  onContextClose?: () => void
  triggerTestId?: string
  triggerClassName?: string
  /** 自定义触发按钮（默认 ⋯ 图标按钮） */
  trigger?: ReactNode
}) {
  const { t } = useTranslation()
  const { canManage, canDelete } = useSpacePerms(space)
  const nav = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const patch = usePatchSpace()
  const archive = useArchiveSpace()
  const moveTo = useMoveSpaceToGroup()
  const batch = useSpaceBatch()
  const groups = useQuery({ ...spaceGroupsQuery, enabled: canManage })
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(space.name)
  const [iconOpen, setIconOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [typing, setTyping] = useState(false)
  const [merging, setMerging] = useState(false)
  const [preview, setPreview] = useState<SpaceBatchResult | null>(null)
  useEffect(() => {
    if (contextPoint) setOpen(true)
  }, [contextPoint])
  if (!canManage) return null

  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const setMenu = (v: boolean) => {
    setOpen(v)
    if (v) {
      setName(space.name)
      setIconOpen(false)
    } else onContextClose?.()
  }
  const close = () => setMenu(false)
  const rename = () => {
    const v = name.trim()
    if (!v || v === space.name) return setName(space.name)
    patch.mutate(
      { space, change: { name: v } },
      {
        onSuccess: () => toast.success(t('space.menu.renamed', { name: v })),
        onError: (e) => {
          setName(space.name)
          fail(e)
        },
      },
    )
  }
  const toggleArchive = () => {
    close()
    archive.mutate(
      { id: space.id, archived: !space.archivedAt },
      {
        onSuccess: () =>
          toast.success(
            t(space.archivedAt ? 'space.unarchivedToast' : 'space.archivedToast', {
              name: space.name,
            }),
          ),
        onError: fail,
      },
    )
  }
  const setGroup = (groupId: string | null) =>
    moveTo.mutate(
      { space, groupId },
      {
        onSuccess: () =>
          toast.success(
            t('space.movedToGroup', {
              name: space.name,
              group: groups.data?.find((g) => g.id === groupId)?.name ?? t('space.ungrouped'),
            }),
          ),
        onError: fail,
      },
    )
  const askDelete = async () => {
    close()
    try {
      const r = await batch({ op: 'delete', ids: [space.id], dryRun: true })
      if (!r.ok.length) toast.error(r.failed[0]?.message ?? t('task.saveFailed'))
      else setPreview(r)
    } catch (err) {
      fail(err)
    }
  }
  const doDelete = async () => {
    try {
      const r = await batch({ op: 'delete', ids: [space.id] })
      if (!r.ok.length) return void toast.error(r.failed[0]?.message ?? t('task.saveFailed'))
      // 正在这个空间里：它已进回收站，回到空间列表
      if (path.startsWith(`/spaces/${space.slug}/`) || path === `/spaces/${space.slug}`)
        void nav({ to: '/spaces', search: {} })
      toast.success(t('space.menu.deleted', { name: space.name }), {
        action: {
          label: t('space.batch.undo'),
          onClick: () =>
            void batch({ op: 'restore', ids: [space.id] })
              .then(() => toast.success(t('space.batch.undone')))
              .catch(fail),
        },
      })
    } catch (err) {
      fail(err)
    }
  }
  const item = 'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover'
  return (
    <>
      <Popover open={open} onOpenChange={setMenu}>
        <ContextAnchor point={contextPoint} />
        <PopoverTrigger asChild>
          {trigger ?? (
            <button
              type="button"
              aria-label={t('space.menu.label', { name: space.name })}
              title={t('space.actions')}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg',
                triggerClassName,
              )}
              data-testid={triggerTestId}
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1.5" data-testid="space-menu-panel">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                rename()
              }
              if (e.key === 'Escape') setName(space.name)
            }}
            onBlur={rename}
            maxLength={60}
            aria-label={t('space.menu.rename')}
            className="h-8"
            data-testid="space-menu-rename"
          />
          <div className="mt-1.5 flex flex-col">
            <button
              type="button"
              className={item}
              aria-expanded={iconOpen}
              onClick={() => setIconOpen((v) => !v)}
              data-testid="space-menu-icon"
            >
              <Palette className="size-4" />
              {t('space.menu.iconColor')}
            </button>
            {iconOpen ? (
              <div className="px-2 pt-1 pb-2">
                <SpaceIconPicker
                  compact
                  kind={space.kind}
                  color={space.color}
                  icon={space.icon}
                  onColor={(color) => patch.mutate({ space, change: { color } }, { onError: fail })}
                  onIcon={(icon) => patch.mutate({ space, change: { icon } }, { onError: fail })}
                />
              </div>
            ) : null}
            <button
              type="button"
              className={item}
              onClick={() => {
                close()
                setTyping(true)
              }}
              data-testid="space-menu-types"
            >
              <Shapes className="size-4" />
              {t('spaceTypes.menu')}
            </button>
            <button
              type="button"
              className={item}
              onClick={() => {
                close()
                setEditing(true)
              }}
              data-testid="space-menu-edit"
            >
              <Settings2 className="size-4" />
              {t('space.menu.edit')}
            </button>
            {canDelete ? (
              <button
                type="button"
                className={item}
                onClick={() => {
                  close()
                  setMerging(true)
                }}
                data-testid="space-merge"
              >
                <Merge className="size-4" />
                {t('space.merge.menu')}
              </button>
            ) : null}
            <button
              type="button"
              className={item}
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
          </div>
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
                className={cn(item, 'disabled:text-fg-muted')}
                onClick={() => setGroup(g?.id ?? null)}
                data-testid="space-move-group"
                data-group-id={g?.id ?? 'none'}
              >
                <span className="truncate">{g?.name ?? t('space.ungrouped')}</span>
                {on ? <Check className="ms-auto size-4" /> : null}
              </button>
            )
          })}
          {canDelete ? (
            <div className="mt-1 border-divider border-t pt-1">
              <button
                type="button"
                className={cn(item, 'text-danger')}
                onClick={() => void askDelete()}
                data-testid="space-menu-delete"
              >
                <Trash2 className="size-4" />
                {t('space.menu.delete')}
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {editing ? <KbEditDialog space={space} open={editing} onOpenChange={setEditing} /> : null}
      {typing ? (
        <SpaceTypesDialog space={space} open={typing} onOpenChange={setTyping} canManage />
      ) : null}
      {canDelete && merging ? (
        <MergeSpaceDialog space={space} open={merging} onOpenChange={setMerging} />
      ) : null}
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(v) => !v && setPreview(null)}
        title={t('space.menu.deleteTitle', { name: space.name })}
        description={t('space.menu.deleteBody', {
          entries: preview?.counts.entries ?? 0,
          tasks: preview?.counts.tasks ?? 0,
          days: RETENTION_DAYS,
        })}
        confirmLabel={t('space.batch.delete')}
        onConfirm={doDelete}
      />
    </>
  )
}

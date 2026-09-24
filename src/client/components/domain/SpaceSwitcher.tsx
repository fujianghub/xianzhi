/**
 * 侧栏空间树（06 §5 SpaceSwitcher、08 §2.5、REQ-SPACE-005 · REQ-UI-020）：
 * - 「我的空间」（显式成员）可拖动排序：只拖手柄（行本身是链接）；指针 6px 起拖，键盘空格拿起 / 方向键移动。
 *   每次放下只发一条 `PATCH /spaces/reorder`，且只对自己能管理（myRole=admin）的空间开放拖动。
 * - 「其他可见空间」只读列出；「已归档」折叠，展开时才请求。
 * - 当前项：selected-bg 胶囊 + 左侧 3px 主色条（与视图导航同款）。
 */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link, useRouterState } from '@tanstack/react-router'
import { GripVertical, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Me } from '../../hooks/useMe.ts'
import { moveAfter, type Space, useReorderSpace, useSpaces } from '../../hooks/useSpaces.ts'
import { cn } from '../../lib/cn.ts'
import { useCreateSpaceDialog } from '../../lib/stores.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'

function SpaceRow({
  space,
  active,
  sortable,
  onNavigate,
}: {
  space: Space
  active: boolean
  sortable: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: space.id, disabled: !sortable })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group relative', isDragging && 'z-10 opacity-80')}
      data-testid="space-row"
      data-space-id={space.id}
    >
      <Link
        to="/spaces/$spaceSlug"
        params={{ spaceSlug: space.slug }}
        onClick={onNavigate}
        // 与主导航同一套样式（app.css .xz-nav-item；当前项 data-active = 翡翠胶囊，REQ-UI-020 · 032）
        className={cn('xz-nav-item', sortable && 'pr-8')}
        data-active={active || undefined}
        aria-current={active ? 'page' : undefined}
      >
        <span className="xz-nav-icon" aria-hidden>
          <SpaceIcon
            icon={space.icon}
            kind={space.kind}
            color={space.color}
            isPersonal={space.isPersonal}
            className="size-5"
          />
        </span>
        <span className="truncate">{space.isPersonal ? t('space.personal') : space.name}</span>
      </Link>
      {sortable ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t('space.dragHandle', {
            name: space.isPersonal ? t('space.personal') : space.name,
          })}
          className="absolute top-1.5 right-1.5 inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          data-testid="space-drag-handle"
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
    </li>
  )
}

export function SpaceSwitcher({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { data, isPending, isError, refetch } = useSpaces()
  const [showArchived, setShowArchived] = useState(false)
  const archived = useSpaces(true, showArchived)
  const reorder = useReorderSpace()
  const openCreate = useCreateSpaceDialog((s) => s.setOpen)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const mine = useMemo(() => (data ?? []).filter((s) => s.isMember), [data])
  const others = useMemo(() => (data ?? []).filter((s) => !s.isMember), [data])
  const ids = useMemo(() => mine.map((s) => s.id), [mine])
  const nameOf = (id: unknown) => {
    const s = mine.find((x) => x.id === id)
    return s ? (s.isPersonal ? t('space.personal') : s.name) : ''
  }
  const activeSlug = /^\/spaces\/([^/]+)/.exec(path)?.[1]

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return
    const m = moveAfter(ids, String(e.active.id), String(e.over.id))
    if (!m) return
    reorder.mutate(
      { id: String(e.active.id), after: m.after, order: m.order },
      { onError: () => toast.error(t('space.reorderFailed')) },
    )
  }

  return (
    <section
      className="mt-2 flex min-h-0 flex-col px-3"
      aria-labelledby="xz-spaces-heading"
      data-testid="space-switcher"
    >
      <div className="xz-nav-label flex items-center justify-between pr-1">
        <Link id="xz-spaces-heading" to="/spaces" onClick={onNavigate} className="hover:text-fg">
          {t('space.parts')}
        </Link>
        {me.workspaceRole !== 'guest' ? (
          <button
            type="button"
            onClick={() => openCreate(true)}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            aria-label={t('space.newSpace')}
            data-testid="new-space"
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>
      {isPending ? (
        <div className="flex flex-col gap-1.5 px-1 py-1" aria-busy="true">
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
      ) : isError ? (
        <button
          type="button"
          className="px-3 py-2 text-left text-danger text-xs"
          onClick={() => refetch()}
        >
          {t('space.loadError')} · {t('ui.action.retry')}
        </button>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              screenReaderInstructions: { draggable: t('space.dragInstructions') },
              announcements: {
                onDragStart: ({ active }) => t('space.dragPicked', { name: nameOf(active.id) }),
                onDragOver: ({ over }) =>
                  over ? t('space.dragOver', { name: nameOf(over.id) }) : undefined,
                onDragEnd: ({ active }) => t('space.dragDropped', { name: nameOf(active.id) }),
                onDragCancel: () => t('space.dragCanceled'),
              },
            }}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul
                className="flex flex-col gap-0.5"
                aria-label={t('space.mine')}
                data-testid="my-spaces"
              >
                {mine.map((s) => (
                  <SpaceRow
                    key={s.id}
                    space={s}
                    active={activeSlug === s.slug}
                    sortable={s.myRole === 'admin'}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {others.length ? (
            <>
              <div className="px-3 pt-3 pb-1 text-fg-muted text-xs">{t('space.others')}</div>
              <ul className="flex flex-col gap-0.5" aria-label={t('space.others')}>
                {others.map((s) => (
                  <SpaceRow
                    key={s.id}
                    space={s}
                    active={activeSlug === s.slug}
                    sortable={false}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </>
          ) : null}
          <button
            type="button"
            className="mt-2 flex h-8 items-center gap-1 rounded-full px-3 text-fg-muted text-xs hover:bg-hover hover:text-fg"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            data-testid="toggle-archived"
          >
            <Disclosure open={showArchived} />
            {t('space.archived')}
          </button>
          {showArchived ? (
            archived.isPending ? (
              <Skeleton className="mx-1 h-7" />
            ) : archived.data?.length ? (
              <ul className="flex flex-col gap-0.5 opacity-80" aria-label={t('space.archived')}>
                {archived.data.map((s) => (
                  <SpaceRow
                    key={s.id}
                    space={s}
                    active={activeSlug === s.slug}
                    sortable={false}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-3 py-1 text-fg-muted text-xs">{t('space.archivedEmpty')}</p>
            )
          ) : null}
        </>
      )}
    </section>
  )
}

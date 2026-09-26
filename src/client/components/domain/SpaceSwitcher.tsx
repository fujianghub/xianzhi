/**
 * 侧栏空间树（06 §5 SpaceSwitcher、08 §2.5、REQ-SPACE-005 · REQ-KB-002 · REQ-UI-020）：
 * - 个人空间置顶；其余按大类分区（ADR-0012，大类按其顺序，「未分类」最后），分区可折叠——
 *   折叠状态只在用户点击时写入 `localStorage: xz:kb-folds:v1`（不自动写默认值，简斋 localStorage 教训）；
 *   当前所在空间的分区始终展开。
 * - 拖动：只拖手柄（行本身是链接），6px 起拖，键盘空格拿起 / 方向键移动；可在区内排序或拖到另一大类
 *   （落在分区头 = 放到该区最前）。每次放下只发一条 `PATCH /spaces/reorder`；只对 myRole=admin 的空间开放。
 * - 「已归档」折叠，展开时才请求。
 */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { GripVertical, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Me } from '../../hooks/useMe.ts'
import {
  groupSpaces,
  planSpaceMove,
  type Space,
  type SpaceSection,
  sectionDropId,
  spaceGroupsQuery,
  useReorderSpace,
  useSpaces,
} from '../../hooks/useSpaces.ts'
import { cn } from '../../lib/cn.ts'
import { useCreateSpaceDialog } from '../../lib/stores.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { PALETTE_DOT, type PaletteName, SpaceIcon } from './SpaceIcon.tsx'

const FOLDS_KEY = 'xz:kb-folds:v1'
function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}
function writeFolds(v: Record<string, boolean>) {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(v))
  } catch {
    // 隐私模式等：折叠只在本次会话生效
  }
}

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
        to="/spaces/$spaceSlug/home"
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
          aria-label={t('space.dragHandle', { name: space.name })}
          className="absolute top-1.5 right-1.5 inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          data-testid="space-drag-handle"
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
    </li>
  )
}

function Section({
  section,
  open,
  onToggle,
  activeSlug,
  onNavigate,
}: {
  section: SpaceSection
  open: boolean
  onToggle: () => void
  activeSlug: string | undefined
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const dropId = sectionDropId(section.group)
  const { setNodeRef, isOver } = useDroppable({ id: dropId })
  const name = section.group?.name ?? t('space.ungrouped')
  const tone = (section.group?.color as PaletteName | null) ?? 'gray'
  return (
    <div
      className="flex flex-col"
      data-testid="space-section"
      data-group-id={section.group?.id ?? 'none'}
    >
      <button
        ref={setNodeRef}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-muted text-xs hover:bg-hover hover:text-fg',
          isOver && 'bg-selected text-fg',
        )}
        data-testid="space-section-toggle"
      >
        <Disclosure open={open} />
        <span className={cn('size-2 shrink-0 rounded-full', PALETTE_DOT[tone])} aria-hidden />
        <span className="truncate font-medium">{name}</span>
        <span className="ms-auto tabular-nums">{section.items.length}</span>
      </button>
      {open ? (
        <SortableContext
          items={section.items.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-0.5 pb-1" aria-label={name}>
            {section.items.map((s) => (
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
      ) : null}
    </div>
  )
}

export function SpaceSwitcher({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { data, isPending, isError, refetch } = useSpaces()
  const groups = useQuery(spaceGroupsQuery)
  const [showArchived, setShowArchived] = useState(false)
  const archived = useSpaces(true, showArchived)
  const reorder = useReorderSpace()
  const openCreate = useCreateSpaceDialog((s) => s.setOpen)
  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const personal = useMemo(() => (data ?? []).filter((s) => s.isPersonal), [data])
  const sections = useMemo(() => groupSpaces(data ?? [], groups.data ?? []), [data, groups.data])
  const nameOf = (id: unknown) => (data ?? []).find((x) => x.id === id)?.name ?? ''
  const activeSlug = /^\/spaces\/([^/]+)/.exec(path)?.[1]

  const toggle = (key: string) => {
    const next = { ...folds, [key]: !folds[key] }
    setFolds(next)
    writeFolds(next)
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return
    const m = planSpaceMove(sections, String(e.active.id), String(e.over.id))
    if (!m) return
    reorder.mutate(
      { id: String(e.active.id), ...m },
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
          <ul
            className="flex flex-col gap-0.5"
            aria-label={t('space.personal')}
            data-testid="my-spaces"
          >
            {personal.map((s) => (
              <SpaceRow
                key={s.id}
                space={s}
                active={activeSlug === s.slug}
                sortable={false}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
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
            <div className="mt-1 flex flex-col gap-0.5">
              {sections.map((sec) => {
                const key = sec.group?.id ?? 'none'
                const hasActive = sec.items.some((s) => s.slug === activeSlug)
                return (
                  <Section
                    key={key}
                    section={sec}
                    open={hasActive || !folds[key]}
                    onToggle={() => toggle(key)}
                    activeSlug={activeSlug}
                    onNavigate={onNavigate}
                  />
                )
              })}
            </div>
          </DndContext>
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

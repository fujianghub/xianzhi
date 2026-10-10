/**
 * 侧栏空间树（06 §5 SpaceSwitcher、08 §2.5、REQ-SPACE-005 · REQ-KB-002 · REQ-UI-020）：
 * - 个人空间置顶；其余按大类分区（ADR-0012，大类按其顺序，「未分类」最后），分区可折叠——
 *   折叠状态只在用户点击时写入 `localStorage: xz:kb-folds:v1`（不自动写默认值，简斋 localStorage 教训）；
 *   当前所在空间的分区始终展开。
 * - 拖动：只拖手柄（行本身是链接），6px 起拖，键盘空格拿起 / 方向键移动；可在区内排序或拖到另一大类
 *   （落在分区头 = 放到该区最前）。每次放下只发一条 `PATCH /spaces/reorder`；只对 myRole=admin 的空间开放。
 * - 「已归档」折叠，展开时才请求。
 * - 大类管理就地可达（ADR-0018、REQ-KB-008）：owner / admin 在「空间」标题旁有「管理大类」，
 *   每个大类分区标题悬停出 ⋯（改名 / 改色 / 在此新建空间 / 删除）；拖动时「未分类」始终作为放置区出现。
 * - 空间行就地管理（ADR-0035、REQ-KB-011）：空间管理员悬停出 ⋯ / 右键 = 空间菜单（改名 / 图标与颜色 / 归档 / 移到大类 / 删除…）。
 */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
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
import { ChevronRight, FolderCog, GripVertical, Layers, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isAdmin, type Me } from '../../hooks/useMe.ts'
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
import { canCreateIn } from '../../lib/space-queries.ts'
import { useCreateSpaceDialog, useNewEntry } from '../../lib/stores.ts'
import { useContextPoint } from '../ui/context-anchor.tsx'
import { Disclosure } from '../ui/disclosure.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { GroupMenu } from './GroupMenu.tsx'
import { IconChip } from './KindIcon.tsx'
import { SpaceGroupsDialog } from './SpaceGroupsDialog.tsx'
import { type PaletteName, SpaceIcon } from './SpaceIcon.tsx'
import { SpaceMenu, useSpacePerms } from './SpaceMenu.tsx'

/** 行尾悬停按钮的槽位（从右往左：拖动手柄 · ⋯ · +），与链接右内边距对应 */
const SLOT_RIGHT = ['right-1.5', 'right-8', 'right-[3.625rem]'] as const
const SLOT_PAD = ['', 'pr-8', 'pr-14', 'pr-20'] as const

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
  const openNew = useNewEntry((s) => s.setOpen)
  // 在该空间目录顶层新建记录（ADR-0019、REQ-KB-009）；可写 = 个人空间或我是 admin / member（服务端 can() 为准）
  const canCreate = canCreateIn(space)
  const { canManage } = useSpacePerms(space)
  const ctx = useContextPoint()
  // 槽位从右往左依次分配
  const slots = [sortable && 'drag', canManage && 'menu', canCreate && 'plus'].filter(Boolean)
  const right = (k: string) => SLOT_RIGHT[slots.indexOf(k)] ?? 'right-1.5'
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
      onContextMenu={canManage ? ctx.open : undefined}
    >
      <Link
        to="/spaces/$spaceSlug/home"
        params={{ spaceSlug: space.slug }}
        onClick={onNavigate}
        // 与主导航同一套样式（app.css .xz-nav-item；当前项 data-active = 翡翠胶囊，REQ-UI-020 · 032）
        className={cn('xz-nav-item', SLOT_PAD[slots.length])}
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
      {canCreate ? (
        <button
          type="button"
          onClick={() => openNew(true, { spaceId: space.id, parentId: null })}
          aria-label={t('space.newEntryIn', {
            name: space.isPersonal ? t('space.personal') : space.name,
          })}
          title={t('space.newEntryIn', {
            name: space.isPersonal ? t('space.personal') : space.name,
          })}
          className={cn(
            'absolute top-1.5 inline-flex size-6 items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100',
            right('plus'),
          )}
          data-testid="space-row-new-entry"
        >
          <Plus className="size-4" />
        </button>
      ) : null}
      {canManage ? (
        <SpaceMenu
          space={space}
          contextPoint={ctx.point}
          onContextClose={ctx.clear}
          triggerClassName={cn(
            'absolute top-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-lg:opacity-100',
            right('menu'),
          )}
        />
      ) : null}
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
  canManageGroups,
}: {
  section: SpaceSection
  open: boolean
  onToggle: () => void
  activeSlug: string | undefined
  onNavigate?: () => void
  /** owner / admin：分区标题悬停出 ⋯ 菜单 */
  canManageGroups: boolean
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
      <div ref={setNodeRef} className="group/section flex items-center gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-fg-muted text-xs hover:bg-hover hover:text-fg',
            isOver && 'bg-selected text-fg',
          )}
          data-testid="space-section-toggle"
        >
          <Disclosure open={open} />
          <IconChip icon={Layers} tone={tone} size="xs" />
          <span className="truncate font-medium">{name}</span>
          <span className="ms-auto tabular-nums">{section.items.length}</span>
        </button>
        {canManageGroups && section.group ? <GroupMenu group={section.group} /> : null}
      </div>
      {open ? (
        <SortableContext
          items={section.items.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* 空间行缩进一级 + 分区引导线（对齐展开指示中心；含当前空间时为主色，ADR-0015）。
              行从引导线右侧 5px 起（ps-5 = 20，线占 14 ~ 15），当前 / 悬停胶囊不再压过引导线（REQ-UI-053） */}
          <div className="relative ps-5">
            <span
              className="xz-guide"
              style={{ insetInlineStart: '14px' }}
              data-near
              data-active={section.items.some((s) => s.slug === activeSlug) || undefined}
              aria-hidden
            />
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
          </div>
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
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const admin = isAdmin(me)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const personal = useMemo(() => (data ?? []).filter((s) => s.isPersonal), [data])
  const grouped = useMemo(() => groupSpaces(data ?? [], groups.data ?? []), [data, groups.data])
  // 拖动期间「未分类」始终可放（即使当前为空），否则全部归类后就拖不回未分类（ADR-0018）
  const sections = useMemo(
    () =>
      dragging && !grouped.some((sec) => !sec.group)
        ? [...grouped, { group: null, items: [] }]
        : grouped,
    [grouped, dragging],
  )
  const nameOf = (id: unknown) => (data ?? []).find((x) => x.id === id)?.name ?? ''
  const activeSlug = /^\/spaces\/([^/]+)/.exec(path)?.[1]

  const toggle = (key: string) => {
    const next = { ...folds, [key]: !folds[key] }
    setFolds(next)
    writeFolds(next)
  }

  const onDragStart = (_e: DragStartEvent) => setDragging(true)
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false)
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
      <div className="xz-nav-label flex items-center gap-0.5 pr-1">
        {/* 可点的分区标题（REQ-UI-038）：与不可点的「我的视图」区分——正文色 + 箭头 + 悬停底 */}
        <Link
          id="xz-spaces-heading"
          to="/spaces"
          onClick={onNavigate}
          className="xz-nav-label-link"
          data-testid="spaces-heading"
        >
          {t('space.parts')}
          <ChevronRight className="xz-nav-label-arrow size-3.5" aria-hidden />
        </Link>
        <span className="ms-auto" />
        {admin ? (
          <button
            type="button"
            onClick={() => setGroupsOpen(true)}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            aria-label={t('space.groups.manage')}
            title={t('space.groups.manage')}
            data-testid="sidebar-groups-manage"
          >
            <FolderCog className="size-4" />
          </button>
        ) : null}
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
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(false)}
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
                    canManageGroups={admin}
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
      {admin ? <SpaceGroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} /> : null}
    </section>
  )
}

/**
 * 空间目录（ADR-0012、REQ-KB-005、08 §2.5b）：可嵌套的页面树 + 「其余记录」。
 * - 拖放：拖手柄上下移动，水平拖动改变层级（每 24px 一级，夹在前后项之间）；放下只发一条 `PATCH /entries/:id/move`。
 * - 键盘 / 按钮：上移、下移、缩进（成为上一项的子页）、取消缩进（提升一级）、移出目录；每行「新建子页」。
 * - 「其余记录」= 不在目录中的记录（`inTree=0`），「加入目录」放到根级末尾。
 * - 折叠状态按空间存 `localStorage: xz:kb-tree-folds:v1:<spaceId>`（只在用户点击时写入）。
 */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  CornerLeftUp,
  FolderMinus,
  FolderPlus,
  GripVertical,
  Plus,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { entryKindClass } from '../components/domain/EntryCard.tsx'
import { KbHeader } from '../components/domain/KbHeader.tsx'
import { Button } from '../components/ui/button.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { Input } from '../components/ui/input.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { type EntryPage, treeQuery } from '../lib/entry-queries.ts'
import { type Space, spaceQuery } from '../lib/space-queries.ts'
import { useNewEntry } from '../lib/stores.ts'
import {
  appendRoot,
  type FlatItem,
  filterTree,
  flatten,
  keyboardMove,
  type MovePlan,
  projectDrop,
} from '../lib/tree.ts'

export const Route = createFileRoute('/_app/spaces/$spaceSlug_/tree')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(spaceQuery(params.spaceSlug))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) throw notFound()
      throw err
    }
  },
  component: KbTree,
})

const INDENT = 24
const foldsKey = (spaceId: string) => `xz:kb-tree-folds:v1:${spaceId}`
const readFolds = (spaceId: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(foldsKey(spaceId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
const writeFolds = (spaceId: string, v: Set<string>) => {
  try {
    localStorage.setItem(foldsKey(spaceId), JSON.stringify([...v]))
  } catch {
    // 忽略（隐私模式）
  }
}

function KbTree() {
  const { spaceSlug } = Route.useParams()
  const { data: space } = useQuery(spaceQuery(spaceSlug))
  if (!space) return null
  return <TreeBody space={space} />
}

function TreeBody({ space }: { space: Space }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const openNew = useNewEntry((s) => s.setOpen)
  const tree = useQuery(treeQuery(space.id))
  const unfiled = useQuery({
    queryKey: ['entries', { spaceId: space.id, inTree: '0' }, 'unfiled'],
    queryFn: () =>
      unwrap<EntryPage>(
        api.entries.$get({ query: { spaceId: space.id, inTree: '0', limit: '100' } as never }),
      ).then((r) => r.items),
  })
  const [folds, setFolds] = useState<Set<string>>(() => readFolds(space.id))
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState<{ id: string; overId: string; offsetX: number } | null>(null)
  const nodes = tree.data ?? []
  const shown = useMemo(() => filterTree(nodes, q), [nodes, q])
  // 过滤时全部展开，拖动时跳过被拖项的子树
  const items = useMemo(
    () => flatten(shown, q ? new Set() : folds, drag?.id),
    [shown, q, folds, drag?.id],
  )
  const canWrite = space.myRole === 'admin' || space.myRole === 'member'
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const move = useMutation({
    mutationFn: (v: { id: string } & ({ plan: MovePlan } | { detach: true })) =>
      unwrap(
        api.entries[':id'].move.$patch({
          param: { id: v.id },
          json: 'detach' in v ? { detach: true } : v.plan,
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['entries'] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('kb.tree.moveFailed')),
  })
  const toggle = (id: string) => {
    const next = new Set(folds)
    next.has(id) ? next.delete(id) : next.add(id)
    setFolds(next)
    writeFolds(space.id, next)
  }
  const setAll = (collapse: boolean) => {
    const next = new Set(collapse ? nodes.map((n) => n.id) : [])
    setFolds(next)
    writeFolds(space.id, next)
  }
  const onDragMove = (e: DragMoveEvent) =>
    setDrag({
      id: String(e.active.id),
      overId: String(e.over?.id ?? e.active.id),
      offsetX: e.delta.x,
    })
  const onDragEnd = (e: DragEndEvent) => {
    const d = drag
    setDrag(null)
    if (!d || !e.over) return
    const p = projectDrop(items, d.id, String(e.over.id), e.delta.x, INDENT)
    if (p) move.mutate({ id: d.id, plan: { parentId: p.parentId, after: p.after } })
  }
  const projected = drag ? projectDrop(items, drag.id, drag.overId, drag.offsetX, INDENT) : null

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="kb-tree-page">
      <KbHeader space={space} active="tree" />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('kb.tree.filter')}
          aria-label={t('kb.tree.filter')}
          className="h-8 w-56"
        />
        <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
          {t('kb.tree.expandAll')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          {t('kb.tree.collapseAll')}
        </Button>
        {canWrite ? (
          <Button
            size="sm"
            variant="primary"
            className="ms-auto"
            onClick={() => openNew(true, { spaceId: space.id, parentId: null })}
            data-testid="tree-new-root"
          >
            <Plus className="size-4" />
            {t('kb.tree.newRoot')}
          </Button>
        ) : null}
      </div>
      <div className="paper mt-3 rounded-xl p-2" data-testid="kb-tree">
        {tree.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : !items.length ? (
          <p className="p-4 text-fg-muted text-sm">{t('kb.tree.empty')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) =>
              setDrag({ id: String(e.active.id), overId: String(e.active.id), offsetX: 0 })
            }
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDrag(null)}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul aria-label={t('kb.tree.title')} className="flex flex-col">
                {items.map((item) => (
                  <TreeRow
                    key={item.id}
                    item={item}
                    depth={drag?.id === item.id && projected ? projected.depth : item.depth}
                    open={!!q || !folds.has(item.id)}
                    onToggle={() => toggle(item.id)}
                    canWrite={canWrite}
                    onMove={(op) => {
                      const plan = keyboardMove(nodes, item.id, op)
                      if (plan) move.mutate({ id: item.id, plan })
                    }}
                    onDetach={() => move.mutate({ id: item.id, detach: true })}
                    onNewChild={() => openNew(true, { spaceId: space.id, parentId: item.id })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <section className="mt-6" data-testid="kb-unfiled">
        <h2 className="font-medium text-sm">{t('kb.tree.unfiled')}</h2>
        <p className="mt-0.5 text-fg-muted text-xs">{t('kb.tree.unfiledHint')}</p>
        <ul className="mt-2 flex flex-col">
          {(unfiled.data ?? []).map((e) => (
            <li
              key={e.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover"
              data-testid="unfiled-row"
              data-entry-id={e.id}
            >
              <span
                className={cn('shrink-0 rounded-full px-1.5 text-[11px]', entryKindClass(e.kind))}
              >
                {t(`entry.kind.${e.kind}`)}
              </span>
              <Link
                to="/entries/$entryId"
                params={{ entryId: e.id }}
                className="min-w-0 flex-1 truncate"
              >
                {e.title}
              </Link>
              <RelativeTime date={e.updatedAt} className="shrink-0 text-fg-muted text-xs" />
              {canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move.mutate({ id: e.id, plan: appendRoot(nodes) })}
                  data-testid="unfiled-add"
                >
                  <FolderPlus className="size-4" />
                  {t('kb.tree.addToTree')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

function TreeRow({
  item,
  depth,
  open,
  onToggle,
  canWrite,
  onMove,
  onDetach,
  onNewChild,
}: {
  item: FlatItem
  depth: number
  open: boolean
  onToggle: () => void
  canWrite: boolean
  onMove: (op: 'up' | 'down' | 'indent' | 'outdent') => void
  onDetach: () => void
  onNewChild: () => void
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
  } = useSortable({ id: item.id, disabled: !canWrite })
  const icon =
    'grid size-7 place-items-center rounded-md text-fg-muted hover:bg-active hover:text-fg'
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        paddingInlineStart: `${depth * INDENT}px`,
      }}
      className={cn('group relative', isDragging && 'z-10 opacity-80')}
      data-testid="tree-row"
      data-entry-id={item.id}
      data-depth={item.depth}
    >
      <div className="flex items-center gap-1 rounded-md py-1 pe-1 hover:bg-hover">
        {canWrite ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={t('kb.tree.dragHandle', { name: item.title })}
            className="grid size-6 cursor-grab touch-none place-items-center rounded text-fg-faint opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            data-testid="tree-drag-handle"
          >
            <GripVertical className="size-4" />
          </button>
        ) : (
          <span className="size-6" />
        )}
        {item.hasChildren ? (
          <button
            type="button"
            onClick={onToggle}
            className="grid size-6 place-items-center"
            aria-label={item.title}
          >
            <Disclosure open={open} />
          </button>
        ) : (
          <span className="size-6" />
        )}
        <span className={cn('shrink-0 rounded-full px-1.5 text-[11px]', entryKindClass(item.kind))}>
          {t(`entry.kind.${item.kind}`)}
        </span>
        <Link
          to="/entries/$entryId"
          params={{ entryId: item.id }}
          className="min-w-0 flex-1 truncate text-sm hover:text-primary-text"
        >
          {item.title || t('entry.untitled')}
        </Link>
        {canWrite ? (
          <div className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              className={icon}
              aria-label={t('kb.tree.newChild')}
              title={t('kb.tree.newChild')}
              onClick={onNewChild}
              data-testid="tree-new-child"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              className={icon}
              aria-label={t('space.groups.moveUp')}
              title={t('space.groups.moveUp')}
              onClick={() => onMove('up')}
              data-testid="tree-up"
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              className={icon}
              aria-label={t('space.groups.moveDown')}
              title={t('space.groups.moveDown')}
              onClick={() => onMove('down')}
              data-testid="tree-down"
            >
              <ArrowDown className="size-4" />
            </button>
            <button
              type="button"
              className={icon}
              aria-label={t('kb.tree.indent')}
              title={t('kb.tree.indent')}
              onClick={() => onMove('indent')}
              data-testid="tree-indent"
            >
              <CornerDownRight className="size-4" />
            </button>
            <button
              type="button"
              className={icon}
              aria-label={t('kb.tree.outdent')}
              title={t('kb.tree.outdent')}
              onClick={() => onMove('outdent')}
              data-testid="tree-outdent"
            >
              <CornerLeftUp className="size-4" />
            </button>
            <button
              type="button"
              className={icon}
              aria-label={t('kb.tree.detach')}
              title={t('kb.tree.detach')}
              onClick={onDetach}
              data-testid="tree-detach"
            >
              <FolderMinus className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * 记录看板（ADR-0014、REQ-ENTRY-015）：只选一种带 `status` 枚举的类型（Bug / 优化 / 决策 / 学习计划）时可用；
 * 列 = 该类型 status 的定义顺序；拖把手到另一列（或聚焦把手按空格拾起、方向键换列）= PATCH `fields.status`（整体 fields 提交，
 * 带 ifUpdatedAt）。列内按列表当前排序，不做手动排序。
 */
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { GripVertical } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry, EntryKind } from '../../lib/entry-queries.ts'
import { keyFields } from './EntryCard.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'

/** 该类型的 status 枚举；没有则不可用看板。 */
export function boardStatuses(kind: EntryKind | undefined): string[] | null {
  if (!kind) return null
  const f = fieldSpecs(kind).find((x) => x.name === 'status')
  return f && f.kind === 'select' ? f.options.map(String) : null
}

export function EntryBoard({
  items,
  statuses,
  canWrite,
}: {
  items: Entry[]
  statuses: string[]
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  // 放下即本地移动（乐观），请求失败再回原列
  const [override, setOverride] = useState<Record<string, string>>({})
  const statusOf = (e: Entry) => override[e.id] ?? String(e.fields.status ?? statuses[0])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const onDragEnd = (ev: DragEndEvent) => {
    const id = String(ev.active.id)
    const to = ev.over ? String(ev.over.id).replace(/^col:/, '') : null
    const e = items.find((x) => x.id === id)
    if (!e || !to || statusOf(e) === to) return
    setOverride((o) => ({ ...o, [id]: to }))
    void actions
      .patch(e, { fields: { ...e.fields, status: to } })
      .then(() =>
        toast.success(
          t('entry.board.moved', {
            status: t(`entry.fieldValue.${to}`, { defaultValue: to }),
          }),
        ),
      )
      .catch(() => undefined)
      .finally(() =>
        setOverride((o) => {
          const { [id]: _, ...rest } = o
          return rest
        }),
      )
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div
        className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2"
        data-testid="entry-board"
      >
        {statuses.map((s) => (
          <Column key={s} status={s} items={items.filter((e) => statusOf(e) === s)}>
            {(e) => <BoardCard key={e.id} entry={e} draggable={canWrite} />}
          </Column>
        ))}
      </div>
    </DndContext>
  )
}

function Column({
  status,
  items,
  children,
}: {
  status: string
  items: Entry[]
  children: (e: Entry) => React.ReactNode
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` })
  const label = t(`entry.fieldValue.${status}`, { defaultValue: status })
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-testid="entry-board-column"
      data-status={status}
      className={cn(
        'flex min-h-40 flex-col gap-2 rounded-xl border border-divider bg-surface-2 p-2 transition-colors duration-(--xz-dur-fast)',
        isOver && 'border-selected-border bg-selected',
      )}
    >
      <h3 className="flex items-center justify-between px-1 font-medium text-sm">
        {label}
        <span className="text-fg-muted text-xs tabular-nums">{items.length}</span>
      </h3>
      {items.length ? (
        items.map(children)
      ) : (
        <p className="px-1 py-4 text-center text-fg-faint text-xs">{t('entry.board.empty')}</p>
      )}
    </section>
  )
}

function BoardCard({ entry, draggable }: { entry: Entry; draggable: boolean }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
    disabled: !draggable,
  })
  const title = entry.title || t('entry.untitled')
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(1.5deg)` }
    : undefined
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="entry-board-card"
      data-entry-id={entry.id}
      className={cn(
        'paper rounded-lg border border-divider p-3 text-sm',
        isDragging && 'z-10 shadow-card',
      )}
    >
      <div className="flex items-start gap-1">
        <Link
          to="/entries/$entryId"
          params={{ entryId: entry.id }}
          className="line-clamp-2 min-h-6 flex-1 font-medium hover:text-primary-text"
        >
          {title}
        </Link>
        {draggable ? (
          // 拖动把手与标题链接分开（避免交互元素嵌套）；键盘：聚焦后空格拾起、方向键换列
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t('entry.board.drag', { title })}
            className="-mt-0.5 -mr-1 grid size-6 shrink-0 cursor-grab place-items-center rounded text-fg-muted hover:bg-hover"
            data-testid="entry-board-handle"
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
      </div>
      {entry.path?.length ? (
        <p className="mt-1 truncate text-fg-faint text-xs">
          {entry.path.map((p) => p.title || t('entry.untitled')).join(' / ')}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
        {keyFields(entry)
          .filter((f) => f.name !== 'status')
          .map((f) => (
            <span key={f.name} className="rounded bg-surface px-1.5 py-0.5 text-fg-muted">
              {t(`entry.fieldValue.${f.value}`, { defaultValue: f.value })}
            </span>
          ))}
      </div>
    </div>
  )
}

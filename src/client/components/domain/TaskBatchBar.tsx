/**
 * 页面级多选与批量（ADR-0045、REQ-TASK-040 · 041）。
 * - `TaskSelectionScope`：页面包一层即启用跨分组选择；挂载 / 卸载 / `scopeKey` 变化时清空（换视图不残留）。
 * - 批量条（选中 ≥ 1 或处于选择模式时出现）：已选 N · 全选当前视图 · 完成 · 日期 · 优先级 · 清单 · 空间 · 标签 · 状态 · 删除 · 退出。
 * - 一律 `POST /tasks/batch`，按 100 条分块；某块失败（服务端全有或全无）→ 提示首个失败项与原因，已成功的块保留。
 * - 完成 / 删除可撤销：批量 uncomplete（服务端幂等）/ restore（只撤销本人可恢复的：自己建的，或工作区管理员）。
 */
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Flag,
  FolderInput,
  ListTodo,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { quickDueIso } from '../../../shared/quick-add.ts'
import { useMe } from '../../hooks/useMe.ts'
import { useSpaces } from '../../hooks/useSpaces.ts'
import { type TaskPatch, useTaskActions } from '../../hooks/useTasks.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { canCreateIn } from '../../lib/space-queries.ts'
import { TASK_STATUSES, type Task } from '../../lib/task-queries.ts'
import {
  resetSelection,
  SelectionEnabledContext,
  selectionOrder,
  useTaskSelectionStore,
} from '../../lib/task-selection.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { tagsQuery } from './TagPicker.tsx'
import { DuePicker, ListPicker, PRIORITY_LEVELS, PriorityPicker } from './TaskPickers.tsx'

const CHUNK = 100

export function TaskSelectionScope({
  scopeKey,
  children,
}: {
  /** 视图标识：变化即清空选择 */
  scopeKey: string
  children: ReactNode
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey 变化即清空，正是本 effect 的用途
  useEffect(() => {
    resetSelection()
    return () => resetSelection()
  }, [scopeKey])
  return (
    <SelectionEnabledContext.Provider value={true}>
      {children}
      <TaskBatchBar />
    </SelectionEnabledContext.Provider>
  )
}

/** 页头「选择」按钮 */
export function SelectModeButton() {
  const { t } = useTranslation()
  const on = useTaskSelectionStore((s) => s.selectMode)
  const setMode = useTaskSelectionStore((s) => s.setSelectMode)
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setMode(!on)}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs',
        on ? 'border-selected-border bg-selected font-medium' : 'border-border hover:bg-hover',
      )}
      data-testid="select-mode"
    >
      <CheckCheck className="size-3.5" aria-hidden />
      {t(on ? 'taskBatch.exitSelect' : 'taskBatch.select')}
    </button>
  )
}

type Op =
  | { op: 'update'; id: string; patch: TaskPatch & { ifUpdatedAt: string } }
  | { op: 'complete' | 'delete' | 'restore' | 'uncomplete'; id: string }

function TaskBatchBar() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const actions = useTaskActions()
  const selected = useTaskSelectionStore((s) => s.selected)
  const selectMode = useTaskSelectionStore((s) => s.selectMode)
  const store = useTaskSelectionStore.getState
  const { data: spaces } = useSpaces()
  const tags = useQuery(tagsQuery)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<null | 'due' | 'prio' | 'list' | 'space' | 'tags' | 'status'>(
    null,
  )
  const items = [...selected.values()]
  const n = items.length
  if (!n && !selectMode) return null
  const tz = me?.timezone ?? 'Asia/Shanghai'
  const isAdmin = me?.workspaceRole === 'owner' || me?.workspaceRole === 'admin'

  /** 分块提交；返回成功的 id。失败块提示首个失败项。 */
  const run = async (
    ops: Op[],
    label: string,
    undo?: { ops: (ids: string[]) => Op[]; skipped?: number },
  ) => {
    if (!ops.length) return []
    setBusy(true)
    const ok: string[] = []
    let firstErr: string | null = null
    try {
      for (let i = 0; i < ops.length; i += CHUNK) {
        const chunk = ops.slice(i, i + CHUNK)
        try {
          await actions.batch(chunk as never)
          ok.push(...chunk.map((o) => o.id))
        } catch (e) {
          const res =
            (e instanceof ApiError
              ? (
                  e.problem as unknown as {
                    results?: { ok: boolean; id: string; detail?: string }[]
                  }
                ).results
              : undefined) ?? []
          const bad = res.find((r) => !r.ok)
          const title = bad ? selected.get(bad.id)?.title : undefined
          firstErr ??= title
            ? t('taskBatch.failedItem', { title, reason: bad?.detail ?? '' })
            : e instanceof ApiError
              ? e.message
              : t('task.saveFailed')
        }
      }
    } finally {
      setBusy(false)
    }
    if (firstErr)
      toast.error(t('taskBatch.partial', { ok: ok.length, total: ops.length, reason: firstErr }))
    else if (undo) {
      const back = undo.ops(ok)
      toast.success(label + (undo.skipped ? t('taskBatch.undoSkipped', { n: undo.skipped }) : ''), {
        action: back.length
          ? { label: t('task.undo'), onClick: () => void run(back, t('taskBatch.undone')) }
          : undefined,
      })
    } else toast.success(label)
    return ok
  }
  const updateAll = (patch: (x: Task) => TaskPatch | null, label: string) => {
    setOpen(null)
    const ops: Op[] = items.flatMap((x) => {
      const p = patch(x)
      return p
        ? [{ op: 'update' as const, id: x.id, patch: { ...p, ifUpdatedAt: x.updatedAt } }]
        : []
    })
    void run(ops, t('taskBatch.done', { n: ops.length, what: label }))
  }
  const complete = () => {
    const open = items.filter((x) => x.status !== 'done')
    void run(
      open.map((x) => ({ op: 'complete' as const, id: x.id })),
      t('taskBatch.completed', { n: open.length }),
      { ops: (ids) => ids.map((id) => ({ op: 'uncomplete' as const, id })) },
    ).then(() => store().clear())
  }
  const remove = () => {
    // 撤销只覆盖本人可恢复的（自己建的或管理员，服务端 requireTrashedTask）
    const restorable = new Set(
      items.filter((x) => isAdmin || x.creatorId === me?.id).map((x) => x.id),
    )
    void run(
      items.map((x) => ({ op: 'delete' as const, id: x.id })),
      t('taskBatch.deleted', { n: items.length }),
      {
        ops: (ids) =>
          ids.filter((id) => restorable.has(id)).map((id) => ({ op: 'restore' as const, id })),
        skipped: items.length - restorable.size,
      },
    ).then(() => store().clear())
  }
  const ownTags = tags.data ?? []
  const tagState = (id: string) => {
    const k = items.filter((x) => x.tags.some((g) => g.id === id)).length
    return k === 0 ? 'none' : k === n ? 'all' : 'some'
  }
  const writable = (spaces ?? []).filter((s) => !s.archivedAt && canCreateIn(s))
  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs hover:bg-hover disabled:opacity-50'
  const pop = (k: NonNullable<typeof open>) => ({
    open: open === k,
    onOpenChange: (o: boolean) => setOpen(o ? k : null),
  })
  return (
    <div
      role="toolbar"
      aria-label={t('taskBatch.toolbar')}
      className="glass-thick-flat fixed inset-x-0 bottom-[calc(var(--xz-bottomnav-h)+env(safe-area-inset-bottom)+0.75rem)] z-(--xz-z-sticky) mx-auto flex w-fit max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 text-sm lg:bottom-6"
      data-testid="batch-bar"
    >
      <span className="px-2 font-medium tabular-nums" data-testid="batch-count">
        {t('task.selected', { count: n })}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => store().add(selectionOrder())}
        data-testid="batch-select-all"
      >
        {t('taskBatch.selectAll')}
      </button>
      {n ? (
        <>
          <span className="mx-1 h-5 w-px bg-divider" aria-hidden />
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={complete}
            data-testid="batch-complete"
          >
            <CheckCircle2 className="size-3.5 text-success" />
            {t('taskMenu.complete')}
          </button>
          <DuePicker
            value={null}
            {...pop('due')}
            onChange={(v) =>
              updateAll(() => ({ dueAt: v ? quickDueIso(v, tz) : null }), t('taskBatch.what.due'))
            }
            trigger={
              <button type="button" className={btn} disabled={busy} data-testid="batch-due">
                <CalendarDays className="size-3.5" />
                {t('taskMenu.due')}
              </button>
            }
          />
          <PriorityPicker
            value={-1}
            {...pop('prio')}
            onChange={(p) =>
              updateAll(
                (x) => (x.priority === p ? null : { priority: p }),
                t('taskBatch.what.priority'),
              )
            }
            trigger={
              <button type="button" className={btn} disabled={busy} data-testid="batch-priority">
                <Flag className="size-3.5" />
                {t('task.priorityLabel')}
              </button>
            }
          />
          <ListPicker
            value={undefined as unknown as null}
            {...pop('list')}
            onChange={(listId) =>
              updateAll(
                (x) => ((x.list?.id ?? null) === listId ? null : { listId }),
                t('taskBatch.what.list'),
              )
            }
            trigger={
              <button type="button" className={btn} disabled={busy} data-testid="batch-list">
                <ListTodo className="size-3.5" />
                {t('taskLists.list')}
              </button>
            }
          />
          <Popover {...pop('space')}>
            <PopoverTrigger asChild>
              <button type="button" className={btn} disabled={busy} data-testid="batch-space">
                <FolderInput className="size-3.5" />
                {t('space.space')}
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" side="top" className="w-56 p-1">
              {writable.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="xz-picker-item"
                  onClick={() =>
                    updateAll(
                      (x) => (x.spaceId === s.id ? null : { spaceId: s.id }),
                      t('taskBatch.what.space'),
                    )
                  }
                >
                  {s.isPersonal ? t('space.personal') : s.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover {...pop('tags')}>
            <PopoverTrigger asChild>
              <button type="button" className={btn} disabled={busy} data-testid="batch-tags">
                <TagIcon className="size-3.5" />
                {t('task.tags')}
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" side="top" className="max-h-72 w-56 overflow-y-auto p-1">
              <p className="px-2 py-1 text-fg-muted text-xs">{t('taskBatch.tagsHint')}</p>
              {ownTags.map((g) => {
                const st = tagState(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    className="xz-picker-item"
                    aria-pressed={st === 'all'}
                    onClick={() =>
                      updateAll((x) => {
                        const cur = x.tags.map((y) => y.id)
                        const has = cur.includes(g.id)
                        if (st === 'all')
                          return has ? { tagIds: cur.filter((y) => y !== g.id) } : null
                        return has ? null : { tagIds: [...cur, g.id] }
                      }, t('taskBatch.what.tags'))
                    }
                    data-testid="batch-tag"
                  >
                    <span className="w-4 text-center" aria-hidden>
                      {st === 'all' ? '✓' : st === 'some' ? '–' : ''}
                    </span>
                    #{g.name}
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
          <Popover {...pop('status')}>
            <PopoverTrigger asChild>
              <button type="button" className={btn} disabled={busy} data-testid="batch-status">
                {t('task.statusLabel')}
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" side="top" className="w-40 p-1">
              {TASK_STATUSES.map((st) => (
                <button
                  key={st}
                  type="button"
                  className="xz-picker-item"
                  onClick={() =>
                    updateAll(
                      (x) => (x.status === st ? null : { status: st }),
                      t('taskBatch.what.status'),
                    )
                  }
                >
                  {t(`task.status.${st}`)}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            className={cn(btn, 'text-danger')}
            disabled={busy}
            onClick={remove}
            data-testid="batch-delete"
          >
            <Trash2 className="size-3.5" />
            {t('taskMenu.delete')}
          </button>
        </>
      ) : null}
      <button
        type="button"
        aria-label={t('task.clearSelection')}
        className="grid size-8 place-items-center rounded-full hover:bg-hover"
        onClick={() => store().setSelectMode(false)}
        data-testid="batch-clear"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// 优先级选择的可选值（批量条用 -1 表示「无当前值」）
void PRIORITY_LEVELS

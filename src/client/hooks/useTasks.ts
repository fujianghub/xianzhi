/**
 * 任务写操作（02 §5 · §9、04 §6）：一律乐观更新（optimisticPatch），409 用 current 覆盖并提示，其余失败回滚并提示。
 * 列表缓存形态统一为 InfiniteData<TaskPage>；写成功后失效 ['tasks'] 让列归属（状态 / 空间变化）重新计算。
 */
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, unwrap } from '../lib/api.ts'
import { optimisticPatch } from '../lib/optimistic.ts'
import type { Task, TaskPages } from '../lib/task-queries.ts'
import { newId } from '../lib/uuid.ts'

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'status'
    | 'priority'
    | 'dueAt'
    | 'scheduledAt'
    | 'assigneeId'
    | 'estimateMinutes'
    | 'parentId'
    | 'spaceId'
    | 'sortKey'
    | 'cycleId'
  >
> & { descriptionPm?: unknown; tagIds?: string[] }

/** 把某个任务的改动应用到所有已缓存的列表页与详情。 */
function mapTask(data: unknown, id: string, fn: (t: Task) => Task): unknown {
  if (!data || typeof data !== 'object') return data
  if ('pages' in (data as object)) {
    const d = data as TaskPages
    return {
      ...d,
      pages: d.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === id ? fn(t) : t)) })),
    }
  }
  const t = data as Task
  return t.id === id ? fn(t) : t
}
const keysFor = (qc: QueryClient, id: string): QueryKey[] => [
  ...qc.getQueriesData({ queryKey: ['tasks'] }).map(([k]) => k),
  ['task', id],
]

export function useTaskActions() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const invalidateLists = () => qc.invalidateQueries({ queryKey: ['tasks'] })

  const patch = (task: Task, change: TaskPatch, opts: { silent?: boolean } = {}) =>
    optimisticPatch<Task>({
      qc,
      keys: keysFor(qc, task.id),
      apply: (d) => mapTask(d, task.id, (x) => ({ ...x, ...(change as Partial<Task>) })),
      settle: (d, server) => mapTask(d, task.id, () => server),
      request: () =>
        unwrap<Task>(
          api.tasks[':id'].$patch({
            param: { id: task.id },
            json: { ...change, ifUpdatedAt: task.updatedAt } as never,
          }),
        ),
      onConflict: () => toast.error(t('task.conflict')),
      onError: () => {
        if (!opts.silent) toast.error(t('task.saveFailed'))
      },
    }).finally(() => {
      void invalidateLists()
    })

  const complete = (task: Task) =>
    optimisticPatch<Task>({
      qc,
      keys: keysFor(qc, task.id),
      apply: (d) =>
        mapTask(d, task.id, (x) => ({
          ...x,
          status: 'done',
          completedAt: new Date().toISOString(),
        })),
      settle: (d, server) => mapTask(d, task.id, () => server),
      request: () => unwrap<Task>(api.tasks[':id'].complete.$post({ param: { id: task.id } })),
      onConflict: () => toast.error(t('task.conflict')),
      onError: () => toast.error(t('task.saveFailed')),
    })

  const uncomplete = async (task: Task) => {
    const r = await unwrap<Task>(api.tasks[':id'].uncomplete.$post({ param: { id: task.id } }))
    qc.setQueryData(['task', task.id], r)
    await invalidateLists()
    return r
  }

  const create = async (input: {
    title: string
    spaceId?: string
    status?: Task['status']
    dueAt?: string | null
    parentId?: string
    assigneeId?: string
  }) => {
    const r = await unwrap<Task>(
      api.tasks.$post({ json: input as never }, { headers: { 'idempotency-key': newId() } }),
    )
    await invalidateLists()
    return r
  }

  const restore = async (task: Task) => {
    await unwrap(api.tasks[':id'].restore.$post({ param: { id: task.id } }))
    await invalidateLists()
  }

  /** 软删；`undo` = Toast 带「撤销」（POST restore）。 */
  const remove = async (task: Task, opts: { undo?: boolean } = {}) => {
    try {
      await unwrap<void>(api.tasks[':id'].$delete({ param: { id: task.id } }))
    } finally {
      await invalidateLists()
    }
    toast.success(
      opts.undo ? t('calendar.quick.taskDeleted', { title: task.title }) : t('task.deleted'),
      opts.undo
        ? { action: { label: t('task.undo'), onClick: () => void restore(task) } }
        : undefined,
    )
  }

  const batch = async (
    ops: {
      op: 'update' | 'complete' | 'delete'
      id: string
      patch?: TaskPatch & { ifUpdatedAt: string }
    }[],
  ) => {
    const r = await unwrap<{ results: { ok: boolean }[] }>(
      api.tasks.batch.$post({ json: { ops } as never }),
    )
    await invalidateLists()
    return r
  }

  return { patch, complete, uncomplete, create, remove, restore, batch, invalidateLists }
}

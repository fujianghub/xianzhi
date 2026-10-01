/**
 * 个人清单与任务计数（ADR-0044）：`GET /task-lists`、`GET /tasks/counts`。
 * 计数放在 ['tasks', 'counts', …] 下：任务的实时失效键 ['tasks'] 会一并刷新它。
 */
import type { TaskListView } from '../../server/services/task-lists.ts'
import type { TaskCounts } from '../../server/services/tasks.ts'
import { api, unwrap } from './api.ts'

export type TaskList = TaskListView

/** 任务页智能清单（ADR-0044）：放在这里（轻模块）——路由的 validateSearch 在主包里，不能引组件 */
export const SMART_VIEWS = ['all', 'today', 'tomorrow', 'next7', 'unlisted', 'done'] as const
export type SmartView = (typeof SMART_VIEWS)[number]
export type { TaskCounts }

export const taskListsQuery = {
  queryKey: ['task-lists'] as const,
  queryFn: () => unwrap<{ items: TaskList[]; canCreate: boolean }>(api['task-lists'].$get()),
  staleTime: 60_000,
}

export const taskCountsQuery = (spaceId?: string) => ({
  queryKey: ['tasks', 'counts', spaceId ?? ''] as const,
  queryFn: () => unwrap<TaskCounts>(api.tasks.counts.$get({ query: spaceId ? { spaceId } : {} })),
  staleTime: 15_000,
})

/** 清单树：根层（文件夹与未入文件夹的清单）按 sortKey，文件夹带其下清单 */
export interface ListNode {
  item: TaskList
  children: TaskList[]
}
export function listTree(items: TaskList[]): ListNode[] {
  const bySort = (a: TaskList, b: TaskList) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
  return items
    .filter((x) => !x.parentId)
    .sort(bySort)
    .map((item) => ({
      item,
      children:
        item.kind === 'folder' ? items.filter((x) => x.parentId === item.id).sort(bySort) : [],
    }))
}

/** 只要清单（不含文件夹），按树序 */
export const flatLists = (items: TaskList[]): TaskList[] =>
  listTree(items).flatMap((n) => (n.item.kind === 'list' ? [n.item] : n.children))

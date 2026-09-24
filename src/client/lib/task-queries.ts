/**
 * 任务查询定义（无 React 依赖，路由 loader 可引用；02 §9 `GET /tasks`）。
 * 列表统一用无限查询形态（每页 ≤ 200，游标不进 URL，08 §2 约定）。
 */
import type { InfiniteData } from '@tanstack/react-query'
import type { TaskView } from '../../server/services/tasks.ts'
import { api, unwrap } from './api.ts'

export type Task = TaskView
export type TaskStatus = Task['status']
export const TASK_STATUSES = [
  'inbox',
  'todo',
  'doing',
  'blocked',
  'done',
  'cancelled',
] as const satisfies readonly TaskStatus[]

/** 与 02 §9 查询参数同名（08 §2 约定：前端不另起别名）。 */
export interface TaskListParams {
  spaceId?: string
  status?: string
  assigneeId?: string
  creatorId?: string
  cycleId?: string
  parentId?: string
  tag?: string
  q?: string
  sort?: string
  view?: 'today' | 'inbox'
  due?: 'today' | 'week' | 'overdue'
  dueBefore?: string
  dueAfter?: string
  deleted?: '1'
}
export interface TaskPage {
  items: Task[]
  nextCursor: string | null
}
export type TaskPages = InfiniteData<TaskPage, string | undefined>

const clean = (p: TaskListParams) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')) as Record<
    string,
    string
  >

export const tasksKey = (p: TaskListParams) => ['tasks', clean(p)] as const

export const tasksInfiniteQuery = (p: TaskListParams, limit = 200) => ({
  queryKey: tasksKey(p),
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    unwrap<TaskPage>(
      api.tasks.$get({
        query: {
          ...clean(p),
          limit: String(limit),
          ...(pageParam ? { cursor: pageParam } : {}),
        } as never,
      }),
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: TaskPage) => last.nextCursor ?? undefined,
  staleTime: 15_000,
})

export const taskQuery = (id: string) => ({
  queryKey: ['task', id] as const,
  queryFn: () => unwrap<Task>(api.tasks[':id'].$get({ param: { id } })),
  staleTime: 10_000,
})

export const flattenPages = (d: InfiniteData<TaskPage, unknown> | undefined): Task[] =>
  d?.pages.flatMap((p) => p.items) ?? []

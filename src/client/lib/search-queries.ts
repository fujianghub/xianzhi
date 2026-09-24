/** 搜索查询定义（无 React 依赖；02 §4.1 `GET /search`）。 */
import type { SearchHit } from '../../server/services/search.ts'
import { api, unwrap } from './api.ts'

export type Hit = SearchHit
export interface SearchResult {
  groups: {
    tasks?: { items: Hit[]; nextCursor: string | null }
    entries?: { items: Hit[]; nextCursor: string | null }
  }
}
export interface SearchParams {
  q: string
  types?: string
  spaceId?: string
  limit?: number
  cursorTasks?: string
  cursorEntries?: string
}

export const searchQuery = (p: SearchParams) => ({
  queryKey: ['search', p] as const,
  queryFn: () =>
    unwrap<SearchResult>(
      api.search.$get({
        query: Object.fromEntries(
          Object.entries({ ...p, limit: p.limit ? String(p.limit) : undefined }).filter(
            ([, v]) => v !== undefined && v !== '',
          ),
        ) as never,
      }),
    ),
  staleTime: 10_000,
  retry: false,
})

/** 结果的跳转目标。 */
export const hitLink = (h: Hit) =>
  h.type === 'task'
    ? ({
        to: '/spaces/$spaceSlug/tasks/$taskId',
        params: { spaceSlug: h.spaceSlug, taskId: h.id },
      } as const)
    : ({ to: '/entries/$entryId', params: { entryId: h.id } } as const)

/**
 * 记录查询定义（无 React / zod 依赖，路由 loader 可引用；02 §9 `GET /entries`，08 §2.8）。
 */
import type { InfiniteData } from '@tanstack/react-query'
import type { EntryView } from '../../server/services/entries.ts'
import { api, unwrap } from './api.ts'

export type Entry = EntryView
export type EntryKind = Entry['kind']
export const ENTRY_KINDS = [
  'decision',
  'iteration',
  'bug',
  'changelog',
  'journal',
  'note',
  'review',
] as const satisfies readonly EntryKind[]
export const ENTRY_SORTS = ['-updatedAt', '-createdAt', 'title'] as const

/** 与 02 §9 查询参数同名（kind 为 csv，前端按单值逐个请求时直接传）。 */
export interface EntryListParams {
  spaceId?: string
  kind?: string
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1' | '0'
  sort?: string
  deleted?: '1'
  archived?: '1'
}
export interface EntryPage {
  items: Entry[]
  nextCursor: string | null
}

const clean = (p: EntryListParams) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')) as Record<
    string,
    string
  >

export const entriesKey = (p: EntryListParams) => ['entries', clean(p)] as const

export const entriesInfiniteQuery = (p: EntryListParams, limit = 30) => ({
  queryKey: entriesKey(p),
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    unwrap<EntryPage>(
      api.entries.$get({
        query: {
          ...clean(p),
          limit: String(limit),
          ...(pageParam ? { cursor: pageParam } : {}),
        } as never,
      }),
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: EntryPage) => last.nextCursor ?? undefined,
  staleTime: 15_000,
})

export const entryQuery = (id: string) => ({
  queryKey: ['entry', id] as const,
  queryFn: () => unwrap<Entry>(api.entries[':id'].$get({ param: { id }, query: {} })),
  staleTime: 10_000,
})

export const flattenEntries = (d: InfiniteData<EntryPage, unknown> | undefined): Entry[] =>
  d?.pages.flatMap((p) => p.items) ?? []

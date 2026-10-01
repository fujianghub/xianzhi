/**
 * 记录查询定义（无 React / zod 依赖，路由 loader 可引用；02 §9 `GET /entries`，08 §2.8）。
 */
import type { InfiniteData } from '@tanstack/react-query'
import type { EntryView } from '../../server/services/entries.ts'
import { api, unwrap } from './api.ts'
import type { TreeNodeLite } from './tree.ts'

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
  'optimize',
  'plan',
] as const satisfies readonly EntryKind[]
export const ENTRY_SORTS = ['-updatedAt', '-createdAt', 'title'] as const
/** 只选 Bug 时多出的排序（ADR-0033） */
export const BUG_SORTS = ['priority', '-foundAt'] as const
/** Bug 排序里字段仍可见的那些（代码字段覆盖隐藏了优先级 / 发现日期则不列，ADR-0042） */
export const bugSorts = (specs: readonly { name: string }[]) =>
  BUG_SORTS.filter((s) => specs.some((f) => f.name === s.replace(/^-/, '')))

/** 与 02 §9 查询参数同名（kind 为 csv，前端按单值逐个请求时直接传）。 */
export interface EntryListParams {
  spaceId?: string
  kind?: string
  /** 自定义类型 id，逗号多值（ADR-0016） */
  typeId?: string
  /** `status=open|fixed,severity=high`（ADR-0012） */
  fields?: string
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1' | '0'
  sort?: string
  deleted?: '1'
  archived?: '1'
  /** 目录子树（含节点本身）· 大类（none = 未分类）· 本人收藏 · 按 id（最近打开）（ADR-0014） */
  under?: string
  groupId?: string
  favorite?: '1'
  ids?: string
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

/** 空间目录树（ADR-0012；记录页左栏与目录页共用）。 */
export const treeQuery = (spaceId: string) => ({
  queryKey: ['entries', 'tree', spaceId] as const,
  queryFn: () =>
    unwrap<{ items: TreeNodeLite[] }>(api.spaces[':id'].tree.$get({ param: { id: spaceId } })).then(
      (r) => r.items,
    ),
  staleTime: 15_000,
})

/** GET /entries/stats（ADR-0033）：与列表同口径的分组计数。 */
export interface EntryStats {
  total: number
  groups: { values: Record<string, string | null>; n: number }[]
}
export type EntryStatsParams = Omit<EntryListParams, 'sort' | 'pinned'> & { groupBy?: string }
export const entryStatsQuery = (p: EntryStatsParams) => ({
  queryKey: ['entries', 'stats', clean(p)] as const,
  queryFn: () => unwrap<EntryStats>(api.entries.stats.$get({ query: clean(p) as never })),
  staleTime: 15_000,
})
/** 分组计数 → { 取值（缺值为 ''）: 条数 }（单个分组键时用）。 */
export const statsByValue = (s: EntryStats | undefined, key: string): Map<string, number> =>
  new Map((s?.groups ?? []).map((g) => [g.values[key] ?? '', g.n]))

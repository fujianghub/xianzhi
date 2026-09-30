/**
 * 记录页 search params 白名单（08 §2.8；ADR-0033）：路由 validateSearch、保存视图（服务端校验 `entry_views.search`）、
 * 查询块（`entryQuery.query`）三处共用。纯 TS、不依赖 zod（路由配置在主 chunk，REQ-UI-015）。
 * 非法值一律丢弃为 undefined。
 */
export const ENTRY_KIND_VALUES = [
  'decision',
  'iteration',
  'bug',
  'changelog',
  'journal',
  'note',
  'review',
  'optimize',
  'plan',
] as const
export const ENTRY_VIEW_VALUES = ['table', 'cards', 'board', 'timeline', 'stats'] as const
export const ENTRY_SORT_VALUES = [
  '-updatedAt',
  '-createdAt',
  'title',
  'priority',
  '-foundAt',
] as const
/** 表格分组键（ADR-0033）：只对单一类型有意义，其余忽略；ADR-0036 另可按自定义单选字段（x 键）分组。 */
export const ENTRY_GROUP_VALUES = ['status', 'priority', 'severity', 'module'] as const
const EXTRA_GROUP_RE = /^x[A-Z]{6}$/

export type EntryView = (typeof ENTRY_VIEW_VALUES)[number]
export type EntryGroup = (typeof ENTRY_GROUP_VALUES)[number] | `x${string}`

/** 可持久化的筛选（保存视图 / 查询块）：不含 recent / select 这类只属本机本次的状态。 */
export interface EntryFilterSearch {
  kind?: string
  typeId?: string
  fields?: string
  view?: EntryView
  group?: EntryGroup
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1'
  sort?: (typeof ENTRY_SORT_VALUES)[number]
  spaceId?: string
  under?: string
  groupId?: string
  favorite?: '1'
  archived?: '1'
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): T | undefined =>
    typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (v: unknown): string | undefined =>
  typeof v === 'string' && UUID_RE.test(v) ? v : undefined
const csvOf = (values: readonly string[]) => (v: unknown) => {
  if (typeof v !== 'string' || !v) return undefined
  const parts = v.split(',').filter(Boolean)
  return parts.length && parts.every((p) => values.includes(p)) ? parts.join(',') : undefined
}
const uuidCsv = (v: unknown): string | undefined => {
  const parts = str(v)?.split(',').filter(Boolean) ?? []
  return parts.length && parts.length <= 50 && parts.every((p) => uuid(p))
    ? parts.join(',')
    : undefined
}
const one = (v: unknown) => (v === '1' || v === 1 ? ('1' as const) : undefined)
/** 字段过滤 `status=new|fixed,severity=high`（ADR-0012；与 02 §9 `fields` 同名同格式）。 */
const FIELDS_RE = /^[a-zA-Z]{1,40}=[^,=]{1,200}(,[a-zA-Z]{1,40}=[^,=]{1,200}){0,4}$/

/** 白名单清洗：只留认识的键与合法值；undefined 的键被去掉。 */
export function sanitizeEntryFilter(s: Record<string, unknown>): EntryFilterSearch {
  const fields = str(s.fields)
  const out: EntryFilterSearch = {
    kind: csvOf(ENTRY_KIND_VALUES)(s.kind),
    typeId: uuidCsv(s.typeId),
    fields: fields && FIELDS_RE.test(fields) ? fields : undefined,
    view: oneOf(ENTRY_VIEW_VALUES)(s.view),
    group:
      typeof s.group === 'string' && EXTRA_GROUP_RE.test(s.group)
        ? (s.group as EntryGroup)
        : oneOf(ENTRY_GROUP_VALUES)(s.group),
    authorId: s.authorId === 'me' ? 'me' : uuid(s.authorId),
    tag: str(s.tag)?.slice(0, 400),
    q: str(s.q)?.slice(0, 200),
    pinned: one(s.pinned),
    sort: oneOf(ENTRY_SORT_VALUES)(s.sort),
    spaceId: uuid(s.spaceId),
    under: uuid(s.under),
    groupId: s.groupId === 'none' ? 'none' : uuid(s.groupId),
    favorite: one(s.favorite),
    archived: one(s.archived),
  }
  for (const k of Object.keys(out) as (keyof EntryFilterSearch)[])
    if (out[k] === undefined) delete out[k]
  return out
}

/** URLSearchParams 串 ⇄ 筛选（查询块 attrs.query）。 */
export const parseEntryFilter = (query: string): EntryFilterSearch =>
  sanitizeEntryFilter(
    Object.fromEntries(new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)),
  )
export function stringifyEntryFilter(f: EntryFilterSearch): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(sanitizeEntryFilter(f as Record<string, unknown>)))
    p.set(k, String(v))
  return p.toString()
}

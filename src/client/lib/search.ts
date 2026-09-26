/**
 * URL search 序列化（08 §2）：值一律为纯字符串，多值用逗号分隔，不 JSON 编码；cursor 永不进 URL。
 */
export function parseSearch(search: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(search.startsWith('?') ? search.slice(1) : search))
    out[k] = v
  return out
}

export function stringifySearch(search: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null || v === '' || k === 'cursor') continue
    p.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

/**
 * 路由 validateSearch 用的轻量校验器：路由配置在主 chunk，用 zod 会把 zod 整包拉进首屏（REQ-UI-015）。
 * 非法值一律丢弃为 undefined（与 zod `.optional()` + `.catch(undefined)` 等价）。
 */
export const optString = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined
export const optOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): T | undefined =>
    typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const optUuid = (v: unknown): string | undefined =>
  typeof v === 'string' && UUID_RE.test(v) ? v : undefined
/** 逗号多值且每项在白名单内（如 status=todo,doing）；整体无效则丢弃。 */
export const optCsvOf =
  (values: readonly string[]) =>
  (v: unknown): string | undefined => {
    if (typeof v !== 'string' || !v) return undefined
    const parts = v.split(',').filter(Boolean)
    return parts.length && parts.every((p) => values.includes(p)) ? parts.join(',') : undefined
  }

export const csvList = (v: string | undefined): string[] => (v ? v.split(',').filter(Boolean) : [])

/** 记录列表 search（08 §2.8；名字与 02 §9 一致）。 */
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
/** 字段过滤 `status=open|fixed,severity=high`（ADR-0012；与 02 §9 `fields` 同名同格式）。 */
const FIELDS_RE = /^[a-zA-Z]{1,40}=[^,=]{1,200}(,[a-zA-Z]{1,40}=[^,=]{1,200}){0,4}$/
/** 逗号分隔的 uuid（自定义类型筛选 `typeId=a,b`，ADR-0016）；有非法项则整体丢弃 */
const optUuidCsv = (v: unknown): string | undefined => {
  const parts = optString(v)?.split(',').filter(Boolean) ?? []
  return parts.length && parts.length <= 50 && parts.every((p) => optUuid(p))
    ? parts.join(',')
    : undefined
}
export function validateEntriesSearch(s: Record<string, unknown>): {
  kind?: string
  typeId?: string
  fields?: string
  /** 缺省 = 列表（ADR-0016）；cards = 卡片；table 为旧链接兼容，等同列表 */
  view?: 'table' | 'cards' | 'board' | 'timeline'
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1'
  sort?: string
  spaceId?: string
  under?: string
  groupId?: string
  favorite?: '1'
  recent?: '1'
  archived?: '1'
  select?: '1'
} {
  const fields = optString(s.fields)
  const one = (v: unknown) => (v === '1' || v === 1 ? ('1' as const) : undefined)
  return {
    kind: optCsvOf(ENTRY_KIND_VALUES)(s.kind),
    typeId: optUuidCsv(s.typeId),
    fields: fields && FIELDS_RE.test(fields) ? fields : undefined,
    view: optOneOf(['table', 'cards', 'board', 'timeline'] as const)(s.view),
    authorId: s.authorId === 'me' ? ('me' as const) : optUuid(s.authorId),
    tag: optString(s.tag),
    q: optString(s.q)?.slice(0, 200),
    pinned: s.pinned === '1' || s.pinned === 1 ? ('1' as const) : undefined,
    sort: optOneOf(['-updatedAt', '-createdAt', 'title'] as const)(s.sort),
    // 左栏位置（ADR-0014）：空间 / 目录子树 / 大类（none = 未分类）/ 收藏 / 最近打开 / 已归档
    spaceId: optUuid(s.spaceId),
    under: optUuid(s.under),
    groupId: s.groupId === 'none' ? 'none' : optUuid(s.groupId),
    favorite: one(s.favorite),
    recent: one(s.recent),
    archived: one(s.archived),
    select: one(s.select),
  }
}

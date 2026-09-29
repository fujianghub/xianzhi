/** 保存视图（ADR-0033、REQ-BUG-009）：个人的记录页筛选；search 走 shared 白名单清洗（与路由 / 查询块同源）。 */
import { z } from 'zod'
import { sanitizeEntryFilter } from '../entry-search.ts'
import { isoDateTime, uuidSchema } from './common.ts'

export const MAX_ENTRY_VIEWS = 50

const viewName = z.string().trim().min(1).max(40)
/** 未知键 / 非法值丢弃；清洗后为空 → 422（没有任何筛选的视图没有意义） */
const viewSearch = z
  .record(z.string(), z.unknown())
  .transform((s) => sanitizeEntryFilter(s))
  .refine((s) => Object.keys(s).length > 0, { message: '视图至少包含一个筛选条件' })

export const createEntryViewSchema = z.object({
  name: viewName,
  /** 非空 = 在该空间记录页打开（search 里的 spaceId 会被忽略） */
  spaceId: uuidSchema.nullable().optional(),
  search: viewSearch,
})

export const patchEntryViewSchema = z
  .object({
    name: viewName.optional(),
    search: viewSearch.optional(),
    ifUpdatedAt: isoDateTime.optional(),
  })
  .refine((v) => v.name !== undefined || v.search !== undefined, {
    message: '至少一个字段',
    path: ['name'],
  })

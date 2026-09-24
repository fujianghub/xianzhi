/** 列表查询通用件（02 §4）：游标、limit、sort 白名单、逗号多值、`me` 别名、布尔 1/0。 */
import { z } from 'zod'
import { cursorSchema, limitSchema } from './common.ts'

export const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1))
    .optional()

/** 逗号多值自由文本（如 `tag=a,b`，REQ-TAG-002）：去空白、去空项，最多 20 个。 */
export const csvText = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1).max(60)).min(1).max(20))
  .optional()

/** `*Id` 参数接受 `me` 别名；调用方在 service 内替换为当前用户 id。 */
export const idOrMe = z.union([z.literal('me'), z.string().min(1).max(64)]).optional()
export const bool01 = z
  .enum(['0', '1'])
  .transform((v) => v === '1')
  .optional()

export interface SortSpec<F extends string> {
  field: F
  dir: 'asc' | 'desc'
}

/** `?sort=-updatedAt,title` → 白名单校验；白名单外 → issue（422）。 */
export const sortParam = <F extends readonly [string, ...string[]]>(
  whitelist: F,
  fallback: SortSpec<F[number]>,
) =>
  z
    .string()
    .optional()
    .transform((s, ctx): SortSpec<F[number]>[] => {
      if (!s) return [fallback]
      const out: SortSpec<F[number]>[] = []
      for (const raw of s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)) {
        const dir = raw.startsWith('-') ? 'desc' : 'asc'
        const field = raw.replace(/^-/, '')
        if (!(whitelist as readonly string[]).includes(field)) {
          ctx.addIssue({ code: 'custom', message: `sort 字段不在白名单：${field}`, path: ['sort'] })
          continue
        }
        out.push({ field: field as F[number], dir })
      }
      return out.length ? out : [fallback]
    })

export const pageParams = z.object({ cursor: cursorSchema, limit: limitSchema, withTotal: bool01 })

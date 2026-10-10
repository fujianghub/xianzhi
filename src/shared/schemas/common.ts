import { z } from 'zod'

export const uuidSchema = z.uuid()
/** 年份同 isoDate 限 1900 ~ 2999（日历快速编辑等逐段输入的半截年份，ADR-0056 §C） */
export const isoDateTime = z.iso
  .datetime({ offset: true })
  .refine((v) => v >= '1900' && v.slice(0, 4) <= '2999', {
    message: '时间超出范围（1900 ~ 2999 年）',
  })
/** 年份限 1900 ~ 2999：挡住日期框逐段输入时的半截值（如 0005-02-02，ADR-0056） */
export const isoDate = z.iso.date().refine((v) => v >= '1900-01-01' && v <= '2999-12-31', {
  message: '日期超出范围（1900 ~ 2999 年）',
})
/** 列表 limit：默认 50，最大 200，超过 → 422（02 §4） */
export const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
export const cursorSchema = z.string().min(1).optional()
export const idempotencyKeySchema = z.uuid()

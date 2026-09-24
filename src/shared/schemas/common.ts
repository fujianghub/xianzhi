import { z } from 'zod'

export const uuidSchema = z.uuid()
export const isoDateTime = z.iso.datetime({ offset: true })
export const isoDate = z.iso.date()
/** 列表 limit：默认 50，最大 200，超过 → 422（02 §4） */
export const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
export const cursorSchema = z.string().min(1).optional()
export const idempotencyKeySchema = z.uuid()

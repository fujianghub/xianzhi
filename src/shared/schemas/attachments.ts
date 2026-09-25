import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { ATTACHMENT_TARGET_TYPES } from './enums.ts'

/** multipart 字段（02 §7）：上传即带归属。 */
export const uploadAttachmentFields = z.object({
  targetType: z.enum(ATTACHMENT_TARGET_TYPES).optional(),
  targetId: z.union([uuidSchema, z.string().min(1).max(64)]).optional(), // user 头像的 targetId 是 user.id（text）
})
export const ATTACHMENT_LIMITS = {
  image: 20 * 1024 * 1024,
  pdf: 100 * 1024 * 1024,
  other: 50 * 1024 * 1024,
  quotaPerUser: 5 * 1024 * 1024 * 1024,
  maxPixels: 50e6,
} as const
export const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
  'application/json',
  // REQ-ATTACH-012（2026-09-25）：Office 文档与 csv；代码文件按 text/plain 存
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const
export const attachmentVariantQuery = z.object({ download: z.enum(['0', '1']).optional() })

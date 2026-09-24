import { z } from 'zod'

/** 可邀请的角色：owner 只能经转让（01 §5）。 */
export const invitableRoleSchema = z.enum(['admin', 'member', 'guest'])

export const createInvitationSchema = z.object({
  email: z.email().max(254),
  role: invitableRoleSchema,
})
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>

export const acceptInvitationSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(128),
})
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>

export const invitationIdParam = z.object({ id: z.string().min(1).max(64) })

export const workspacePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.settings !== undefined, {
    message: '至少一个字段',
    path: ['name'],
  })

/** 改角色：owner 只能经转让（REQ-WS-003） */
export const memberRolePatchSchema = z.object({ role: invitableRoleSchema })
export const ownerTransferSchema = z.object({ toUserId: z.string().min(1) })
export const userIdParam = z.object({ userId: z.string().min(1).max(64) })

export const auditLogQuerySchema = z.object({
  action: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  jobId: z.string().max(64).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>

export const mePatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    locale: z.enum(['zh-CN']).optional(),
    timezone: z
      .string()
      .max(64)
      .refine(
        (tz) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: tz })
            return true
          } catch {
            return false
          }
        },
        { message: '无效的 IANA 时区' },
      )
      .optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少一个字段', path: ['displayName'] })

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['read', 'write', 'admin']).default('read'),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
})
export const idParam = z.object({ id: z.string().min(1).max(64) })

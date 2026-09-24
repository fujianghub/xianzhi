import { z } from 'zod'
import { AUDIT_ACTIONS } from './enums.ts'

export const auditActionSchema = z.enum(AUDIT_ACTIONS)
export type AuditActionValue = z.infer<typeof auditActionSchema>

export const auditEntrySchema = z.object({
  workspaceId: z.string().nullable().optional(),
  actorId: z.string().nullable().optional(),
  action: auditActionSchema,
  targetType: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
})
export type AuditEntry = z.infer<typeof auditEntrySchema>

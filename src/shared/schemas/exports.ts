import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { EXPORT_FORMATS, EXPORT_SCOPES } from './enums.ts'

export const createExportSchema = z
  .object({
    scope: z.enum(EXPORT_SCOPES),
    id: uuidSchema.optional(),
    format: z.enum(EXPORT_FORMATS).default('zip'),
  })
  .refine((v) => v.scope === 'workspace' || !!v.id, {
    message: 'space / entry 范围需要 id',
    path: ['id'],
  })
export const jobStatusSchema = z.enum(['queued', 'active', 'completed', 'failed'])

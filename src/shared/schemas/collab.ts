import { z } from 'zod'
import { uuidSchema } from './common.ts'

/** POST /collab/token（02 §9）：一票一文档。 */
export const collabTokenRequestSchema = z.object({ entryId: uuidSchema })
export const collabTokenPayloadSchema = z.strictObject({
  userId: z.string().min(1),
  entryId: uuidSchema,
  jti: z.string().min(16).max(64),
  exp: z.number().int(),
})
export type CollabTokenPayload = z.infer<typeof collabTokenPayloadSchema>

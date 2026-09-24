import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { LINK_FROM_TYPES, LINK_KINDS, LINK_TO_TYPES } from './enums.ts'

export const createLinkSchema = z
  .object({
    fromType: z.enum(LINK_FROM_TYPES),
    fromId: uuidSchema,
    toType: z.enum(LINK_TO_TYPES),
    toId: uuidSchema.optional(),
    externalUrl: z.url().max(2000).optional(),
    externalTitle: z.string().trim().max(200).optional(),
    kind: z.enum(LINK_KINDS).default('relates'),
  })
  .superRefine((v, ctx) => {
    if (v.toType === 'external') {
      if (!v.externalUrl)
        ctx.addIssue({
          code: 'custom',
          message: 'external 需要 externalUrl',
          path: ['externalUrl'],
        })
      if (v.toId) ctx.addIssue({ code: 'custom', message: 'external 不带 toId', path: ['toId'] })
    } else if (!v.toId) ctx.addIssue({ code: 'custom', message: '需要 toId', path: ['toId'] })
    if (v.kind === 'mentions')
      ctx.addIssue({ code: 'custom', message: 'mentions 由编辑器维护，不可手建', path: ['kind'] })
  })
export const listLinksQuery = z.object({ fromType: z.enum(LINK_FROM_TYPES), fromId: uuidSchema })

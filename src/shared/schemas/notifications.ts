import { z } from 'zod'
import { DIGESTS, EVENT_KINDS, NOTIFICATION_CHANNELS } from './enums.ts'
import { bool01, pageParams } from './query.ts'

export const listNotificationsQuery = pageParams.extend({
  unread: bool01,
  kind: z.enum(EVENT_KINDS).optional(),
  archived: bool01,
})
export const preferenceRowSchema = z.strictObject({
  eventKind: z.enum(EVENT_KINDS),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(4),
  digest: z.enum(DIGESTS).default('instant'),
})
/** PUT 整体覆盖（02 §9）；缺行用默认表（01 §4）。 */
export const putPreferencesSchema = z.object({
  items: z.array(preferenceRowSchema).max(EVENT_KINDS.length),
})
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.strictObject({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  userAgent: z.string().max(300).optional(),
})

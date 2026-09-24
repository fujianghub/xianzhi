/**
 * 协同票据（02 §9、07 §2.3）：HMAC-SHA256，载荷 `{ userId, entryId, jti, exp }`，5 分钟，一票一文档。
 * 格式 `base64url(payload).base64url(sig)`。xz-app 签、xz-collab 验；jti 由 collab 侧内存 LRU 防重放。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { type CollabTokenPayload, collabTokenPayloadSchema } from '../../shared/schemas/collab.ts'

export const COLLAB_TOKEN_TTL_MS = 5 * 60 * 1000

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest()

export function signCollabToken(
  secret: string,
  userId: string,
  entryId: string,
  now = Date.now(),
): { token: string; expiresAt: string; payload: CollabTokenPayload } {
  const payload: CollabTokenPayload = {
    userId,
    entryId,
    jti: randomBytes(16).toString('hex'),
    exp: Math.floor((now + COLLAB_TOKEN_TTL_MS) / 1000),
  }
  const body = b64(JSON.stringify(payload))
  return {
    token: `${body}.${b64(sign(secret, body))}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    payload,
  }
}

export type VerifyFailure = 'malformed' | 'signature' | 'expired'

export function verifyCollabToken(
  secret: string,
  token: string,
  now = Date.now(),
): { ok: true; payload: CollabTokenPayload } | { ok: false; reason: VerifyFailure } {
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return { ok: false, reason: 'malformed' }
  const expected = sign(secret, body)
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: 'signature' }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const r = collabTokenPayloadSchema.safeParse(parsed)
  if (!r.success) return { ok: false, reason: 'malformed' }
  if (r.data.exp * 1000 <= now) return { ok: false, reason: 'expired' }
  return { ok: true, payload: r.data }
}

/** jti 一次性（5 分钟窗口，过期即可淘汰）。 */
export class JtiCache {
  private seen = new Map<string, number>()
  /** 首次使用返回 true；重放返回 false。 */
  use(jti: string, expSec: number, now = Date.now()): boolean {
    if (this.seen.size > 10_000)
      for (const [k, e] of this.seen) if (e * 1000 <= now) this.seen.delete(k)
    const prev = this.seen.get(jti)
    if (prev !== undefined && prev * 1000 > now) return false
    this.seen.set(jti, expSec)
    return true
  }
}

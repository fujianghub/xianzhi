/** GET /api/v1/stream（02 §6、REQ-NOTIF-002 · 003）：SSE；帧来源为 EventBus `notify`。 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { AppError } from '../lib/errors.ts'
import type { SseHub } from '../lib/sse-hub.ts'
import { requireAuth } from '../middleware/session.ts'
import type { AppEnv } from '../types.ts'

export function streamRoutes(deps: { hub: SseHub }) {
  return new Hono<AppEnv>().get('/', requireAuth, (c) => {
    const user = c.var.user
    if (!user) throw AppError.unauthenticated()
    const lastRaw = c.req.header('last-event-id') ?? c.req.query('lastEventId')
    const lastEventId = lastRaw !== undefined && lastRaw !== '' ? Number(lastRaw) : undefined
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async (stream) => {
      let closed = false
      const queue: Promise<void>[] = []
      const done = new Promise<void>((resolve) => {
        const off = deps.hub.connect(
          user.id,
          {
            send: (f) => {
              if (closed) return
              if (f.comment !== undefined)
                queue.push(stream.write(`: ${f.comment}\n\n`).then(() => undefined))
              else
                queue.push(
                  stream.writeSSE({
                    id: f.id !== undefined ? String(f.id) : undefined,
                    event: f.event,
                    data: JSON.stringify(f.data ?? null),
                  }),
                )
            },
            close: () => {
              closed = true
              off()
              resolve()
            },
          },
          { lastEventId, spaceId: c.req.query('spaceId') },
        )
        stream.onAbort(() => {
          closed = true
          off()
          resolve()
        })
      })
      await stream.write(': connected\n\n')
      await done
      await Promise.allSettled(queue)
      await stream.close()
    })
  })
}

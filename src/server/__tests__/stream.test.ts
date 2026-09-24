/** T0-025：SSE /stream（REQ-NOTIF-002 · 003）与通知接口本人隔离（REQ-NOTIF-015 部分）。 */
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { events, notifications } from '../db/schema/business.ts'
import { EventBus } from '../lib/event-bus.ts'
import { SSE_LIMITS, SseHub } from '../lib/sse-hub.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

interface Frame {
  id?: string
  event?: string
  data?: string
  comment?: string
}

/** 读 SSE 流并解析帧；返回 frames 数组（持续追加）与 abort / ended。 */
function reader(res: Response, ac: AbortController) {
  const frames: Frame[] = []
  const state = { ended: false }
  const r = res.body?.getReader()
  const dec = new TextDecoder()
  let buf = ''
  ;(async () => {
    try {
      while (r) {
        const { done, value } = await r.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i = buf.indexOf('\n\n')
        while (i >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const f: Frame = {}
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) f.comment = line.slice(1).trim()
            else {
              const [k, ...rest] = line.split(':')
              const v = rest.join(':').replace(/^ /, '')
              if (k === 'id' || k === 'event' || k === 'data') f[k] = v
            }
          }
          frames.push(f)
          i = buf.indexOf('\n\n')
        }
      }
    } catch {
      /* aborted */
    }
    state.ended = true
  })()
  return {
    frames,
    state,
    abort: () => {
      ac.abort()
      r?.cancel().catch(() => undefined)
    },
  }
}

const until = async (fn: () => boolean, ms = 2000) => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('until timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
  return Date.now() - t
}

describe('SSE /stream', () => {
  const bus = new EventBus()
  const hub = new SseHub()
  let app: ReturnType<typeof buildApp>['app']
  let cookie = ''
  let userId = ''

  beforeAll(async () => {
    await truncateAll()
    userId = (await seedOwner()).userId
    app = buildApp({ bus, sseHub: hub }).app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  const open = async (headers: Record<string, string> = {}) => {
    const ac = new AbortController()
    const res = await app.request('/api/v1/stream', {
      headers: { cookie, ...headers },
      signal: ac.signal,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const rd = reader(res, ac)
    await until(() => rd.frames.some((f) => f.comment === 'connected'))
    return rd
  }
  const notify = (title: string) =>
    bus.publish('notify', { userId, frame: { type: 'notification', data: { title } } })

  it('REQ-NOTIF-002 事件经 bus 后 ≤ 2s 以 notification 帧到达，帧带递增 id；未登录 401', async () => {
    expect((await app.request('/api/v1/stream')).status).toBe(401)
    const s = await open()
    notify('a')
    const ms = await until(() => s.frames.some((f) => f.event === 'notification'))
    expect(ms).toBeLessThan(2000)
    const f = s.frames.find((x) => x.event === 'notification')
    expect(f?.id).toBe('1')
    expect(JSON.parse(f?.data ?? '{}')).toEqual({ title: 'a' })
    s.abort()
    await until(() => hub.connections(userId) === 0)
  })

  it('REQ-NOTIF-003 第 4 条连接建立时关闭最旧的', async () => {
    const conns = [await open(), await open(), await open()]
    expect(hub.connections(userId)).toBe(3)
    const fourth = await open()
    await until(() => conns[0]?.state.ended === true)
    expect(conns[0]?.frames.some((f) => f.event === 'evicted')).toBe(true) // 先告知被挤掉，前端据此不自动重连
    expect(hub.connections(userId)).toBe(SSE_LIMITS.maxConnections)
    expect(conns[1]?.state.ended).toBe(false)
    for (const c of [...conns, fourth]) c.abort()
    await until(() => hub.connections(userId) === 0)
  })

  it('REQ-NOTIF-003 断线期间的帧在重连带 Last-Event-ID 时补发，id 连续', async () => {
    const s = await open()
    notify('b1')
    await until(() => s.frames.filter((f) => f.event === 'notification').length === 1)
    const lastId = Number(s.frames.filter((f) => f.event === 'notification').at(-1)?.id)
    s.abort()
    await until(() => hub.connections(userId) === 0)
    notify('b2')
    bus.publish('notify', {
      userId,
      frame: { type: 'invalidate', data: { keys: [['tasks', {}]] } },
    })
    const again = await open({ 'last-event-id': String(lastId) })
    await until(() => again.frames.filter((f) => f.id).length === 2)
    const ids = again.frames.filter((f) => f.id).map((f) => Number(f.id))
    expect(ids).toEqual([lastId + 1, lastId + 2])
    expect(again.frames.filter((f) => f.id).map((f) => f.event)).toEqual([
      'notification',
      'invalidate',
    ])
    again.abort()
    await until(() => hub.connections(userId) === 0)
  })

  it('REQ-WS-004 user.revoked 关闭该用户的 SSE 连接', async () => {
    const s = await open()
    bus.publish('user.revoked', { userId })
    await until(() => s.state.ended)
    expect(hub.connections(userId)).toBe(0)
  })

  it('SseHub：超出 5 分钟缓冲 → reset 帧；心跳为不带 id 的注释行', () => {
    let t = 0
    const h = new SseHub(() => t)
    const got: { id?: number; event?: string; comment?: string }[] = []
    h.push('u', 'notification', 1)
    t = SSE_LIMITS.bufferMs + 10
    h.push('u', 'notification', 2)
    h.push('u', 'notification', 3)
    h.connect('u', { send: (f) => got.push(f), close: () => undefined }, { lastEventId: 0 })
    expect(got.map((f) => f.event)).toEqual(['reset'])
    got.length = 0
    h.heartbeat()
    expect(got).toEqual([{ comment: 'ping' }])
    got.length = 0
    h.connect('u', { send: (f) => got.push(f), close: () => undefined }, { lastEventId: 2 })
    expect(got.map((f) => f.id)).toEqual([3])
  })

  it('REQ-NOTIF-003 首连发 hello 帧（id = 当前 seq）作补发基线；lastEventId > seq（进程重启）→ reset', () => {
    const h = new SseHub()
    const got: { id?: number; event?: string }[] = []
    const sink = {
      send: (f: { id?: number; event?: string }) => got.push(f),
      close: () => undefined,
    }
    h.push('u', 'notification', 1)
    h.push('u', 'notification', 2)
    h.connect('u', sink)
    expect(got).toEqual([{ id: 2, event: 'hello', data: null }])
    got.length = 0
    h.connect('u', sink, { lastEventId: 2 })
    expect(got).toEqual([])
    h.connect('u', sink, { lastEventId: 99 })
    expect(got.map((f) => f.event)).toEqual(['reset'])
  })
})

describe('/notifications', () => {
  it('REQ-NOTIF-005 列表含 unreadCount；read / read-all；REQ-NOTIF-015 他人的通知 404 且不在列表', async () => {
    await truncateAll()
    const { userId, workspaceId } = await seedOwner()
    const app = buildApp().app
    const cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const db = getDb()
    const ev = v7()
    await db
      .insert(events)
      .values({ id: ev, workspaceId, kind: 'member.joined', targetType: 'member', payload: {} })
    const [mine] = await db
      .insert(notifications)
      .values({ userId, eventId: ev, kind: 'member.joined', title: 'x 已加入', url: '/' })
      .returning()
    const inv = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ email: 'o@xz.local', role: 'member' }),
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'o@xz.local', name: 'O', password: 'other-password-1' }),
    })
    const otherId = ((await acc.json()) as { userId: string }).userId
    const [theirs] = await db
      .insert(notifications)
      .values({ userId: otherId, eventId: ev, kind: 'member.joined', title: '他人的', url: '/' })
      .returning()
    const list = (await (
      await app.request('/api/v1/notifications?unread=1', { headers: { cookie } })
    ).json()) as { items: { id: string }[]; unreadCount: number }
    expect(list.items.map((i) => i.id)).toEqual([mine?.id])
    expect(list.unreadCount).toBe(1)
    expect(
      (
        await app.request(`/api/v1/notifications/${theirs?.id}/read`, {
          method: 'POST',
          headers: jsonHeaders({ cookie }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await app.request(`/api/v1/notifications/${mine?.id}/read`, {
          method: 'POST',
          headers: jsonHeaders({ cookie }),
        })
      ).status,
    ).toBe(204)
    const after = (await (
      await app.request('/api/v1/notifications', { headers: { cookie } })
    ).json()) as { unreadCount: number; items: { readAt: string | null }[] }
    expect(after.unreadCount).toBe(0)
    expect(after.items[0]?.readAt).not.toBeNull()
    expect(
      (
        (await (
          await app.request('/api/v1/notifications/read-all', {
            method: 'POST',
            headers: jsonHeaders({ cookie }),
          })
        ).json()) as { updated: number }
      ).updated,
    ).toBe(0)
  })
})

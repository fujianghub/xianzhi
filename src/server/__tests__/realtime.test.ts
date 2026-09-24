/** REQ-NOTIF-004 数据变更实时失效（服务层）：只推给可读空间的在线用户；批量内抑制、提交后统一发布。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { getEventBus } from '../lib/event-bus.ts'
import { publishChange, spaceReaders } from '../services/realtime.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']

describe('REQ-NOTIF-004 realtime invalidate', () => {
  let app: App
  let owner = { id: '', cookie: '' }
  let memberId = ''
  let membersOnly = ''
  let open = ''
  const req = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    const inv = await req(owner.cookie, 'POST', '/workspace/invitations', {
      email: 'rt@xz.local',
      role: 'member',
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'rt@xz.local', name: 'rt', password: 'realtime-pass-1' }),
    })
    memberId = ((await acc.json()) as { userId: string }).userId
    const a = await req(owner.cookie, 'POST', '/spaces', {
      name: 'A',
      slug: 'rt-members',
      kind: 'work',
      visibility: 'members',
    })
    membersOnly = ((await a.json()) as { id: string }).id
    const b = await req(owner.cookie, 'POST', '/spaces', {
      name: 'B',
      slug: 'rt-open',
      kind: 'work',
    })
    open = ((await b.json()) as { id: string }).id
    expect(membersOnly && open && memberId).toBeTruthy()
  })

  it('REQ-NOTIF-004 spaceReaders：members 空间只含成员与 owner；workspace 空间含全员；未知用户忽略', async () => {
    const db = getDb()
    expect(await spaceReaders(db, [membersOnly], [owner.id, memberId])).toEqual([owner.id])
    expect((await spaceReaders(db, [open], [owner.id, memberId, 'nobody'])).sort()).toEqual(
      [owner.id, memberId].sort(),
    )
    expect(await spaceReaders(db, [], [owner.id])).toEqual([])
  })

  it('REQ-NOTIF-004 任务写提交后发布 data.changed；批量只在提交后发一次', async () => {
    const seen: { spaceIds: string[]; keys: unknown[][] }[] = []
    const off = getEventBus().subscribe('data.changed', (p) => seen.push(p))
    const t = await req(owner.cookie, 'POST', '/tasks', { title: '实时', spaceId: open })
    const task = (await t.json()) as { id: string; updatedAt: string }
    expect(seen.at(-1)).toEqual({ spaceIds: [open], keys: [['tasks']] })
    await req(owner.cookie, 'PATCH', `/tasks/${task.id}`, {
      title: '实时 2',
      ifUpdatedAt: task.updatedAt,
    })
    expect(seen.at(-1)?.keys).toEqual([['tasks'], ['task', task.id]])
    const before = seen.length
    const cur = (await (await req(owner.cookie, 'GET', `/tasks/${task.id}`)).json()) as {
      updatedAt: string
    }
    await req(owner.cookie, 'POST', '/tasks/batch', {
      ops: [{ op: 'update', id: task.id, patch: { title: '批量', ifUpdatedAt: cur.updatedAt } }],
    })
    expect(seen.length).toBe(before + 1)
    publishChange({ silentRealtime: true }, [open], [['tasks']])
    expect(seen.length).toBe(before + 1)
    off()
  })
})

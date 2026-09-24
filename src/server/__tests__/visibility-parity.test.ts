/** REQ-WS-011 列表可见集合 = 逐个 can(read) 为真的集合（visible*Where 与 can() 共享规则表，01 §5 不变量 2 · 3）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { entries, spaces, tasks } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}

describe('REQ-WS-011 visibility parity', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'guest', U> = {} as never
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  async function invite(email: string, role: 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'parity-pass-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'parity-pass-1')).cookie }
  }
  const create = async (who: U, path: string, body: unknown) => {
    const r = await req(who, 'POST', path, body)
    expect(r.status, await r.clone().text()).toBe(201)
    return ((await r.json()) as { id: string }).id
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('pm@xz.local', 'member')
    u.guest = await invite('pg@xz.local', 'guest')
    // 空间：全员可见 A、成员可见 B（无人加入）、成员可见 C（guest 为 viewer）、member 自建 D（全员可见）
    const A = await create(u.owner, '/spaces', { name: 'A', slug: 'par-a', kind: 'work' })
    const B = await create(u.owner, '/spaces', {
      name: 'B',
      slug: 'par-b',
      kind: 'work',
      visibility: 'members',
    })
    const C = await create(u.owner, '/spaces', {
      name: 'C',
      slug: 'par-c',
      kind: 'work',
      visibility: 'members',
    })
    const D = await create(u.member, '/spaces', { name: 'D', slug: 'par-d', kind: 'work' })
    expect(
      (await req(u.owner, 'POST', `/spaces/${C}/members`, { userId: u.guest.id, role: 'viewer' }))
        .status,
    ).toBe(201)
    for (const s of [A, B, C]) await create(u.owner, '/tasks', { title: `任务 ${s}`, spaceId: s })
    await create(u.member, '/tasks', { title: '成员任务', spaceId: D })
    await create(u.owner, '/entries', {
      kind: 'note',
      title: '全员',
      spaceId: A,
      visibility: 'workspace',
    })
    await create(u.owner, '/entries', {
      kind: 'note',
      title: '空间',
      spaceId: A,
      visibility: 'space',
    })
    await create(u.owner, '/entries', {
      kind: 'note',
      title: '仅自己',
      spaceId: A,
      visibility: 'private',
    })
    await create(u.owner, '/entries', {
      kind: 'note',
      title: 'B 空间',
      spaceId: B,
      visibility: 'space',
    })
    await create(u.owner, '/entries', {
      kind: 'note',
      title: 'C 空间',
      spaceId: C,
      visibility: 'space',
    })
    await create(u.member, '/entries', {
      kind: 'note',
      title: '成员私有',
      spaceId: D,
      visibility: 'private',
    })
    await create(u.member, '/entries', { kind: 'note', title: '成员个人随笔' }) // 个人空间 private
  })

  const listed = async (who: U, path: string) => {
    const r = await req(who, 'GET', `${path}${path.includes('?') ? '&' : '?'}limit=200`)
    expect(r.status).toBe(200)
    return new Set(((await r.json()) as { items: { id: string }[] }).items.map((x) => x.id))
  }
  const readable = async (who: U, base: string, ids: string[]) => {
    const out = new Set<string>()
    for (const id of ids) if ((await req(who, 'GET', `${base}/${id}`)).status === 200) out.add(id)
    return out
  }

  for (const role of ['owner', 'member', 'guest'] as const)
    it(`REQ-WS-011 ${role}：列表集合与逐个 GET 可读集合相等（空间 / 任务 / 记录）`, async () => {
      const who = u[role]
      const db = getDb()
      // 02 §9 注：GET /spaces 刻意不列他人的个人空间（按 id 仍可读）——比较前从「可读集合」剔除，其余严格相等
      const allSpaces = (
        await db
          .select({ id: spaces.id, personal: spaces.isPersonal, by: spaces.createdBy })
          .from(spaces)
      )
        .filter((x) => !(x.personal && x.by !== who.id))
        .map((x) => x.id)
      const allTasks = (await db.select({ id: tasks.id }).from(tasks)).map((x) => x.id)
      const allEntries = (await db.select({ id: entries.id }).from(entries)).map((x) => x.id)
      expect([...(await listed(who, '/spaces'))].sort()).toEqual(
        [...(await readable(who, '/spaces', allSpaces))].sort(),
      )
      expect([...(await listed(who, '/tasks'))].sort()).toEqual(
        [...(await readable(who, '/tasks', allTasks))].sort(),
      )
      expect([...(await listed(who, '/entries'))].sort()).toEqual(
        [...(await readable(who, '/entries', allEntries))].sort(),
      )
    })
})

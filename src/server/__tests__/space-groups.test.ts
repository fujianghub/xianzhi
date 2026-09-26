/** ADR-0012 大类：REQ-KB-001（预置 / 管理员增删改排）· REQ-KB-002（空间归类、拖到其他大类、改类型）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { organization } from '../db/schema/auth.ts'
import { ensureDefaultGroups } from '../services/space-groups.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface Group {
  id: string
  name: string
  sortKey: string
}
interface Space {
  id: string
  groupId: string | null
  kind: string
  updatedAt: string
  isPersonal: boolean
}

async function join(app: App, ownerCookie: string, email: string, role: 'member' | 'guest') {
  const inv = await app.request('/api/v1/workspace/invitations', {
    method: 'POST',
    headers: jsonHeaders({ cookie: ownerCookie }),
    body: JSON.stringify({ email, role }),
  })
  const { id } = (await inv.json()) as { id: string }
  await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, name: email.split('@')[0], password: 'member-password-123' }),
  })
  return (await signIn(app, email, 'member-password-123')).cookie
}

describe('space groups', () => {
  let app: App
  let owner = ''
  let member = ''
  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: jsonHeaders({ cookie }) })
  const groups = async (cookie = owner) =>
    ((await (await req(cookie, '/api/v1/space-groups')).json()) as { items: Group[] }).items

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    member = await join(app, owner, 'kb-member@xz.local', 'member')
  })

  it('REQ-KB-001 新工作区预置「产品开发 / 技术学习规划 / 生活」且有序；ensureDefaultGroups 幂等', async () => {
    expect((await groups()).map((g) => g.name)).toEqual(['产品开发', '技术学习规划', '生活'])
    const [ws] = await getDb().select().from(organization)
    await ensureDefaultGroups(getDb(), ws?.id ?? '')
    expect(await groups()).toHaveLength(3)
    // member 可读
    expect(await groups(member)).toHaveLength(3)
  })

  it('REQ-KB-001 管理员增 / 改 / 排 / 删；同名 409；member 403', async () => {
    const created = await req(owner, '/api/v1/space-groups', {
      method: 'POST',
      body: JSON.stringify({ name: '工作', color: 'orange', icon: 'briefcase' }),
    })
    expect(created.status).toBe(201)
    const work = (await created.json()) as Group
    expect((await groups()).at(-1)?.name).toBe('工作')
    const dup = await req(owner, '/api/v1/space-groups', {
      method: 'POST',
      body: JSON.stringify({ name: '工作' }),
    })
    expect(dup.status).toBe(409)
    expect(
      (
        await req(member, '/api/v1/space-groups', {
          method: 'POST',
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403)
    // 移到最前
    await req(owner, '/api/v1/space-groups/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ id: work.id, after: null }),
    })
    expect((await groups())[0]?.name).toBe('工作')
    const renamed = await req(owner, `/api/v1/space-groups/${work.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '工作事务' }),
    })
    expect(((await renamed.json()) as Group).name).toBe('工作事务')
    expect((await req(owner, `/api/v1/space-groups/${work.id}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await groups()).map((g) => g.name)).not.toContain('工作事务')
  })

  it('REQ-KB-002 建空间带 groupId；改类型；拖到另一大类；删大类后变未分类；个人空间不入大类', async () => {
    const [prod, learn] = await groups()
    const r = await req(member, '/api/v1/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: '简斋', slug: 'jianzhai', kind: 'project', groupId: prod?.id }),
    })
    expect(r.status).toBe(201)
    let s = (await r.json()) as Space
    expect(s.groupId).toBe(prod?.id)
    // 改类型 + 换大类（space admin 即可，不需要 group.manage）
    const p = await req(member, `/api/v1/spaces/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'learning', groupId: learn?.id, ifUpdatedAt: s.updatedAt }),
    })
    expect(p.status).toBe(200)
    s = (await p.json()) as Space
    expect(s.kind).toBe('learning')
    expect(s.groupId).toBe(learn?.id)
    // 拖到「产品开发」
    const moved = await req(member, '/api/v1/spaces/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ id: s.id, after: null, groupId: prod?.id }),
    })
    expect(((await moved.json()) as Space).groupId).toBe(prod?.id)
    // 不存在的大类 422
    const bad = await req(member, '/api/v1/spaces/reorder', {
      method: 'PATCH',
      body: JSON.stringify({
        id: s.id,
        after: null,
        groupId: '01920000-0000-7000-8000-00000000dead',
      }),
    })
    expect(bad.status).toBe(422)
    // 删大类 → 未分类
    await req(owner, `/api/v1/space-groups/${prod?.id}`, { method: 'DELETE' })
    const after = (await (await req(member, `/api/v1/spaces/${s.id}`)).json()) as Space
    expect(after.groupId).toBeNull()
    // 个人空间不入大类
    const list = (await (await req(member, '/api/v1/spaces')).json()) as { items: Space[] }
    const personal = list.items.find((x) => x.isPersonal)
    if (!personal) throw new Error('no personal space')
    const denied = await req(member, `/api/v1/spaces/${personal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ groupId: learn?.id, ifUpdatedAt: personal.updatedAt }),
    })
    expect(denied.status).toBe(403)
  })
})

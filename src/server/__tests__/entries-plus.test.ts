/** ADR-0014：标签自定义（REQ-TAG-004 · 005 · 006）、记录列表目录 / 大类 / 收藏 / 最近（REQ-ENTRY-012）、批量（REQ-ENTRY-013）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface Tag {
  id: string
  name: string
  canManage: boolean
  usage: { entries: number }
}
interface Item {
  id: string
  title: string
  path: { title: string }[]
  favorited: boolean
  tagIds: string[]
  archivedAt: string | null
  spaceId: string
}

async function join(app: App, ownerCookie: string, email: string) {
  const inv = await app.request('/api/v1/workspace/invitations', {
    method: 'POST',
    headers: jsonHeaders({ cookie: ownerCookie }),
    body: JSON.stringify({ email, role: 'member' }),
  })
  const { id } = (await inv.json()) as { id: string }
  await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, name: 'm', password: 'member-password-123' }),
  })
  return (await signIn(app, email, 'member-password-123')).cookie
}

describe('entries plus', () => {
  let app: App
  let owner = ''
  let member = ''
  let spaceA = ''
  let spaceB = ''
  let groupProd = ''
  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: jsonHeaders({ cookie }) })
  const create = async (cookie: string, body: Record<string, unknown>) => {
    const r = await req(cookie, '/api/v1/entries', { method: 'POST', body: JSON.stringify(body) })
    expect(r.status, await r.clone().text()).toBe(201)
    return ((await r.json()) as { id: string }).id
  }
  const list = async (cookie: string, qs: string) =>
    ((await (await req(cookie, `/api/v1/entries?${qs}`)).json()) as { items: Item[] }).items

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    member = await join(app, owner, 'plus-member@xz.local')
    const groups = (
      (await (await req(owner, '/api/v1/space-groups')).json()) as {
        items: { id: string; name: string }[]
      }
    ).items
    groupProd = groups.find((g) => g.name === '产品开发')?.id ?? ''
    const mk = async (slug: string, groupId: string | null) => {
      const r = await req(owner, '/api/v1/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: slug, slug, kind: 'project', groupId }),
      })
      return ((await r.json()) as { id: string }).id
    }
    spaceA = await mk('plus-a', groupProd)
    spaceB = await mk('plus-b', null)
  })

  it('REQ-TAG-004 REQ-TAG-007 标签按人隔离：同一篇记录上各打各的，互相看不到；改自己的标签不动别人的；不能打别人的标签（ADR-0017）', async () => {
    const mkTag = async (cookie: string, name: string) => {
      const r = await req(cookie, '/api/v1/tags', {
        method: 'POST',
        body: JSON.stringify({ name, color: 'blue' }),
      })
      expect(r.status).toBe(201)
      return (await r.json()) as Tag
    }
    const fe = await mkTag(owner, '前端')
    await mkTag(owner, '后端')
    const mine = await mkTag(member, '我的待读')
    expect(mine.canManage).toBe(true)
    // 成员不能打所有者的标签
    const denied = await req(member, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({ kind: 'note', title: 'x', spaceId: spaceA, tagIds: [fe.id] }),
    })
    expect(denied.status).toBe(422)
    // 成员建一篇并打自己的标签；所有者（可写）给同一篇打自己的标签
    const id = await create(member, {
      kind: 'note',
      title: '共享的一篇',
      spaceId: spaceA,
      tagIds: [mine.id],
    })
    const detail = async (cookie: string) =>
      (await (await req(cookie, `/api/v1/entries/${id}`)).json()) as {
        tagIds: string[]
        updatedAt: string
      }
    const p = await req(owner, `/api/v1/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tagIds: [fe.id], ifUpdatedAt: (await detail(owner)).updatedAt }),
    })
    expect(p.status).toBe(200)
    expect((await detail(owner)).tagIds).toEqual([fe.id])
    expect((await detail(member)).tagIds).toEqual([mine.id]) // 没被所有者的修改冲掉
    // 列表与筛选同样只看自己的
    expect((await list(member, `spaceId=${spaceA}&tag=前端`)).map((i) => i.id)).not.toContain(id)
    expect((await list(owner, `spaceId=${spaceA}&tag=前端`)).map((i) => i.id)).toContain(id)
    expect((await list(owner, `spaceId=${spaceA}`)).find((i) => i.id === id)?.tagIds).toEqual([
      fe.id,
    ])
    // 改名 / 改色只能动自己的
    expect(
      (
        await req(member, `/api/v1/tags/${fe.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await req(owner, `/api/v1/tags/${fe.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: '前端开发' }),
        })
      ).status,
    ).toBe(200)
  })

  it('REQ-TAG-005 合并标签：关联并入目标且不重复，源标签删除', async () => {
    const tagsNow = ((await (await req(owner, '/api/v1/tags')).json()) as { items: Tag[] }).items
    const fe = tagsNow.find((t) => t.name === '前端开发')?.id ?? ''
    const be = tagsNow.find((t) => t.name === '后端')?.id ?? ''
    const e1 = await create(owner, {
      kind: 'note',
      title: '两个标签',
      spaceId: spaceA,
      tagIds: [fe, be],
    })
    await create(owner, { kind: 'note', title: '只有前端', spaceId: spaceA, tagIds: [fe] })
    const m = await req(owner, `/api/v1/tags/${fe}/merge`, {
      method: 'POST',
      body: JSON.stringify({ intoId: be }),
    })
    expect(m.status).toBe(200)
    // 本例两篇 + 上一例共享记录上的「前端」→ 合并后「后端」挂 3 篇
    expect(((await m.json()) as Tag).usage.entries).toBe(3)
    const after = ((await (await req(owner, '/api/v1/tags')).json()) as { items: Tag[] }).items
    expect(after.map((t) => t.name)).not.toContain('前端开发')
    const d = (await (await req(owner, `/api/v1/entries/${e1}`)).json()) as { tagIds: string[] }
    expect(d.tagIds).toEqual([be])
  })

  it('REQ-TAG-006 搜索 tag 多值：任一命中', async () => {
    const mk = async (name: string) =>
      (
        (await (
          await req(owner, '/api/v1/tags', {
            method: 'POST',
            body: JSON.stringify({ name, color: 'red' }),
          })
        ).json()) as Tag
      ).id
    const x = await mk('搜甲')
    const y = await mk('搜乙')
    await create(owner, { kind: 'note', title: '检索目标一', spaceId: spaceA, tagIds: [x] })
    await create(owner, { kind: 'note', title: '检索目标二', spaceId: spaceA, tagIds: [y] })
    await create(owner, { kind: 'note', title: '检索目标三', spaceId: spaceA })
    const r = await req(
      owner,
      `/api/v1/search?types=entry&q=${encodeURIComponent('检索目标')}&tag=${encodeURIComponent('搜甲,搜乙')}`,
    )
    expect(r.status).toBe(200)
    const body = (await r.json()) as { groups: { entries: { items: { title: string }[] } } }
    expect(body.groups.entries.items.map((i) => i.title).sort()).toEqual(
      ['检索目标一', '检索目标二'].sort(),
    )
  })

  it('REQ-ENTRY-012 列表：目录子树 under、大类 groupId、每项 path；收藏与按 id 取', async () => {
    const root = await create(owner, {
      kind: 'note',
      title: '设计',
      spaceId: spaceA,
      parentId: null,
    })
    const child = await create(owner, {
      kind: 'note',
      title: '登录页',
      spaceId: spaceA,
      parentId: root,
    })
    await create(owner, { kind: 'note', title: '无关', spaceId: spaceB })
    const sub = await list(owner, `under=${root}`)
    expect(sub.map((i) => i.title).sort()).toEqual(['登录页', '设计'].sort())
    expect(sub.find((i) => i.id === child)?.path.map((p) => p.title)).toEqual(['设计'])
    const prod = await list(owner, `groupId=${groupProd}`)
    expect(prod.every((i) => i.spaceId === spaceA)).toBe(true)
    const none = await list(owner, 'groupId=none')
    expect(none.map((i) => i.title)).toContain('无关')
    expect((await req(owner, `/api/v1/entries/${child}/favorite`, { method: 'PUT' })).status).toBe(
      200,
    )
    const favs = await list(owner, 'favorite=1')
    expect(favs.map((i) => i.id)).toEqual([child])
    expect(favs[0]?.favorited).toBe(true)
    const byIds = await list(owner, `ids=${child},${root}`)
    expect(byIds.map((i) => i.id).sort()).toEqual([child, root].sort())
    // 收藏是个人的
    expect(await list(member, 'favorite=1')).toEqual([])
  })

  it('REQ-ENTRY-013 批量：移动空间 / 加标签 / 归档 / 删除；无权条目进 failed 不影响其它', async () => {
    const a = await create(owner, { kind: 'note', title: '批量甲', spaceId: spaceA })
    const b = await create(owner, { kind: 'note', title: '批量乙', spaceId: spaceA })
    const privateOfOwner = await create(owner, { kind: 'note', title: '私人' }) // 个人空间
    const tag =
      ((await (await req(owner, '/api/v1/tags')).json()) as { items: Tag[] }).items[0]?.id ?? ''
    const batch = (body: unknown, cookie = owner) =>
      Promise.resolve(
        req(cookie, '/api/v1/entries/batch', { method: 'POST', body: JSON.stringify(body) }),
      ).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as { ok: string[]; failed: { id: string }[] },
      }))
    let r = await batch({ op: 'move', ids: [a, b], spaceId: spaceB })
    expect(r.body.ok.sort()).toEqual([a, b].sort())
    r = await batch({ op: 'tags', ids: [a, b], add: [tag] })
    expect(r.body.ok).toHaveLength(2)
    expect((await list(owner, `spaceId=${spaceB}&tag=后端`)).map((i) => i.id).sort()).toEqual(
      [a, b].sort(),
    )
    r = await batch({ op: 'archive', ids: [a] })
    expect((await list(owner, `spaceId=${spaceB}&archived=1`)).map((i) => i.id)).toEqual([a])
    // member 删不了 owner 的私人随笔（不可见 → failed），能删自己可写的
    const m1 = await create(member, { kind: 'note', title: '成员的', spaceId: spaceB })
    r = await batch({ op: 'delete', ids: [m1, privateOfOwner] }, member)
    expect(r.body.ok).toEqual([m1])
    expect(r.body.failed.map((f: { id: string }) => f.id)).toEqual([privateOfOwner])
  })
})

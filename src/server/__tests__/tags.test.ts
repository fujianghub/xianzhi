/** T1-021 标签（REQ-TAG-001 · 002，api 层）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface Tag {
  id: string
  name: string
  color: string
  usage: { tasks: number; entries: number }
}

describe('T1-021 tags', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'guest', U> = {} as never
  let spaceId = ''
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
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'tag-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'tag-password-1')).cookie }
  }
  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('tagm@xz.local', 'member')
    u.guest = await invite('tagg@xz.local', 'guest')
    const s = await req(u.owner, 'POST', '/spaces', { name: 'T', slug: 'tags-s', kind: 'work' })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-TAG-001 创建 201；重名 409 CONFLICT_UNIQUE；非 token 色 422；guest 不能建；改名 / 删除仅 owner/admin', async () => {
    const r = await req(u.member, 'POST', '/tags', { name: '前端', color: 'cyan' })
    expect(r.status).toBe(201)
    const tag = (await r.json()) as Tag
    const dup = await req(u.owner, 'POST', '/tags', { name: '前端', color: 'green' })
    expect(dup.status).toBe(409)
    expect((await problemOf(dup)).code).toBe('CONFLICT_UNIQUE')
    const bad = await req(u.member, 'POST', '/tags', { name: '颜色', color: '#abc' })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe('color')
    expect((await req(u.guest, 'POST', '/tags', { name: 'g', color: 'green' })).status).toBe(403)
    expect((await req(u.member, 'PATCH', `/tags/${tag.id}`, { name: 'x' })).status).toBe(403)
    const ren = await req(u.owner, 'PATCH', `/tags/${tag.id}`, {
      name: '前端开发',
      color: 'purple',
    })
    expect(ren.status).toBe(200)
    expect((await ren.json()) as Tag).toMatchObject({ name: '前端开发', color: 'purple' })
    await req(u.owner, 'POST', '/tags', { name: '后端', color: 'green' })
    const clash = await req(u.owner, 'PATCH', `/tags/${tag.id}`, { name: '后端' })
    expect(clash.status).toBe(409)
    expect((await req(u.member, 'DELETE', `/tags/${tag.id}`)).status).toBe(403)
    expect((await req(u.owner, 'DELETE', `/tags/${tag.id}`)).status).toBe(204)
    const list = (await (await req(u.guest, 'GET', '/tags')).json()) as { items: Tag[] }
    expect(list.items.map((t) => t.name)).toEqual(['后端'])
  })

  it('REQ-TAG-002 ?tag=a,b 只含带 a 或 b 的任务 / 记录；删除标签解除关联', async () => {
    const mk = async (name: string) =>
      ((await (await req(u.owner, 'POST', '/tags', { name, color: 'orange' })).json()) as Tag).id
    const a = await mk('甲')
    const b = await mk('乙')
    const c = await mk('丙')
    const task = async (title: string, tagIds: string[]) =>
      (
        (await (await req(u.owner, 'POST', '/tasks', { title, spaceId, tagIds })).json()) as {
          id: string
        }
      ).id
    const ta = await task('带甲', [a])
    const tb = await task('带乙', [b])
    const tc = await task('带丙', [c])
    const tab = await task('甲乙', [a, b])
    const ids = async (qs: string) =>
      (
        (await (await req(u.owner, 'GET', `/tasks?spaceId=${spaceId}&${qs}`)).json()) as {
          items: { id: string }[]
        }
      ).items
        .map((x) => x.id)
        .sort()
    expect(await ids(`tag=${encodeURIComponent('甲,乙')}`)).toEqual([ta, tb, tab].sort())
    expect(await ids(`tag=${encodeURIComponent('丙')}`)).toEqual([tc])
    const e = await req(u.owner, 'POST', '/entries', {
      kind: 'note',
      title: '记录带乙',
      spaceId,
      tagIds: [b],
    })
    const eid = ((await e.json()) as { id: string }).id
    const entryIds = (
      (await (
        await req(u.owner, 'GET', `/entries?spaceId=${spaceId}&tag=${encodeURIComponent('甲,乙')}`)
      ).json()) as { items: { id: string }[] }
    ).items.map((x) => x.id)
    expect(entryIds).toEqual([eid])
    const usage = (
      (await (await req(u.owner, 'GET', '/tags')).json()) as { items: Tag[] }
    ).items.find((t) => t.id === b)
    expect(usage?.usage).toEqual({ tasks: 2, entries: 1 })
    await req(u.owner, 'DELETE', `/tags/${b}`)
    expect(await ids(`tag=${encodeURIComponent('乙')}`)).toEqual([])
    expect((await req(u.owner, 'GET', `/tasks?tag=${'x,'.repeat(21)}`)).status).toBe(422)
  })
})

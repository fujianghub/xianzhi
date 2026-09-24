/** T1-012 记录完整路由（REQ-ENTRY-002 · 003 · 004 · 006 · 007 · 008 · 011，api 层）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface E {
  id: string
  updatedAt: string
  visibility: string
  pinned: boolean
  excerpt?: string
}

describe('T1-012 entries', () => {
  let app: App
  const u: Record<'owner' | 'admin' | 'author' | 'other' | 'guest' | 'outsider', U> = {} as never
  let spaceId = ''
  let space2 = ''

  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/entries', { kind: 'note', spaceId, ...body })
    expect(r.status, await r.clone().text()).toBe(201)
    const { id } = (await r.json()) as { id: string }
    return (await (await req(who, 'GET', `/entries/${id}`)).json()) as E
  }
  async function invite(email: string, role: 'admin' | 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'entry-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'entry-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.admin = await invite('ea@xz.local', 'admin')
    u.author = await invite('eau@xz.local', 'member')
    u.other = await invite('eo@xz.local', 'member')
    u.guest = await invite('eg@xz.local', 'guest')
    u.outsider = await invite('eout@xz.local', 'member')
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'Docs',
      slug: 'docs',
      kind: 'work',
      visibility: 'members',
    })
    spaceId = ((await s.json()) as { id: string }).id
    for (const who of [u.author, u.other])
      await req(u.owner, 'POST', `/spaces/${spaceId}/members`, { userId: who.id, role: 'member' })
    await req(u.owner, 'POST', `/spaces/${spaceId}/members`, { userId: u.guest.id, role: 'viewer' })
    const s2 = await req(u.owner, 'POST', '/spaces', {
      name: 'Other',
      slug: 'other',
      kind: 'work',
      visibility: 'members',
    })
    space2 = ((await s2.json()) as { id: string }).id
    await req(u.owner, 'POST', `/spaces/${space2}/members`, { userId: u.author.id, role: 'member' })
  })

  it('REQ-ENTRY-003 三种可见性 × 五角色矩阵（作者 / 同空间成员 / viewer / 工作区 admin / 非空间成员）', async () => {
    const expected: Record<string, Record<string, number>> = {
      private: { author: 200, other: 404, guest: 404, owner: 404, admin: 404, outsider: 404 },
      space: { author: 200, other: 200, guest: 200, owner: 200, admin: 200, outsider: 404 },
      workspace: { author: 200, other: 200, guest: 200, owner: 200, admin: 200, outsider: 404 },
    }
    for (const [visibility, row] of Object.entries(expected)) {
      const e = await create(u.author, { title: `vis-${visibility}`, visibility })
      for (const [who, status] of Object.entries(row))
        expect(
          (await req(u[who as keyof typeof u], 'GET', `/entries/${e.id}`)).status,
          `${visibility} × ${who}`,
        ).toBe(status)
    }
    // 个人空间：缺省 private；显式 space / workspace → 422
    const mine = await req(u.author, 'POST', '/entries', { kind: 'note', title: '随笔' })
    const { id } = (await mine.json()) as { id: string }
    expect(((await (await req(u.author, 'GET', `/entries/${id}`)).json()) as E).visibility).toBe(
      'private',
    )
    for (const visibility of ['space', 'workspace']) {
      const bad = await req(u.author, 'POST', '/entries', { kind: 'note', title: 'x', visibility })
      expect(bad.status).toBe(422)
      expect((await problemOf(bad)).errors?.[0]?.path).toBe('visibility')
    }
    expect((await req(u.author, 'GET', '/entries/not-a-uuid')).status).toBe(422)
  })

  it('REQ-ENTRY-002 列表无正文列、excerpt ≤ 160；authorId=me 只含自己的；游标翻页无重复', async () => {
    await create(u.other, { title: '别人写的', visibility: 'space' })
    for (let i = 0; i < 7; i++) await create(u.author, { title: `列表 ${i}`, visibility: 'space' })
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const r = await req(
        u.author,
        'GET',
        `/entries?spaceId=${spaceId}&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
      )
      const body = (await r.json()) as {
        items: (E & Record<string, unknown>)[]
        nextCursor: string | null
      }
      for (const it of body.items) {
        for (const k of ['ydoc', 'pmJson', 'plain', 'tsv']) expect(it).not.toHaveProperty(k)
        expect((it.excerpt ?? '').length).toBeLessThanOrEqual(160)
        seen.push(it.id)
      }
      cursor = body.nextCursor
    } while (cursor)
    expect(new Set(seen).size).toBe(seen.length)
    const mine = (await (await req(u.author, 'GET', '/entries?authorId=me&limit=200')).json()) as {
      items: { authorId: string }[]
    }
    expect(mine.items.every((x) => x.authorId === u.author.id)).toBe(true)
  })

  it('REQ-ENTRY-004 修改限作者或 space admin；删除限作者或 owner/admin', async () => {
    const e = await create(u.author, { title: '权限', visibility: 'space' })
    expect(
      (await req(u.other, 'PATCH', `/entries/${e.id}`, { title: 'x', ifUpdatedAt: e.updatedAt }))
        .status,
    ).toBe(403)
    await req(u.owner, 'PATCH', `/spaces/${spaceId}/members/${u.other.id}`, { role: 'admin' })
    const ok = await req(u.other, 'PATCH', `/entries/${e.id}`, {
      title: 'space admin 改',
      ifUpdatedAt: e.updatedAt,
    })
    expect(ok.status).toBe(200)
    await req(u.owner, 'PATCH', `/spaces/${spaceId}/members/${u.other.id}`, { role: 'member' })
    expect((await req(u.other, 'DELETE', `/entries/${e.id}`)).status).toBe(403)
    expect((await req(u.guest, 'DELETE', `/entries/${e.id}`)).status).toBe(403)
    expect((await req(u.admin, 'DELETE', `/entries/${e.id}`)).status).toBe(204)
  })

  it('REQ-ENTRY-006 固定：PATCH pinned → pinned=1 列表含且排首；归档 / 取消归档', async () => {
    const e = await create(u.author, { title: '要固定的', visibility: 'space' })
    const r = await req(u.author, 'PATCH', `/entries/${e.id}`, {
      pinned: true,
      ifUpdatedAt: e.updatedAt,
    })
    expect(r.status).toBe(200)
    const pinned = (await (
      await req(u.author, 'GET', `/entries?spaceId=${spaceId}&pinned=1`)
    ).json()) as { items: E[] }
    expect(pinned.items[0]?.id).toBe(e.id)
    expect(pinned.items.every((x) => x.pinned)).toBe(true)
    expect((await req(u.author, 'POST', `/entries/${e.id}/archive`)).status).toBe(200)
    const archived = (await (
      await req(u.author, 'GET', `/entries?spaceId=${spaceId}&archived=1`)
    ).json()) as { items: E[] }
    expect(archived.items.map((x) => x.id)).toContain(e.id)
    expect((await req(u.author, 'POST', `/entries/${e.id}/unarchive`)).status).toBe(200)
  })

  it('REQ-ENTRY-007 软删后作者与他人 GET 均 404；deleted=1 作者可见、他人不可见；恢复', async () => {
    const e = await create(u.author, { title: '要删的', visibility: 'space' })
    expect((await req(u.author, 'DELETE', `/entries/${e.id}`)).status).toBe(204)
    for (const who of [u.author, u.other, u.owner])
      expect((await req(who, 'GET', `/entries/${e.id}`)).status).toBe(404)
    const trash = async (who: U) => {
      const r = await req(who, 'GET', '/entries?deleted=1&limit=200')
      return ((await r.json()) as { items: E[] }).items.map((x) => x.id)
    }
    expect(await trash(u.author)).toContain(e.id)
    expect(await trash(u.other)).not.toContain(e.id)
    expect(await trash(u.owner)).toContain(e.id)
    expect((await req(u.author, 'POST', `/entries/${e.id}/restore`)).status).toBe(200)
    expect((await req(u.other, 'GET', `/entries/${e.id}`)).status).toBe(200)
  })

  it('REQ-ENTRY-008 preview 返回卡片数据（title / kind / excerpt / author / fields 摘要），无权 404', async () => {
    const r = await req(u.author, 'POST', '/entries', {
      kind: 'bug',
      title: '崩溃',
      spaceId,
      visibility: 'space',
      fields: { severity: 'high', status: 'open' },
    })
    const { id } = (await r.json()) as { id: string }
    const p = await req(u.other, 'GET', `/entries/${id}/preview`)
    expect(p.status).toBe(200)
    const body = (await p.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      id,
      kind: 'bug',
      title: '崩溃',
      author: { id: u.author.id },
      fieldsSummary: { severity: 'high', status: 'open' },
    })
    expect(body).not.toHaveProperty('pmJson')
    expect((await req(u.outsider, 'GET', `/entries/${id}/preview`)).status).toBe(404)
  })

  it('REQ-ENTRY-011 移动空间后可见性按目标空间重判：S1 成员非 S2 成员 GET 404', async () => {
    const e = await create(u.author, { title: '搬家', visibility: 'space' })
    expect((await req(u.other, 'GET', `/entries/${e.id}`)).status).toBe(200)
    const r = await req(u.author, 'PATCH', `/entries/${e.id}`, {
      spaceId: space2,
      ifUpdatedAt: e.updatedAt,
    })
    expect(r.status, await r.clone().text()).toBe(200)
    expect((await req(u.other, 'GET', `/entries/${e.id}`)).status).toBe(404)
    expect((await req(u.author, 'GET', `/entries/${e.id}`)).status).toBe(200)
  })
})

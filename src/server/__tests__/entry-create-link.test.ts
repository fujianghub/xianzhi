/** ADR-0018：新建并关联（REQ-LINK-006）与在目录里新建子页（REQ-ENTRY-023）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface LinkView {
  id: string
  kind: string
  to: { id: string | null }
}

describe('create entry with link', () => {
  let app: App
  let owner = ''
  let member = ''
  let spaceId = ''
  const req = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = (cookie: string, body: Record<string, unknown>) =>
    req(cookie, 'POST', '/entries', { kind: 'note', spaceId, ...body })
  const idOf = async (r: Response) => ((await r.json()) as { id: string }).id

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const inv = await req(owner, 'POST', '/workspace/invitations', {
      email: 'link-m@xz.local',
      role: 'member',
    })
    const { id } = (await inv.json()) as { id: string }
    await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'link-m@xz.local', name: 'm', password: 'link-password-1' }),
    })
    member = (await signIn(app, 'link-m@xz.local', 'link-password-1')).cookie
    const s = await req(owner, 'POST', '/spaces', {
      name: 'L',
      slug: 'link-s',
      kind: 'project',
      visibility: 'workspace',
    })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-LINK-006 新建并关联：同事务建 links(源 → 新记录)；源不可读 404、不可写 403 且不落库；mentions 422', async () => {
    const a = await idOf(await create(owner, { title: '需求 A', parentId: null }))
    const r = await create(owner, {
      title: '由 A 引出的 B',
      linkFrom: { entryId: a, kind: 'blocks' },
    })
    expect(r.status).toBe(201)
    const b = await idOf(r)
    const out = (await (await req(owner, 'GET', `/links?fromType=entry&fromId=${a}`)).json()) as
      | LinkView[]
      | { items: LinkView[] }
    const list = Array.isArray(out) ? out : out.items
    expect(list.find((l) => l.to.id === b)?.kind).toBe('blocks')

    // 成员看得到 A（工作区可见空间）但不能写 → 403，且 B 没被建出来
    const before = (
      (await (await req(member, 'GET', `/entries?spaceId=${spaceId}`)).json()) as {
        items: unknown[]
      }
    ).items.length
    const denied = await create(member, {
      title: '成员想关联',
      linkFrom: { entryId: a, kind: 'relates' },
    })
    expect(denied.status).toBe(403)
    const after = (
      (await (await req(member, 'GET', `/entries?spaceId=${spaceId}`)).json()) as {
        items: unknown[]
      }
    ).items.length
    expect(after).toBe(before)

    // 所有者的私人随笔：成员不可读 → 404
    const priv = await idOf(await req(owner, 'POST', '/entries', { kind: 'note', title: '私人' }))
    expect(
      (await create(member, { title: 'x', linkFrom: { entryId: priv, kind: 'relates' } })).status,
    ).toBe(404)

    // mentions 只由正文派生
    const bad = await create(owner, { title: 'x', linkFrom: { entryId: a, kind: 'mentions' } })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).code).toBe('VALIDATION')
  })

  it('REQ-ENTRY-023 在目录里的记录下新建子页；父页不在目录 → 422', async () => {
    const parent = await idOf(await create(owner, { title: '目录父页', parentId: null }))
    const child = await create(owner, { title: '子页', parentId: parent })
    expect(child.status).toBe(201)
    const tree = (await (await req(owner, 'GET', `/spaces/${spaceId}/tree`)).json()) as
      | { id: string; parentId: string | null }[]
      | { items: { id: string; parentId: string | null }[] }
    const nodes = Array.isArray(tree) ? tree : tree.items
    const childId = await idOf(child)
    expect(nodes.find((n) => n.id === childId)?.parentId).toBe(parent)
    const loose = await idOf(await create(owner, { title: '不在目录' }))
    expect((await create(owner, { title: 'x', parentId: loose })).status).toBe(422)
  })
})

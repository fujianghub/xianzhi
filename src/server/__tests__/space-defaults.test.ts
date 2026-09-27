/** ADR-0019：空间默认类型 / 默认模板（REQ-KB-010）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface SpaceView {
  id: string
  updatedAt: string
  defaultKind: string | null
  defaultTemplateId: string | null
}

describe('space entry defaults', () => {
  let app: App
  let owner = ''
  let space: SpaceView
  const req = (method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: owner }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const patch = async (body: Record<string, unknown>) => {
    const r = await req('PATCH', `/spaces/${space.id}`, { ...body, ifUpdatedAt: space.updatedAt })
    if (r.status === 200) space = (await r.clone().json()) as SpaceView
    return r
  }
  const tpl = async (scope: 'personal' | 'workspace') => {
    const r = await req('POST', '/templates', {
      name: `模板-${scope}`,
      scope,
      kind: 'note',
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(r.status, await r.clone().text()).toBe(201)
    return ((await r.json()) as { id: string }).id
  }

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const s = await req('POST', '/spaces', { name: 'D', slug: 'defaults-s', kind: 'learning' })
    space = (await s.json()) as SpaceView
  })

  it('REQ-KB-010 默认类型只能是内置类型；默认模板只能是内置 / 工作区模板（个人模板 422）；null 清除', async () => {
    expect(space).toMatchObject({ defaultKind: null, defaultTemplateId: null })
    let r = await patch({ defaultKind: 'plan', defaultTemplateId: 'builtin:learning-plan' })
    expect(r.status).toBe(200)
    expect(space).toMatchObject({ defaultKind: 'plan', defaultTemplateId: 'builtin:learning-plan' })
    r = await patch({ defaultKind: 'custom' })
    expect(r.status).toBe(422)
    r = await patch({ defaultTemplateId: 'builtin:not-exist' })
    expect((await problemOf(r)).errors?.[0]?.path).toBe('defaultTemplateId')
    r = await patch({ defaultTemplateId: await tpl('personal') })
    expect(r.status).toBe(422)
    const ws = await tpl('workspace')
    r = await patch({ defaultTemplateId: ws })
    expect(r.status).toBe(200)
    expect(space.defaultTemplateId).toBe(ws)
    r = await patch({ defaultKind: null, defaultTemplateId: null })
    expect(space).toMatchObject({ defaultKind: null, defaultTemplateId: null })
    const got = (await (await req('GET', `/spaces/${space.id}`)).json()) as SpaceView
    expect(got.defaultKind).toBeNull()
  })
})

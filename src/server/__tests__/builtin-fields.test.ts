/** ADR-0042：内置字段覆盖层（REQ-ENTRY-034 ~ 037）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface Builtin {
  kind: string
  baseFields: Record<string, unknown>
  fieldOrder: string[]
  fieldDefs: { key: string; label: string }[]
}
interface Entry {
  id: string
  kind: string
  fields: Record<string, unknown>
  updatedAt: string
}

describe('builtin field overrides', () => {
  let app: App
  const u: Record<'owner' | 'member', U> = {} as never
  let spaceId = ''
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const builtin = async (kind: string) =>
    (
      (await (await req(u.owner, 'GET', '/entry-types')).json()) as { builtin: Builtin[] }
    ).builtin.find((b) => b.kind === kind) as Builtin
  const patch = (kind: string, body: Record<string, unknown>, who = u.owner) =>
    req(who, 'PATCH', `/entry-types/builtin/${kind}`, body)
  const create = (body: Record<string, unknown>) =>
    req(u.owner, 'POST', '/entries', { spaceId, title: 'x', ...body })
  const get = async (id: string) =>
    (await (await req(u.owner, 'GET', `/entries/${id}`)).json()) as Entry

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    const inv = await req(u.owner, 'POST', '/workspace/invitations', {
      email: 'bfm@xz.local',
      role: 'member',
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'bfm@xz.local', name: 'bfm', password: 'type-password-1' }),
    })
    u.member = {
      id: ((await acc.json()) as { userId: string }).userId,
      cookie: (await signIn(app, 'bfm@xz.local', 'type-password-1')).cookie,
    }
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'BF',
      slug: 'bf-s',
      kind: 'work',
      visibility: 'workspace',
    })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-ENTRY-034 所有者可隐藏 / 改显示名 / 排序内置字段，GET 返回；成员 403；只给 baseFields 也能保存；null 恢复默认', async () => {
    const r = await patch('bug', {
      baseFields: { debugDir: { hidden: true }, module: { label: '所属模块' } },
      fieldOrder: ['priority', 'status', 'nope'],
    })
    expect(r.status).toBe(200)
    const b = await builtin('bug')
    expect(b.baseFields).toEqual({ debugDir: { hidden: true }, module: { label: '所属模块' } })
    expect(b.fieldOrder).toEqual(['priority', 'status']) // 不认识的键丢弃
    expect((await patch('bug', { baseFields: {} }, u.member)).status).toBe(403)
    expect((await patch('bug', { baseFields: null, fieldOrder: null })).status).toBe(200)
    const reset = await builtin('bug')
    expect(reset.baseFields).toEqual({})
    expect(reset.fieldOrder).toEqual([])
  })

  it('REQ-ENTRY-034 校验：未知字段、非选项字段改选项、不存在的选项、隐藏默认值选项、全部选项隐藏、显示名与追加字段重复 → 422', async () => {
    const bad = async (baseFields: unknown) => {
      const r = await patch('bug', { baseFields })
      expect(r.status).toBe(422)
      return (await problemOf(r)).errors?.map((e) => e.path) ?? []
    }
    expect(await bad({ nope: { hidden: true } })).toContain('baseFields.nope')
    expect(await bad({ module: { options: { a: { label: 'x' } } } })).toContain(
      'baseFields.module.options',
    )
    expect(await bad({ status: { options: { open: { label: 'x' } } } })).toContain(
      'baseFields.status.options.open',
    )
    expect(await bad({ status: { options: { new: { hidden: true } } } })).toContain(
      'baseFields.status.options.new',
    )
    const allHidden = Object.fromEntries(
      ['1', '2', '3', '4', '5'].map((v) => [v, { hidden: true }]),
    )
    const r = await patch('journal', { baseFields: { mood: { options: allHidden } } })
    expect(r.status).toBe(422)
    expect((await problemOf(r)).errors?.map((e) => e.path)).toContain('baseFields.mood.options')
    await patch('bug', { fieldDefs: [{ label: '负责人', type: 'text' }] })
    expect(await bad({ module: { label: '负责人' } })).toContain('baseFields')
    await patch('bug', { fieldDefs: [] })
  })

  it('REQ-ENTRY-035 隐藏的必填字段：有默认值的补默认（Bug 严重度），没有的改为可选（迭代起止）；未隐藏仍 422', async () => {
    const missing = await create({ kind: 'bug', fields: { status: 'new' } })
    expect(missing.status).toBe(422)
    expect((await problemOf(missing)).errors?.map((e) => e.path)).toContain('fields.severity')
    await patch('bug', { baseFields: { severity: { hidden: true } } })
    const ok = await create({ kind: 'bug', fields: { status: 'new' } })
    expect(ok.status).toBe(201)
    const e = await get(((await ok.json()) as { id: string }).id)
    expect(e.fields.severity).toBe('medium')

    expect((await create({ kind: 'iteration', fields: {} })).status).toBe(422)
    await patch('iteration', {
      baseFields: { periodStart: { hidden: true }, periodEnd: { hidden: true } },
    })
    const it2 = await create({ kind: 'iteration', fields: { version: 'v1' } })
    expect(it2.status).toBe(201)
    const e2 = await get(((await it2.json()) as { id: string }).id)
    expect(e2.fields).toEqual({ version: 'v1' })
    // 未隐藏的值照常校验
    expect((await create({ kind: 'bug', fields: { status: 'new', priority: 'p9' } })).status).toBe(
      422,
    )
    await patch('bug', { baseFields: null })
    await patch('iteration', { baseFields: null })
  })

  it('REQ-ENTRY-036 隐藏只影响展示：改属性时没带的隐藏字段保留原值；改回显示后值还在', async () => {
    const r = await create({
      kind: 'bug',
      fields: { status: 'new', severity: 'high', module: '登录', debugDir: 'debug/x' },
    })
    const id = ((await r.json()) as { id: string }).id
    await patch('bug', { baseFields: { module: { hidden: true }, debugDir: { hidden: true } } })
    const cur = await get(id)
    // 客户端只回传可见字段
    const p = await req(u.owner, 'PATCH', `/entries/${id}`, {
      fields: { status: 'pending', severity: 'high', priority: 'p1' },
      ifUpdatedAt: cur.updatedAt,
    })
    expect(p.status).toBe(200)
    const after = await get(id)
    expect(after.fields).toMatchObject({
      status: 'pending',
      priority: 'p1',
      module: '登录',
      debugDir: 'debug/x',
    })
    await patch('bug', { baseFields: null })
    expect((await get(id)).fields.module).toBe('登录')
  })

  it('REQ-ENTRY-037 选项可改显示名 / 色、可隐藏；值不变，已有隐藏值的记录照常读写', async () => {
    const r = await patch('bug', {
      baseFields: {
        status: {
          label: '进度',
          options: {
            pending: { label: '待定', color: 'purple' },
            wontfix: { hidden: true },
          },
        },
      },
    })
    expect(r.status).toBe(200)
    expect((await builtin('bug')).baseFields).toEqual({
      status: {
        label: '进度',
        options: { pending: { label: '待定', color: 'purple' }, wontfix: { hidden: true } },
      },
    })
    // 值仍是代码值：隐藏的选项仍可写入（界面不列，但旧数据 / 批量不致 422）
    const c = await create({ kind: 'bug', fields: { status: 'wontfix', severity: 'low' } })
    expect(c.status).toBe(201)
    const listed = (await (
      await req(u.owner, 'GET', `/entries?kind=bug&fields=status=pending`)
    ).json()) as { items: Entry[] }
    expect(Array.isArray(listed.items)).toBe(true)
    await patch('bug', { baseFields: null })
  })
})

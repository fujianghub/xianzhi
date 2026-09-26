/** ADR-0016 · 0017：类型（REQ-ENTRY-018 ~ 020，增删改仅所有者）与批量改类型 / 状态 / 固定（REQ-ENTRY-017）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface EType {
  id: string
  name: string
  color: string
  statuses: string[]
  canManage: boolean
  mine: boolean
  usage: number
}
interface TypesList {
  builtin: {
    kind: string
    name: string | null
    color: string | null
    deleted: boolean
    usage: number
  }[]
  items: EType[]
  canManageBuiltin: boolean
}
interface Entry {
  id: string
  kind: string
  typeId: string | null
  fields: Record<string, unknown>
  pinned: boolean
  updatedAt: string
}

describe('entry types', () => {
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
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'type-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'type-password-1')).cookie }
  }
  const types = async (who = u.owner) =>
    (await (await req(who, 'GET', '/entry-types')).json()) as TypesList
  const create = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/entries', { spaceId, ...body })
    return { status: r.status, id: ((await r.clone().json()) as { id: string }).id, r }
  }
  const get = async (id: string) =>
    (await (await req(u.owner, 'GET', `/entries/${id}`)).json()) as Entry
  const listIds = async (qs: string) =>
    ((await (await req(u.owner, 'GET', `/entries?${qs}`)).json()) as { items: Entry[] }).items.map(
      (e) => e.id,
    )

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('typem@xz.local', 'member')
    u.guest = await invite('typeg@xz.local', 'guest')
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'T',
      slug: 'types-s',
      kind: 'work',
      visibility: 'workspace',
    })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-ENTRY-018 自定义类型按人隔离：各自新建、同名互不冲突；只有本人能改 / 删 / 用来新建；读者看得到名与状态；guest 不能建', async () => {
    const r = await req(u.owner, 'POST', '/entry-types', {
      name: '读书笔记',
      color: 'purple',
      statuses: ['想读', '在读', '读完'],
    })
    expect(r.status).toBe(201)
    const t = (await r.json()) as EType
    expect(t).toMatchObject({
      name: '读书笔记',
      statuses: ['想读', '在读', '读完'],
      canManage: true,
    })
    expect(
      (await req(u.owner, 'POST', '/entry-types', { name: '读书笔记', color: 'red' })).status,
    ).toBe(409)
    const bad = await req(u.owner, 'POST', '/entry-types', {
      name: '坏',
      color: 'red',
      statuses: ['a,b'],
    })
    expect(bad.status).toBe(422)
    expect((await req(u.guest, 'POST', '/entry-types', { name: 'g', color: 'red' })).status).toBe(
      403,
    )
    // 成员建自己的类型，可与所有者同名
    const m = await req(u.member, 'POST', '/entry-types', {
      name: '读书笔记',
      color: 'blue',
      statuses: ['待看', '看完'],
    })
    expect(m.status).toBe(201)
    const memberType = (await m.json()) as EType
    // 别人的类型：不能改 / 删（管理员也不例外），不能用来新建记录
    expect((await req(u.member, 'PATCH', `/entry-types/${t.id}`, { name: '例会' })).status).toBe(
      403,
    )
    expect((await req(u.member, 'DELETE', `/entry-types/${t.id}`)).status).toBe(403)
    expect((await req(u.owner, 'DELETE', `/entry-types/${memberType.id}`)).status).toBe(403)
    expect(
      (await create(u.member, { kind: 'custom', typeId: t.id, title: '借用别人的类型' })).status,
    ).toBe(422)
    expect((await req(u.owner, 'PATCH', `/entry-types/${t.id}`, { color: 'green' })).status).toBe(
      200,
    )
    // 列表：全部类型都返回（用于显示别人记录的类型），mine / canManage 只对自己的为 true
    const list = await types(u.member)
    const byId = new Map(list.items.map((x) => [x.id, x]))
    expect(byId.get(memberType.id)).toMatchObject({ mine: true, canManage: true })
    expect(byId.get(t.id)).toMatchObject({ mine: false, canManage: false, name: '读书笔记' })
    expect(list.canManageBuiltin).toBe(false)
    expect((await types(u.owner)).canManageBuiltin).toBe(true)
    expect(list.builtin.map((b) => b.kind)).not.toContain('custom')
    // 清掉成员的类型，后续用例只看所有者的「读书笔记」
    expect((await req(u.member, 'DELETE', `/entry-types/${memberType.id}`)).status).toBe(204)
  })

  it('REQ-ENTRY-018 自定义类型记录：状态默认第一项、状态须在列表里、typeId 筛选与 kind 任一命中；改状态列表同步记录', async () => {
    const t = (await types()).items.find((x) => x.name === '读书笔记' && x.mine) as EType
    const a = await create(u.owner, {
      kind: 'custom',
      typeId: t.id,
      title: '《设计数据密集型应用》',
    })
    expect(a.status).toBe(201)
    const e = await get(a.id)
    expect(e).toMatchObject({ kind: 'custom', typeId: t.id, fields: { status: '想读' } })
    // 缺 typeId / 错状态 / 不存在的类型
    expect((await create(u.owner, { kind: 'custom', title: 'x' })).status).toBe(422)
    expect(
      (
        await create(u.owner, {
          kind: 'custom',
          typeId: t.id,
          title: 'x',
          fields: { status: '不存在' },
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await create(u.owner, {
          kind: 'custom',
          typeId: '01900000-0000-7000-8000-000000000000',
          title: 'x',
        })
      ).status,
    ).toBe(422)
    const p = await req(u.owner, 'PATCH', `/entries/${a.id}`, {
      fields: { status: '在读', progress: 40 },
      ifUpdatedAt: e.updatedAt,
    })
    expect(p.status).toBe(200)
    const bug = await create(u.owner, {
      kind: 'bug',
      title: '一个 bug',
      fields: { severity: 'high', status: 'open' },
    })
    expect((await listIds(`typeId=${t.id}`)).sort()).toEqual([a.id])
    expect((await listIds(`kind=bug&typeId=${t.id}`)).sort()).toEqual([a.id, bug.id].sort())
    // 状态改名「在读」→「阅读中」，去掉「想读」
    const r = await req(u.owner, 'PATCH', `/entry-types/${t.id}`, {
      statuses: ['阅读中', '读完'],
      renames: { 在读: '阅读中' },
    })
    expect(r.status).toBe(200)
    expect((await get(a.id)).fields).toMatchObject({ status: '阅读中', progress: 40 })
    expect((await types()).items.find((x) => x.id === t.id)?.usage).toBe(1)
  })

  it('REQ-ENTRY-017 批量改类型 / 状态 / 固定；目标类型有必填字段 → 逐条失败', async () => {
    const t = (await types()).items.find((x) => x.name === '读书笔记' && x.mine) as EType
    const n1 = await create(u.owner, { kind: 'note', title: '随手一' })
    const n2 = await create(u.owner, {
      kind: 'plan',
      title: '计划二',
      fields: { status: 'active', progress: 30 },
    })
    const batch = async (body: unknown) => {
      const r = await req(u.owner, 'POST', '/entries/batch', body)
      return (await r.json()) as { ok: string[]; failed: { id: string; code: string }[] }
    }
    let r = await batch({ op: 'retype', ids: [n1.id, n2.id], kind: 'custom', typeId: t.id })
    expect(r.ok.sort()).toEqual([n1.id, n2.id].sort())
    expect((await get(n1.id)).fields).toEqual({ status: '阅读中' })
    expect((await get(n2.id)).fields).toEqual({ status: '阅读中', progress: 30 })
    r = await batch({ op: 'fields', ids: [n1.id, n2.id], set: { status: '读完' } })
    expect(r.ok).toHaveLength(2)
    expect((await get(n1.id)).fields.status).toBe('读完')
    // 不在状态列表里 → 逐条失败
    r = await batch({ op: 'fields', ids: [n1.id], set: { status: 'open' } })
    expect(r.failed[0]?.code).toBe('VALIDATION')
    r = await batch({ op: 'retype', ids: [n1.id], kind: 'iteration' })
    expect(r.failed).toHaveLength(1)
    r = await batch({ op: 'retype', ids: [n1.id], kind: 'bug' })
    expect(r.ok).toEqual([n1.id])
    expect(await get(n1.id)).toMatchObject({
      kind: 'bug',
      typeId: null,
      fields: { severity: 'medium', status: 'open' },
    })
    r = await batch({ op: 'pin', ids: [n1.id, n2.id] })
    expect(r.ok).toHaveLength(2)
    expect((await get(n2.id)).pinned).toBe(true)
    // kind=custom 缺 typeId → 422
    const bad = await req(u.owner, 'POST', '/entries/batch', {
      op: 'retype',
      ids: [n1.id],
      kind: 'custom',
    })
    expect(bad.status).toBe(422)
  })

  it('REQ-ENTRY-019 删除自定义类型：其下记录（含回收站）转到 moveTo（缺省随笔）并写审计', async () => {
    const t = (await types()).items.find((x) => x.name === '读书笔记' && x.mine) as EType
    const trashed = await create(u.owner, { kind: 'custom', typeId: t.id, title: '将被删' })
    expect((await req(u.owner, 'DELETE', `/entries/${trashed.id}`)).status).toBe(204)
    // 目标不能是自己 / 有必填属性的类型
    expect((await req(u.owner, 'DELETE', `/entry-types/${t.id}?moveTo=${t.id}`)).status).toBe(422)
    expect((await req(u.owner, 'DELETE', `/entry-types/${t.id}?moveTo=iteration`)).status).toBe(422)
    expect((await req(u.owner, 'DELETE', `/entry-types/${t.id}?moveTo=bug`)).status).toBe(204)
    expect((await types()).items.some((x) => x.id === t.id)).toBe(false)
    expect((await listIds('kind=custom')).length).toBe(0)
    const res = await req(u.owner, 'GET', `/entries?deleted=1`)
    const gone = ((await res.json()) as { items: Entry[] }).items.find((x) => x.id === trashed.id)
    expect(gone).toMatchObject({ kind: 'bug', typeId: null })
    const audit = await req(u.owner, 'GET', '/workspace/audit-log?action=entry_type.deleted')
    expect(JSON.stringify(await audit.json())).toContain('读书笔记')
  })

  it('REQ-ENTRY-020 内置类型：所有者可改名 / 改色 / 删除（记录转走）/ 恢复；删后不能新建该类型；成员 403', async () => {
    expect(
      (await req(u.member, 'PATCH', '/entry-types/builtin/optimize', { name: '改进' })).status,
    ).toBe(403)
    const p = await req(u.owner, 'PATCH', '/entry-types/builtin/optimize', {
      name: '改进',
      color: 'cyan',
    })
    expect(p.status).toBe(200)
    expect(
      ((await p.json()) as TypesList).builtin.find((b) => b.kind === 'optimize'),
    ).toMatchObject({ name: '改进', color: 'cyan', deleted: false })
    // 与自定义类型重名 → 409
    await req(u.owner, 'POST', '/entry-types', { name: '会议纪要', color: 'blue' })
    expect(
      (await req(u.owner, 'PATCH', '/entry-types/builtin/optimize', { name: '会议纪要' })).status,
    ).toBe(409)
    const o = await create(u.owner, {
      kind: 'optimize',
      title: '首页提速',
      fields: { status: 'doing' },
    })
    expect((await req(u.member, 'DELETE', '/entry-types/builtin/optimize')).status).toBe(403)
    const d = await req(u.owner, 'DELETE', '/entry-types/builtin/optimize?moveTo=plan')
    expect(d.status).toBe(200)
    expect(
      ((await d.json()) as TypesList).builtin.find((b) => b.kind === 'optimize')?.deleted,
    ).toBe(true)
    expect(await get(o.id)).toMatchObject({ kind: 'plan', fields: { status: 'active' } })
    expect(
      (await create(u.owner, { kind: 'optimize', title: 'x', fields: { status: 'doing' } })).status,
    ).toBe(422)
    // 内置类型只能转到内置类型（不能把大家的记录转进某人的私有类型）
    const own = (await types()).items.find((x) => x.mine) as EType
    expect(
      (await req(u.owner, 'DELETE', `/entry-types/builtin/journal?moveTo=${own.id}`)).status,
    ).toBe(422)
    // 删随笔必须给出目标
    expect((await req(u.owner, 'DELETE', '/entry-types/builtin/note')).status).toBe(422)
    // 转入目标不能是已删除的内置类型
    expect(
      (await req(u.owner, 'DELETE', '/entry-types/builtin/journal?moveTo=optimize')).status,
    ).toBe(422)
    const rs = await req(u.owner, 'POST', '/entry-types/builtin/optimize/restore')
    expect(
      ((await rs.json()) as TypesList).builtin.find((b) => b.kind === 'optimize')?.deleted,
    ).toBe(false)
    expect(
      (await create(u.owner, { kind: 'optimize', title: 'y', fields: { status: 'doing' } })).status,
    ).toBe(201)
    // 恢复默认名 / 色
    const reset = await req(u.owner, 'PATCH', '/entry-types/builtin/optimize', {
      name: null,
      color: null,
    })
    expect(
      ((await reset.json()) as TypesList).builtin.find((b) => b.kind === 'optimize'),
    ).toMatchObject({ name: null, color: null })
    expect(
      (await problemOf(await req(u.owner, 'PATCH', '/entry-types/builtin/custom', { name: 'x' })))
        .code,
    ).toBe('VALIDATION')
  })
})

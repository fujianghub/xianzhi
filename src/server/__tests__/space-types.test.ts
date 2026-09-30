/**
 * ADR-0036：空间类型 · 启用清单 · 字段定义 · 模板绑类型
 * （REQ-KB-014 · 015 · 017、REQ-ENTRY-027 · 028 · 029、REQ-TPL-011）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface FieldDef {
  key: string
  label: string
  type: string
  options?: { name: string; color: string }[]
}
interface EType {
  id: string
  name: string
  spaceId: string | null
  fieldDefs: FieldDef[]
  statusColors: Record<string, string>
  canManage: boolean
  usable: boolean
}
interface Entry {
  id: string
  kind: string
  typeId: string | null
  spaceId: string
  fields: Record<string, unknown>
  updatedAt: string
}
interface Space {
  id: string
  updatedAt: string
  enabledKinds: string[]
  enabledKindsRaw: string[] | null
  defaultTypeId: string | null
}

describe('space types & field defs', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'guest', U> = {} as never
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T
  async function invite(email: string, role: 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'space-type-pass-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'space-type-pass-1')).cookie }
  }
  const mkSpace = async (slug: string, visibility: 'workspace' | 'members' = 'workspace') =>
    json<Space>(req(u.owner, 'POST', '/spaces', { name: slug, slug, kind: 'project', visibility }))
  const types = async (who: U) =>
    (await json<{ items: EType[] }>(req(who, 'GET', '/entry-types'))).items
  const getEntry = (id: string) => json<Entry>(req(u.owner, 'GET', `/entries/${id}`))
  const getSpace = (id: string) => json<Space>(req(u.owner, 'GET', `/spaces/${id}`))

  let shared: Space
  let other: Space

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('stm@xz.local', 'member')
    u.guest = await invite('stg@xz.local', 'guest')
    shared = await mkSpace('st-shared')
    other = await mkSpace('st-other')
  })

  it('REQ-KB-015 空间类型：空间管理员建，成员在该空间可用；非管理员 / guest 不能建；个人空间不行；别的空间用不了', async () => {
    const r = await req(u.owner, 'POST', '/entry-types', {
      name: '需求',
      color: 'blue',
      statuses: ['待办', '开发中', '完成'],
      spaceId: shared.id,
    })
    expect(r.status).toBe(201)
    const t = (await r.json()) as EType
    expect(t).toMatchObject({ spaceId: shared.id, canManage: true, usable: true })
    // 同空间重名 409；个人类型同名不冲突
    expect(
      (
        await req(u.owner, 'POST', '/entry-types', {
          name: '需求',
          color: 'red',
          spaceId: shared.id,
        })
      ).status,
    ).toBe(409)
    expect(
      (await req(u.owner, 'POST', '/entry-types', { name: '需求', color: 'red' })).status,
    ).toBe(201)
    // 成员（非空间管理员）不能建空间类型，但看得到、能用
    expect(
      (await req(u.member, 'POST', '/entry-types', { name: 'x', color: 'red', spaceId: shared.id }))
        .status,
    ).toBe(403)
    const seen = (await types(u.member)).find((x) => x.id === t.id)
    expect(seen).toMatchObject({ canManage: false, usable: true })
    const created = await req(u.member, 'POST', '/entries', {
      spaceId: shared.id,
      kind: 'custom',
      typeId: t.id,
      title: '登录页',
    })
    expect(created.status).toBe(201)
    const e = await getEntry(((await created.json()) as { id: string }).id)
    expect(e.fields.status).toBe('待办')
    // 在别的空间用 → 422；把记录移到别的空间 → 422
    expect(
      (
        await req(u.member, 'POST', '/entries', {
          spaceId: other.id,
          kind: 'custom',
          typeId: t.id,
          title: '越界',
        })
      ).status,
    ).toBe(422)
    const mv = await req(u.owner, 'PATCH', `/entries/${e.id}`, {
      spaceId: other.id,
      ifUpdatedAt: e.updatedAt,
    })
    expect(mv.status).toBe(422)
    expect((await problemOf(mv)).errors?.[0]?.path).toBe('spaceId')
    // guest 看得到名，不能建
    expect(
      (await req(u.guest, 'POST', '/entry-types', { name: 'g', color: 'red', spaceId: shared.id }))
        .status,
    ).toBe(403)
    // 个人空间不能有空间类型
    const me = await json<{ items: { id: string; isPersonal: boolean }[] }>(
      req(u.owner, 'GET', '/spaces'),
    )
    const personal = me.items.find((s) => s.isPersonal)
    if (personal)
      expect(
        (
          await req(u.owner, 'POST', '/entry-types', {
            name: 'p',
            color: 'red',
            spaceId: personal.id,
          })
        ).status,
      ).toBe(422)
  })

  it('REQ-ENTRY-029 私密空间的类型对非成员不可见', async () => {
    const hidden = await mkSpace('st-hidden', 'members')
    const t = await json<EType>(
      req(u.owner, 'POST', '/entry-types', { name: '机密', color: 'red', spaceId: hidden.id }),
    )
    expect((await types(u.owner)).some((x) => x.id === t.id)).toBe(true)
    expect((await types(u.member)).some((x) => x.id === t.id)).toBe(false)
    expect((await req(u.member, 'PATCH', `/entry-types/${t.id}`, { name: 'y' })).status).toBe(404)
  })

  it('REQ-ENTRY-027 字段定义：服务端生成键；值按定义校验；未定义键丢弃；删字段 / 删选项清值；选项改名同步；多选按含任一筛选；审计', async () => {
    const t = await json<EType>(
      req(u.owner, 'POST', '/entry-types', {
        name: '功能',
        color: 'green',
        spaceId: shared.id,
        statusColors: { 新: 'red' },
        statuses: ['新', '完'],
        fieldDefs: [
          {
            label: '阶段',
            type: 'select',
            options: [
              { name: '设计', color: 'blue' },
              { name: '开发', color: 'orange' },
            ],
          },
          {
            label: '平台',
            type: 'multiselect',
            options: [
              { name: 'Web', color: 'cyan' },
              { name: 'iOS', color: 'gray' },
            ],
          },
          { label: '估时', type: 'number' },
        ],
      }),
    )
    expect(t.statusColors).toEqual({ 新: 'red' })
    const [stage, plat, est] = t.fieldDefs
    for (const d of t.fieldDefs) expect(d.key).toMatch(/^x[A-Z]{6}$/)
    if (!stage || !plat || !est) throw new Error('defs')
    const mk = async (fields: Record<string, unknown>) =>
      req(u.owner, 'POST', '/entries', {
        spaceId: shared.id,
        kind: 'custom',
        typeId: t.id,
        title: 'f',
        fields,
      })
    const bad = await mk({ [stage.key]: '上线' })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe(`fields.${stage.key}`)
    expect((await mk({ [est.key]: '三天' })).status).toBe(422)
    const ok = await mk({
      [stage.key]: '设计',
      [plat.key]: ['Web', 'iOS'],
      [est.key]: 3,
      xZZZZZZ: 1,
    })
    expect(ok.status).toBe(201)
    const id = ((await ok.json()) as { id: string }).id
    let e = await getEntry(id)
    expect(e.fields).toMatchObject({
      [stage.key]: '设计',
      [plat.key]: ['Web', 'iOS'],
      [est.key]: 3,
    })
    expect('xZZZZZZ' in e.fields).toBe(false)
    // 多选筛选：含任一
    const ids = async (qs: string) =>
      (await json<{ items: Entry[] }>(req(u.owner, 'GET', `/entries?${qs}`))).items.map((x) => x.id)
    expect(await ids(`spaceId=${shared.id}&fields=${plat.key}=iOS`)).toContain(id)
    expect(await ids(`spaceId=${shared.id}&fields=${stage.key}=开发`)).not.toContain(id)
    // 改定义：阶段「设计」改名「方案」，平台删掉 iOS，删掉估时
    const p = await req(u.owner, 'PATCH', `/entry-types/${t.id}`, {
      fieldDefs: [
        {
          key: stage.key,
          label: '阶段',
          type: 'select',
          options: [
            { name: '方案', color: 'blue' },
            { name: '开发', color: 'orange' },
          ],
        },
        {
          key: plat.key,
          label: '平台',
          type: 'multiselect',
          options: [{ name: 'Web', color: 'cyan' }],
        },
      ],
      optionRenames: { [stage.key]: { 设计: '方案' } },
    })
    expect(p.status).toBe(200)
    e = await getEntry(id)
    expect(e.fields[stage.key]).toBe('方案')
    expect(e.fields[plat.key]).toEqual(['Web'])
    expect(est.key in e.fields).toBe(false)
    // 改类型字段不可改 type
    expect(
      (
        await req(u.owner, 'PATCH', `/entry-types/${t.id}`, {
          fieldDefs: [{ key: stage.key, label: '阶段', type: 'text' }],
        })
      ).status,
    ).toBe(422)
    // 打开中的旧页面仍带着被删字段的键：静默丢弃，不 422
    const stale = await req(u.owner, 'PATCH', `/entries/${id}`, {
      fields: { ...e.fields, [est.key]: 5 },
      ifUpdatedAt: e.updatedAt,
    })
    expect(stale.status).toBe(200)
    expect(est.key in ((await stale.json()) as Entry).fields).toBe(false)
    const audit = await json<{ items: { action: string }[] }>(
      req(u.owner, 'GET', '/workspace/audit-log?action=entry_type.fields_changed'),
    )
    expect(audit.items.some((a) => a.action === 'entry_type.fields_changed')).toBe(true)
  })

  it('REQ-ENTRY-028 内置类型追加字段：仅所有者；Bug 记录可填', async () => {
    expect(
      (
        await req(u.member, 'PATCH', '/entry-types/builtin/bug', {
          fieldDefs: [{ label: '版本', type: 'text' }],
        })
      ).status,
    ).toBe(403)
    const list = await json<{ builtin: { kind: string; fieldDefs: FieldDef[] }[] }>(
      req(u.owner, 'PATCH', '/entry-types/builtin/bug', {
        fieldDefs: [{ label: '影响版本', type: 'text' }],
      }),
    )
    const def = list.builtin.find((b) => b.kind === 'bug')?.fieldDefs[0]
    if (!def) throw new Error('def')
    const r = await req(u.member, 'POST', '/entries', {
      spaceId: shared.id,
      kind: 'bug',
      title: 'b',
      fields: { status: 'new', severity: 'low', [def.key]: 'v1.2' },
    })
    expect(r.status).toBe(201)
    expect((await getEntry(((await r.json()) as { id: string }).id)).fields[def.key]).toBe('v1.2')
  })

  it('REQ-KB-014 · 017 启用清单与默认类型：null 推导默认含本空间类型；只能放本空间类型 / 本人个人类型；删类型后清掉', async () => {
    const s = await mkSpace('st-enabled')
    const t = await json<EType>(
      req(u.owner, 'POST', '/entry-types', { name: '任务卡', color: 'pink', spaceId: s.id }),
    )
    let v = await getSpace(s.id)
    expect(v.enabledKindsRaw).toBeNull()
    expect(v.enabledKinds).toEqual(expect.arrayContaining(['bug', 'note', `type:${t.id}`]))
    const foreign = (await types(u.owner)).find((x) => x.spaceId === shared.id)
    const bad = await req(u.owner, 'PATCH', `/spaces/${s.id}`, {
      enabledKinds: ['note', `type:${foreign?.id}`],
      ifUpdatedAt: v.updatedAt,
    })
    expect(bad.status).toBe(422)
    const ok = await req(u.owner, 'PATCH', `/spaces/${s.id}`, {
      enabledKinds: [`type:${t.id}`, 'note'],
      defaultTypeId: t.id,
      ifUpdatedAt: v.updatedAt,
    })
    expect(ok.status).toBe(200)
    v = (await ok.json()) as Space
    expect(v.enabledKinds).toEqual([`type:${t.id}`, 'note'])
    expect(v.defaultTypeId).toBe(t.id)
    // 默认类型只能是本空间的
    expect(
      (
        await req(u.owner, 'PATCH', `/spaces/${s.id}`, {
          defaultTypeId: foreign?.id,
          ifUpdatedAt: v.updatedAt,
        })
      ).status,
    ).toBe(422)
    // 新建空间类型自动追加到显式清单末尾
    const t2 = await json<EType>(
      req(u.owner, 'POST', '/entry-types', { name: '里程碑', color: 'cyan', spaceId: s.id }),
    )
    expect((await getSpace(s.id)).enabledKinds).toEqual([`type:${t.id}`, 'note', `type:${t2.id}`])
    expect((await req(u.owner, 'DELETE', `/entry-types/${t.id}`)).status).toBe(204)
    v = await getSpace(s.id)
    expect(v.enabledKinds).toEqual(['note', `type:${t2.id}`])
    expect(v.defaultTypeId).toBeNull()
  })

  it('REQ-TPL-011 模板绑类型：预填自定义字段；工作区模板不能绑个人类型；类型删除后模板转随笔', async () => {
    const t = await json<EType>(
      req(u.owner, 'POST', '/entry-types', {
        name: '周报',
        color: 'yellow',
        spaceId: shared.id,
        fieldDefs: [{ label: '周次', type: 'number' }],
      }),
    )
    const key = t.fieldDefs[0]?.key ?? ''
    const body = { type: 'doc', content: [{ type: 'paragraph' }] }
    const tpl = await req(u.owner, 'POST', '/templates', {
      name: '周报模板',
      scope: 'workspace',
      kind: 'custom',
      typeId: t.id,
      fields: { [key]: 40 },
      body,
    })
    expect(tpl.status).toBe(201)
    const tv = (await tpl.json()) as { id: string; typeId: string; fields: Record<string, unknown> }
    expect(tv).toMatchObject({ typeId: t.id, fields: { [key]: 40 } })
    const personal = await json<EType>(
      req(u.owner, 'POST', '/entry-types', { name: '私房', color: 'red' }),
    )
    expect(
      (
        await req(u.owner, 'POST', '/templates', {
          name: '不行',
          scope: 'workspace',
          kind: 'custom',
          typeId: personal.id,
          body,
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await req(u.owner, 'POST', '/templates', {
          name: '可以',
          scope: 'personal',
          kind: 'custom',
          typeId: personal.id,
          body,
        })
      ).status,
    ).toBe(201)
    expect((await req(u.owner, 'DELETE', `/entry-types/${t.id}`)).status).toBe(204)
    const after = await json<{ kind: string; typeId: string | null }>(
      req(u.owner, 'GET', `/templates/${tv.id}`),
    )
    expect(after).toMatchObject({ kind: 'note', typeId: null })
  })

  it('REQ-KB-015 合并空间：空间类型改挂目标（重名加后缀）；彻底删除空间：别处引用其类型的记录转随笔', async () => {
    const a = await mkSpace('st-merge-a')
    const b = await mkSpace('st-merge-b')
    const ta = await json<EType>(
      req(u.owner, 'POST', '/entry-types', { name: '同名', color: 'red', spaceId: a.id }),
    )
    await req(u.owner, 'POST', '/entry-types', { name: '同名', color: 'red', spaceId: b.id })
    const m = await req(u.owner, 'POST', `/spaces/${a.id}/merge`, { into: b.id })
    expect(m.status).toBe(200)
    const moved = (await types(u.owner)).find((x) => x.id === ta.id)
    expect(moved).toMatchObject({ spaceId: b.id, name: '同名（合并）' })

    // 彻底删除：先软删再 permanent
    const c = await mkSpace('st-purge')
    const tc = await json<EType>(
      req(u.owner, 'POST', '/entry-types', { name: '临时', color: 'red', spaceId: c.id }),
    )
    const e = await json<{ id: string }>(
      req(u.owner, 'POST', '/entries', {
        spaceId: c.id,
        kind: 'custom',
        typeId: tc.id,
        title: 'x',
      }),
    )
    // 模拟边角路径：记录被挪到别处却还挂着该类型（直接写库）
    const { db } = await import('./db.ts')
    const { entries } = await import('../db/schema/business.ts')
    const { eq } = await import('drizzle-orm')
    await db().update(entries).set({ spaceId: other.id }).where(eq(entries.id, e.id))
    expect((await req(u.owner, 'DELETE', `/spaces/${c.id}`)).status).toBe(204)
    expect((await req(u.owner, 'DELETE', `/spaces/${c.id}?permanent=1`)).status).toBe(204)
    const after = await getEntry(e.id)
    expect(after).toMatchObject({ kind: 'note', typeId: null })
  })
})

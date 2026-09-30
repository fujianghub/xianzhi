/**
 * ADR-0039 模板元数据：模板自有字段的增删改查（REQ-TPL-016）· 移除类型字段（REQ-TPL-017）·
 * 定义变更同步记录 / 删模板清值（REQ-TPL-018）· 元数据目录与沿用（REQ-TPL-019）· 记录的来源模板（REQ-ENTRY-032）。
 * ADR-0040：按模板属性筛选 / 分组，目录带模板名（REQ-ENTRY-033）。
 */
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { migrateExtraValues } from '../../shared/schemas/fieldDefs.ts'
import { getDb } from '../db/index.ts'
import { auditLog, entryTemplates } from '../db/schema/business.ts'
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
  required?: boolean
  options?: { name: string; color: string }[]
}
interface Tpl {
  id: string
  name: string
  kind: string
  typeId: string | null
  fields: Record<string, unknown>
  fieldDefs: FieldDef[]
  hiddenFields: string[]
  entryCount: number
  customized?: boolean
  updatedAt: string
}
interface Entry {
  id: string
  kind: string
  templateId: string | null
  fields: Record<string, unknown>
  updatedAt: string
}
interface Meta {
  id: string
  name: string | null
  kind: string
  typeId: string | null
  fieldDefs: FieldDef[]
  hiddenFields: string[]
}

const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
const opt = (name: string, color = 'blue') => ({ name, color })

describe('template metadata', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'other', U> = {} as never
  let spaceId = ''
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T
  async function invite(email: string): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'tpl-meta-pass-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'tpl-meta-pass-1')).cookie }
  }
  const getTpl = (who: U, id: string) => json<Tpl>(req(who, 'GET', `/templates/${id}`))
  const getEntry = (who: U, id: string) => json<Entry>(req(who, 'GET', `/entries/${id}`))
  const metas = async (who: U) =>
    (await json<{ items: Meta[] }>(req(who, 'GET', '/templates/fields'))).items
  const mkTpl = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/templates', { kind: 'note', body: doc, ...body })
    expect(r.status).toBe(201)
    return (await r.json()) as Tpl
  }
  const patchTpl = async (who: U, id: string, body: Record<string, unknown>) => {
    const cur = await getTpl(who, id)
    return req(who, 'PATCH', `/templates/${id}`, { ...body, ifUpdatedAt: cur.updatedAt })
  }
  const mkEntry = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/entries', { kind: 'note', title: 't', spaceId, ...body })
    expect(r.status).toBe(201)
    return getEntry(who, ((await r.json()) as { id: string }).id)
  }
  const keyOf = (t: { fieldDefs: FieldDef[] }, label: string) =>
    t.fieldDefs.find((d) => d.label === label)?.key ?? ''

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('tm-member@xz.local')
    u.other = await invite('tm-other@xz.local')
    const sp = await json<{ id: string }>(
      req(u.owner, 'POST', '/spaces', {
        name: 'tm-shared',
        slug: 'tm-shared',
        kind: 'project',
        visibility: 'workspace',
      }),
    )
    spaceId = sp.id
  })

  it('REQ-TPL-016 migrateExtraValues：删字段清值、选项改名、删选项（单选去键 / 多选去项）', () => {
    const prev: FieldDef[] = [
      { key: 'xAAAAAA', label: '作者', type: 'text' },
      { key: 'xBBBBBB', label: '阶段', type: 'select', options: [opt('读'), opt('停')] },
      { key: 'xCCCCCC', label: '主题', type: 'multiselect', options: [opt('a'), opt('b')] },
    ]
    const next: FieldDef[] = [
      { key: 'xBBBBBB', label: '阶段', type: 'select', options: [opt('在读')] },
      { key: 'xCCCCCC', label: '主题', type: 'multiselect', options: [opt('a')] },
    ]
    const out = migrateExtraValues(
      { xAAAAAA: '甲', xBBBBBB: '读', xCCCCCC: ['a', 'b'], status: 'new', xZZZZZZ: 1 },
      prev as never,
      next as never,
      { xBBBBBB: { 读: '在读' } },
    )
    expect(out).toEqual({ xBBBBBB: '在读', xCCCCCC: ['a'], status: 'new', xZZZZZZ: 1 })
    expect(
      migrateExtraValues({ xBBBBBB: '停', xCCCCCC: ['b'] }, prev as never, next as never),
    ).toEqual({})
  })

  it('REQ-TPL-016 成员给自己的模板增 / 改 / 删自有字段（不需要类型管理权限）；键由服务端生成，类型不可改，重名 422', async () => {
    // 增：临时键 xTMPAAA 只是句柄——服务端换成自己的键，并把同一请求里的预填值挪过去
    const t = await mkTpl(u.member, {
      name: '读书',
      fieldDefs: [
        { key: 'xTMPAAA', label: '作者', type: 'text' },
        { label: '阶段', type: 'select', options: [opt('想读'), opt('在读'), opt('读完')] },
      ],
      fields: { xTMPAAA: '鲁迅' },
    })
    expect(t.fieldDefs.map((d) => d.label)).toEqual(['作者', '阶段'])
    const author = keyOf(t, '作者')
    const stage = keyOf(t, '阶段')
    expect(author).toMatch(/^x[A-Z]{6}$/)
    expect(author).not.toBe('xTMPAAA')
    expect(t.fields).toEqual({ [author]: '鲁迅' })
    // 查：详情 / 列表都带定义
    expect((await getTpl(u.member, t.id)).fieldDefs).toHaveLength(2)
    const list = await json<{ items: Tpl[] }>(req(u.member, 'GET', '/templates'))
    expect(list.items.find((x) => x.id === t.id)?.fieldDefs).toHaveLength(2)
    // 改：改名、加必填、加一个字段；预填不合选项 → 422
    const p = await patchTpl(u.member, t.id, {
      fieldDefs: [
        { key: author, label: '著者', type: 'text', required: true },
        { key: stage, label: '阶段', type: 'select', options: [opt('想读'), opt('在读')] },
        { label: '评分', type: 'number' },
      ],
    })
    expect(p.status).toBe(200)
    const t2 = (await p.json()) as Tpl
    expect(t2.fieldDefs.map((d) => [d.label, !!d.required])).toEqual([
      ['著者', true],
      ['阶段', false],
      ['评分', false],
    ])
    expect(keyOf(t2, '著者')).toBe(author)
    const bad = await patchTpl(u.member, t.id, { fields: { [stage]: '读完' } })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe(`fields.${stage}`)
    // 类型不可改
    const retype = await patchTpl(u.member, t.id, {
      fieldDefs: [{ key: author, label: '著者', type: 'number' }],
    })
    expect(retype.status).toBe(422)
    // 同模板内重名
    const dup = await patchTpl(u.member, t.id, {
      fieldDefs: [
        { key: author, label: '著者', type: 'text' },
        { label: '著者', type: 'text' },
      ],
    })
    expect(dup.status).toBe(422)
    // 删：只留一个；被删字段的预填一并清掉
    const d = await patchTpl(u.member, t.id, {
      fieldDefs: [{ key: stage, label: '阶段', type: 'select', options: [opt('想读')] }],
    })
    expect(d.status).toBe(200)
    const t3 = (await d.json()) as Tpl
    expect(t3.fieldDefs.map((x) => x.key)).toEqual([stage])
    expect(t3.fields).toEqual({})
    // 别人改不了（个人模板对别人不可见）
    expect(
      (
        await req(u.other, 'PATCH', `/templates/${t.id}`, {
          fieldDefs: [],
          ifUpdatedAt: t3.updatedAt,
        })
      ).status,
    ).toBe(404)
  })

  it('REQ-TPL-016 自有字段不得与所绑类型的自定义字段重名；所有者可给代码内置模板加字段，恢复默认即清', async () => {
    const ty = await json<{ id: string; fieldDefs: FieldDef[] }>(
      req(u.member, 'POST', '/entry-types', {
        name: '读物',
        color: 'blue',
        fieldDefs: [{ label: '出版社', type: 'text' }],
      }),
    )
    const clash = await req(u.member, 'POST', '/templates', {
      name: '撞名',
      kind: 'custom',
      typeId: ty.id,
      body: doc,
      fieldDefs: [{ label: '出版社', type: 'text' }],
    })
    expect(clash.status).toBe(422)
    // 代码内置模板：成员 403；所有者可加
    expect(
      (
        await patchTpl(u.member, 'builtin:reading-note', {
          fieldDefs: [{ label: '作者', type: 'text' }],
        })
      ).status,
    ).toBe(403)
    const p = await patchTpl(u.owner, 'builtin:reading-note', {
      fieldDefs: [{ key: 'xTMPBBB', label: '作者', type: 'text' }],
      fields: { xTMPBBB: '佚名' },
    })
    expect(p.status).toBe(200)
    const b = (await p.json()) as Tpl
    const key = keyOf(b, '作者')
    expect(b).toMatchObject({ customized: true, fields: { [key]: '佚名' } })
    const e = await mkEntry(u.member, {
      templateId: 'builtin:reading-note',
      fields: { [key]: '老舍' },
    })
    expect(e).toMatchObject({ templateId: 'builtin:reading-note', fields: { [key]: '老舍' } })
    // 软删：定义仍对旧记录生效（目录里还在）
    expect((await req(u.owner, 'DELETE', '/templates/builtin:reading-note')).status).toBe(204)
    expect((await metas(u.member)).some((m) => m.id === 'builtin:reading-note')).toBe(true)
    expect((await getEntry(u.member, e.id)).fields[key]).toBe('老舍')
    // 恢复默认：自有字段没了，记录里的值清掉，来源模板保留
    expect((await req(u.owner, 'POST', '/templates/builtin:reading-note/reset')).status).toBe(200)
    const after = await getEntry(u.member, e.id)
    expect(after.templateId).toBe('builtin:reading-note')
    expect(after.fields[key]).toBeUndefined()
    expect((await getTpl(u.owner, 'builtin:reading-note')).fieldDefs).toEqual([])
  })

  it('REQ-TPL-017 移除类型字段：只认可移除的（必填 / 状态 / 优先级 / 严重度 / Bug 日期丢弃）；预填里被移除的清掉；换类型重置', async () => {
    const t = await mkTpl(u.member, {
      name: 'Bug 精简',
      kind: 'bug',
      fields: { status: 'new', severity: 'high', priority: 'p1', module: '编辑器', commit: 'abc' },
      hiddenFields: [
        'module',
        'commit',
        'debugDir',
        'status',
        'severity',
        'priority',
        'foundAt',
        'nope',
      ],
    })
    expect(t.hiddenFields.sort()).toEqual(['commit', 'debugDir', 'module'])
    expect(t.fields).toEqual({ status: 'new', severity: 'high', priority: 'p1' })
    // 恢复一个
    const p = await patchTpl(u.member, t.id, { hiddenFields: ['commit'] })
    expect(((await p.json()) as Tpl).hiddenFields).toEqual(['commit'])
    // 换类型且没给 hiddenFields → 清空
    const r = await patchTpl(u.member, t.id, { kind: 'plan' })
    expect(r.status).toBe(200)
    expect((await r.json()) as Tpl).toMatchObject({ kind: 'plan', hiddenFields: [] })
    // 类型的自定义字段也可移除
    const ty = await json<{ id: string; fieldDefs: FieldDef[] }>(
      req(u.member, 'POST', '/entry-types', {
        name: '需求',
        color: 'red',
        fieldDefs: [{ label: '环境', type: 'text' }],
      }),
    )
    const env = ty.fieldDefs[0]?.key ?? ''
    const c = await mkTpl(u.member, {
      name: '需求模板',
      kind: 'custom',
      typeId: ty.id,
      fields: { [env]: '生产' },
      hiddenFields: [env, 'dueDate'],
    })
    expect(c.hiddenFields.sort()).toEqual([env, 'dueDate'].sort())
    expect(c.fields[env]).toBeUndefined()
  })

  it('REQ-ENTRY-032 用模板新建的记录记下来源模板，自有字段值按定义校验；不带模板同键被丢弃；改类型 / 批量保留', async () => {
    const t = await mkTpl(u.member, {
      name: '会议纪要',
      scope: 'workspace',
      fieldDefs: [
        { label: '地点', type: 'text' },
        { label: '结论', type: 'select', options: [opt('通过'), opt('搁置')] },
      ],
    })
    const place = keyOf(t, '地点')
    const verdict = keyOf(t, '结论')
    const e = await mkEntry(u.other, {
      templateId: t.id,
      fields: { [place]: '三楼', [verdict]: '通过' },
    })
    expect(e).toMatchObject({ templateId: t.id, fields: { [place]: '三楼', [verdict]: '通过' } })
    // 列表也带 templateId
    const list = await json<{ items: Entry[] }>(req(u.other, 'GET', `/entries?spaceId=${spaceId}`))
    expect(list.items.find((x) => x.id === e.id)?.templateId).toBe(t.id)
    // 不带模板：同键不是该记录的字段 → 静默丢弃；builtin:blank 不算模板
    const plain = await mkEntry(u.other, { fields: { [place]: '三楼' } })
    expect(plain).toMatchObject({ templateId: null, fields: {} })
    expect((await mkEntry(u.other, { templateId: 'builtin:blank' })).templateId).toBeNull()
    // 选项不符 → 422
    const bad = await req(u.other, 'PATCH', `/entries/${e.id}`, {
      fields: { [verdict]: '否决' },
      ifUpdatedAt: e.updatedAt,
    })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe(`fields.${verdict}`)
    // 改类型：来源模板的字段值保留
    const r = await req(u.other, 'PATCH', `/entries/${e.id}`, {
      kind: 'decision',
      ifUpdatedAt: e.updatedAt,
    })
    expect(r.status).toBe(200)
    expect((await r.json()) as Entry).toMatchObject({
      kind: 'decision',
      templateId: t.id,
      fields: { status: 'proposed', [place]: '三楼', [verdict]: '通过' },
    })
    // 批量改状态走同一套校验：来源模板的字段值不被当作未定义键丢掉
    const b = await json<{ ok: string[]; failed: unknown[] }>(
      req(u.other, 'POST', '/entries/batch', {
        op: 'fields',
        ids: [e.id],
        set: { status: 'accepted' },
      }),
    )
    expect(b.ok).toEqual([e.id])
    expect((await getEntry(u.other, e.id)).fields).toEqual({
      status: 'accepted',
      [place]: '三楼',
      [verdict]: '通过',
    })
    expect((await getTpl(u.member, t.id)).entryCount).toBe(1)
  })

  it('REQ-TPL-018 改自有字段同步记录（选项改名 / 删选项 / 删字段，含回收站）并写审计；删模板清值、来源置空', async () => {
    const t = await mkTpl(u.member, {
      name: '同步',
      scope: 'workspace',
      fieldDefs: [
        { label: '阶段', type: 'select', options: [opt('读'), opt('停')] },
        { label: '主题', type: 'multiselect', options: [opt('a'), opt('b')] },
        { label: '备注', type: 'text' },
      ],
    })
    const [stage, topic, memo] = ['阶段', '主题', '备注'].map((l) => keyOf(t, l)) as [
      string,
      string,
      string,
    ]
    const a = await mkEntry(u.other, {
      templateId: t.id,
      fields: { [stage]: '读', [topic]: ['a', 'b'], [memo]: 'm' },
    })
    const trashed = await mkEntry(u.other, { templateId: t.id, fields: { [stage]: '停' } })
    expect((await req(u.other, 'DELETE', `/entries/${trashed.id}`)).status).toBe(204)
    // 另一条不是用它建的记录不受影响
    const p = await patchTpl(u.member, t.id, {
      fieldDefs: [
        { key: stage, label: '阶段', type: 'select', options: [opt('在读')] },
        { key: topic, label: '主题', type: 'multiselect', options: [opt('a')] },
      ],
      optionRenames: { [stage]: { 读: '在读' } },
    })
    expect(p.status).toBe(200)
    expect((await getEntry(u.other, a.id)).fields).toEqual({ [stage]: '在读', [topic]: ['a'] })
    const [row] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'template.fields_changed'), eq(auditLog.targetId, t.id)))
    expect(row).toMatchObject({ targetType: 'template', targetId: t.id })
    // 删模板：自有字段值清掉（含回收站里的），来源置空
    expect((await req(u.member, 'DELETE', `/templates/${t.id}`)).status).toBe(204)
    expect(await getEntry(u.other, a.id)).toMatchObject({ templateId: null, fields: {} })
    expect((await req(u.other, 'POST', `/entries/${trashed.id}/restore`)).status).toBe(200)
    expect(await getEntry(u.other, trashed.id)).toMatchObject({ templateId: null, fields: {} })
  })

  it('REQ-TPL-019 元数据目录：别人的个人模板只有在读者看得到用它建的记录时才出现；复制 / 另存沿用定义；类型删除后自有字段保留', async () => {
    const ty = await json<{ id: string }>(
      req(u.member, 'POST', '/entry-types', { name: '临时类型', color: 'green' }),
    )
    const t = await mkTpl(u.member, {
      name: '私有',
      kind: 'custom',
      typeId: ty.id,
      fieldDefs: [{ key: 'xTMPCCC', label: '来源', type: 'text' }],
      fields: { xTMPCCC: '网络' },
      hiddenFields: ['dueDate'],
    })
    const src = keyOf(t, '来源')
    expect((await metas(u.member)).find((m) => m.id === t.id)).toMatchObject({
      kind: 'custom',
      typeId: ty.id,
      hiddenFields: ['dueDate'],
    })
    // 别人：看不到模板，也没有可读记录引用它 → 目录里没有
    expect((await req(u.other, 'GET', `/templates/${t.id}`)).status).toBe(404)
    expect((await metas(u.other)).some((m) => m.id === t.id)).toBe(false)
    // 成员在共享空间用它建记录 → 别人读得到记录，就拿得到定义（仍读不到模板本身）
    const e = await mkEntry(u.member, {
      kind: 'custom',
      typeId: ty.id,
      templateId: t.id,
      fields: { [src]: '书' },
    })
    expect((await metas(u.other)).find((m) => m.id === t.id)?.fieldDefs[0]?.label).toBe('来源')
    expect((await req(u.other, 'GET', `/templates/${t.id}`)).status).toBe(404)
    // 另存为模板：沿用该记录来源模板的定义与值
    const saved = await json<Tpl>(
      req(u.member, 'POST', '/templates', { name: '另存', fromEntryId: e.id }),
    )
    expect(saved.fieldDefs.map((d) => d.key)).toEqual([src])
    expect(saved).toMatchObject({ hiddenFields: ['dueDate'], fields: { [src]: '书' } })
    // 复制到我的：键不变
    const copy = await json<Tpl>(
      req(u.member, 'POST', '/templates', { name: '副本', fromTemplateId: t.id }),
    )
    expect(copy.fieldDefs.map((d) => d.key)).toEqual([src])
    expect(copy.fields[src]).toBe('网络')
    // 删类型：模板转随笔，移除清单清空，自有字段与其预填保留；记录转随笔后值仍在
    expect((await req(u.member, 'DELETE', `/entry-types/${ty.id}`)).status).toBe(204)
    const [row] = await getDb().select().from(entryTemplates).where(eq(entryTemplates.id, t.id))
    expect(row).toMatchObject({
      kind: 'note',
      typeId: null,
      hiddenFields: [],
      fields: { [src]: '网络' },
    })
    expect(row?.fieldDefs.map((d) => d.key)).toEqual([src])
    expect(await getEntry(u.member, e.id)).toMatchObject({
      kind: 'note',
      templateId: t.id,
      fields: { [src]: '书' },
    })
  })

  it('REQ-ENTRY-033 按模板属性筛选与分组（列表 fields= / stats groupBy）；目录带模板名，读不到的模板不给名字', async () => {
    const t = await mkTpl(u.member, {
      name: '周报',
      fieldDefs: [
        { label: '进展', type: 'select', options: [opt('顺利'), opt('受阻')] },
        { label: '涉及', type: 'multiselect', options: [opt('前端'), opt('后端')] },
      ],
    })
    const prog = keyOf(t, '进展')
    const area = keyOf(t, '涉及')
    const a = await mkEntry(u.member, {
      templateId: t.id,
      title: 'w1',
      fields: { [prog]: '顺利', [area]: ['前端', '后端'] },
    })
    const b = await mkEntry(u.member, {
      templateId: t.id,
      title: 'w2',
      fields: { [prog]: '受阻', [area]: ['后端'] },
    })
    const c = await mkEntry(u.member, { templateId: t.id, title: 'w3' })
    const list = async (fields: string) =>
      (
        await json<{ items: Entry[] }>(
          req(
            u.other,
            'GET',
            `/entries?spaceId=${spaceId}&kind=note&fields=${encodeURIComponent(fields)}`,
          ),
        )
      ).items
        .map((e) => e.id)
        .sort()
    expect(await list(`${prog}=顺利`)).toEqual([a.id])
    expect(await list(`${area}=后端`)).toEqual([a.id, b.id].sort())
    expect(await list(`${prog}=受阻,${area}=前端`)).toEqual([])
    const stats = await json<{
      total: number
      groups: { values: Record<string, string | null>; n: number }[]
    }>(req(u.other, 'GET', `/entries/stats?spaceId=${spaceId}&kind=note&groupBy=${prog}`))
    const by = new Map(stats.groups.map((g) => [g.values[prog] ?? '', g.n]))
    expect(by.get('顺利')).toBe(1)
    expect(by.get('受阻')).toBe(1)
    expect(by.get('') ?? 0).toBeGreaterThanOrEqual(1)
    expect(c.templateId).toBe(t.id)
    // 目录：作者拿得到模板名；别人只因看得到记录才拿到定义，名字为 null
    expect((await metas(u.member)).find((m) => m.id === t.id)?.name).toBe('周报')
    expect((await metas(u.other)).find((m) => m.id === t.id)).toMatchObject({ name: null })
    // 共享后别人也拿得到名字
    expect((await patchTpl(u.member, t.id, { scope: 'workspace' })).status).toBe(200)
    expect((await metas(u.other)).find((m) => m.id === t.id)?.name).toBe('周报')
  })
})

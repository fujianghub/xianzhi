/** ADR-0033 Bug 跟踪（REQ-BUG-001 ~ 009，api 层）。 */
import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { formatLocalDate, localDateOf } from '../../shared/tz.ts'
import { db, truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface Entry {
  id: string
  title: string
  kind: string
  fields: Record<string, unknown>
  updatedAt: string
}

const today = () => formatLocalDate(localDateOf('Asia/Shanghai', new Date()))

describe('ADR-0033 bug tracking', () => {
  let app: App
  const u: Record<'owner' | 'member', U> = {} as never
  let spaceId = ''
  let otherSpaceId = ''
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  async function invite(email: string): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'bug-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'bug-password-1')).cookie }
  }
  const bug = async (title: string, fields: Record<string, unknown> = {}, sid = spaceId) => {
    const r = await req(u.owner, 'POST', '/entries', {
      kind: 'bug',
      title,
      spaceId: sid,
      fields: { status: 'new', severity: 'medium', ...fields },
    })
    expect(r.status, await r.clone().text()).toBe(201)
    return ((await r.json()) as { id: string }).id
  }
  const get = async (id: string) =>
    (await (await req(u.owner, 'GET', `/entries/${id}`)).json()) as Entry
  const patchFields = async (id: string, fields: Record<string, unknown>) => {
    const cur = await get(id)
    return req(u.owner, 'PATCH', `/entries/${id}`, {
      fields: { ...cur.fields, ...fields },
      ifUpdatedAt: cur.updatedAt,
    })
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('bugm@xz.local')
    const s = await req(u.owner, 'POST', '/spaces', { name: 'Bug', slug: 'bug-s', kind: 'project' })
    spaceId = ((await s.json()) as { id: string }).id
    // 仅成员可见、member 不在其中的空间：统计不应计入其记录
    const o = await req(u.owner, 'POST', '/spaces', {
      name: '私有',
      slug: 'bug-private',
      kind: 'project',
      visibility: 'members',
    })
    otherSpaceId = ((await o.json()) as { id: string }).id
  })

  it('REQ-BUG-001 四态状态与优先级：缺省 priority=p2、status 须 ∈ new|pending|fixed|wontfix、module 不含分隔符', async () => {
    const id = await bug('登录页白屏')
    expect((await get(id)).fields).toMatchObject({
      status: 'new',
      priority: 'p2',
      severity: 'medium',
    })
    const bad = await req(u.owner, 'POST', '/entries', {
      kind: 'bug',
      title: 'x',
      spaceId,
      fields: { status: 'open', severity: 'low' },
    })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe('fields.status')
    const mod = await req(u.owner, 'POST', '/entries', {
      kind: 'bug',
      title: 'x',
      spaceId,
      fields: { status: 'new', severity: 'low', module: 'a,b' },
    })
    expect(mod.status).toBe(422)
    const pending = await bug('要不要支持 IE', { status: 'pending', priority: 'p3' })
    expect((await get(pending)).fields).toMatchObject({ status: 'pending', priority: 'p3' })
  })

  it('REQ-BUG-002 发现日期缺省今天、不能晚于今天；进入已关闭写 resolvedAt，重开清除；保持已关闭沿用；从别的类型改来取创建日', async () => {
    const id = await bug('导出乱码')
    expect((await get(id)).fields.foundAt).toBe(today())
    expect((await get(id)).fields.resolvedAt).toBeUndefined()
    const future = await req(u.owner, 'POST', '/entries', {
      kind: 'bug',
      title: 'x',
      spaceId,
      fields: { status: 'new', severity: 'low', foundAt: '2999-01-01' },
    })
    expect(future.status).toBe(422)
    expect((await problemOf(future)).errors?.[0]?.path).toBe('fields.foundAt')

    expect((await patchFields(id, { status: 'fixed' })).status).toBe(200)
    expect((await get(id)).fields.resolvedAt).toBe(today())
    // 显式改解决日期并保持已关闭：沿用给出值；省略：沿用原值
    expect(
      (await patchFields(id, { foundAt: '2026-01-01', resolvedAt: '2026-01-05' })).status,
    ).toBe(200)
    const cur = await get(id)
    const { resolvedAt: _drop, ...noResolved } = cur.fields
    await req(u.owner, 'PATCH', `/entries/${id}`, {
      fields: noResolved,
      ifUpdatedAt: cur.updatedAt,
    })
    expect((await get(id)).fields.resolvedAt).toBe('2026-01-05')
    // 重开 → 清除；解决日期早于发现日期 → 422
    expect((await patchFields(id, { status: 'new' })).status).toBe(200)
    expect((await get(id)).fields.resolvedAt).toBeUndefined()
    const inv = await patchFields(id, { status: 'wontfix', resolvedAt: '2025-12-31' })
    expect(inv.status).toBe(422)

    // 随笔改为 Bug：发现日期 = 创建日（今天），缺省优先级
    const n = await req(u.owner, 'POST', '/entries', { kind: 'note', title: '随手', spaceId })
    const nid = ((await n.json()) as { id: string }).id
    const ncur = await get(nid)
    const r = await req(u.owner, 'PATCH', `/entries/${nid}`, {
      kind: 'bug',
      ifUpdatedAt: ncur.updatedAt,
    })
    expect(r.status).toBe(200)
    expect((await get(nid)).fields).toMatchObject({
      status: 'new',
      priority: 'p2',
      foundAt: today(),
    })
    // 批量改优先级
    const b = await req(u.owner, 'POST', '/entries/batch', {
      op: 'fields',
      ids: [nid],
      set: { priority: 'p0' },
    })
    expect(((await b.json()) as { ok: string[] }).ok).toEqual([nid])
    expect((await get(nid)).fields.priority).toBe('p0')
  })

  it('REQ-BUG-003 按优先级 / 发现日期排序，游标翻页不丢行（缺值排最后）', async () => {
    await truncateEntries()
    await bug('P3', { priority: 'p3', foundAt: '2026-09-01' })
    await bug('P0', { priority: 'p0', foundAt: '2026-09-03' })
    await bug('P1', { priority: 'p1', foundAt: '2026-09-02' })
    await req(u.owner, 'POST', '/entries', { kind: 'note', title: '随笔', spaceId })
    const titles = async (sort: string) => {
      const out: string[] = []
      let cursor: string | null = null
      do {
        const q: string = `/entries?spaceId=${spaceId}&sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ''}`
        const page = (await (await req(u.owner, 'GET', q)).json()) as {
          items: Entry[]
          nextCursor: string | null
        }
        out.push(...page.items.map((e) => e.title))
        cursor = page.nextCursor
      } while (cursor)
      return out
    }
    expect(await titles('priority')).toEqual(['P0', 'P1', 'P3', '随笔'])
    expect(await titles('-foundAt')).toEqual(['P0', 'P1', 'P3', '随笔'])
  })

  it('REQ-BUG-004 GET /entries/stats：与列表同口径分组计数；不可见空间的记录不计入', async () => {
    await truncateEntries()
    await bug('a', { priority: 'p0', module: '登录' })
    await bug('b', { priority: 'p0', status: 'fixed', module: '登录' })
    await bug('c', { priority: 'p2', module: '导出' })
    await bug('d', { priority: 'p1' })
    await bug('私有空间里的', { priority: 'p0' }, otherSpaceId)
    const stats = async (who: U, q: string) =>
      (await (await req(who, 'GET', `/entries/stats?kind=bug&${q}`)).json()) as {
        total: number
        groups: { values: Record<string, string | null>; n: number }[]
      }
    const byPri = await stats(u.owner, `spaceId=${spaceId}&groupBy=priority`)
    expect(byPri.total).toBe(4)
    expect(byPri.groups).toContainEqual({ values: { priority: 'p0' }, n: 2 })
    const open = await stats(u.owner, `spaceId=${spaceId}&fields=status=new|pending&groupBy=module`)
    expect(open.total).toBe(3)
    expect(open.groups).toContainEqual({ values: { module: null }, n: 1 })
    const cross = await stats(u.owner, `spaceId=${spaceId}&groupBy=status,priority`)
    expect(cross.groups).toContainEqual({ values: { status: 'fixed', priority: 'p0' }, n: 1 })
    // 跨空间：owner 看得到私有空间，member 看不到
    expect((await stats(u.owner, 'groupBy=priority')).total).toBe(5)
    expect((await stats(u.member, 'groupBy=priority')).total).toBe(4)
    const bad = await req(u.owner, 'GET', '/entries/stats?groupBy=a-b')
    expect(bad.status).toBe(422)
  })

  it('REQ-BUG-006 status / priority / severity 变化记入流转，新建为起点；不可见 404', async () => {
    const id = await bug('流转', { priority: 'p1' })
    await patchFields(id, { status: 'pending' })
    await patchFields(id, { status: 'fixed', priority: 'p0' })
    await patchFields(id, { module: '只改模块' }) // 不跟踪
    const r = await req(u.owner, 'GET', `/entries/${id}/field-changes`)
    expect(r.status).toBe(200)
    const items = (
      (await r.json()) as { items: { field: string; from: string | null; to: string | null }[] }
    ).items
    expect(items.map((i) => `${i.field}:${i.from ?? '-'}>${i.to ?? '-'}`)).toEqual([
      'status:->new',
      'priority:->p1',
      'severity:->medium',
      'status:new>pending',
      'status:pending>fixed',
      'priority:p1>p0',
    ])
    const hidden = await bug('私有', {}, otherSpaceId)
    expect((await req(u.member, 'GET', `/entries/${hidden}/field-changes`)).status).toBe(404)
  })

  it('REQ-BUG-007 GET /entries/bug-stats：按周分桶的新增 / 关闭 / 存量、按优先级修复天数、账龄、重开次数', async () => {
    await truncateEntries()
    await bug('A', {
      priority: 'p0',
      foundAt: '2026-09-01',
      status: 'fixed',
      resolvedAt: '2026-09-03',
    })
    await bug('B', { priority: 'p1', foundAt: '2026-09-02' })
    const c = await bug('C', {
      priority: 'p0',
      foundAt: '2026-09-08',
      status: 'fixed',
      resolvedAt: '2026-09-12',
    })
    await bug('D', {
      priority: 'p2',
      foundAt: '2026-08-20',
      status: 'wontfix',
      resolvedAt: '2026-09-09',
    })
    await bug('别的空间', { foundAt: '2026-09-01' }, otherSpaceId)
    const r = await req(
      u.owner,
      'GET',
      `/entries/bug-stats?spaceId=${spaceId}&from=2026-08-31&to=2026-09-13&bucket=week`,
    )
    expect(r.status, await r.clone().text()).toBe(200)
    const s = (await r.json()) as {
      summary: Record<string, number>
      trend: { start: string; created: number; resolved: number; open: number }[]
      mttr: { priority: string; n: number; avgDays: number; medianDays: number }[]
      aging: { key: string; n: number }[]
    }
    // 周一起始（默认 weekStartsOn = 1）：两个桶
    expect(s.trend).toEqual([
      { start: '2026-08-31', created: 2, resolved: 1, open: 2 },
      { start: '2026-09-07', created: 1, resolved: 2, open: 1 },
    ])
    expect(s.mttr.find((m) => m.priority === 'p0')).toEqual({
      priority: 'p0',
      n: 2,
      avgDays: 3,
      medianDays: 3,
    })
    expect(s.summary).toMatchObject({ total: 4, open: 1, p0Open: 0, closedInRange: 3 })
    expect(s.aging.reduce((a, x) => a + x.n, 0)).toBe(1)
    // 重开一次（今天发生）：默认区间（近 12 周）计入
    await patchFields(c, { status: 'new' })
    const d = (await (
      await req(u.owner, 'GET', `/entries/bug-stats?spaceId=${spaceId}`)
    ).json()) as {
      summary: Record<string, number>
      trend: unknown[]
    }
    expect(d.summary.reopened).toBe(1)
    expect(d.trend.length).toBeGreaterThanOrEqual(12)
    // 区间过长 → 422
    const long = await req(u.owner, 'GET', '/entries/bug-stats?from=2020-01-01&to=2026-09-01')
    expect(long.status).toBe(422)
  })

  it('REQ-BUG-009 保存视图：个人所有（他人 404）、search 走白名单清洗、空间视图须可读、改名 / 覆盖 / 删除', async () => {
    const r = await req(u.owner, 'POST', '/entry-views', {
      name: 'P0 未关闭',
      search: {
        kind: 'bug',
        fields: 'status=new|pending,priority=p0',
        view: 'table',
        evil: 'x',
        select: '1',
      },
    })
    expect(r.status, await r.clone().text()).toBe(201)
    const v = (await r.json()) as { id: string; search: Record<string, string> }
    expect(v.search).toEqual({
      kind: 'bug',
      fields: 'status=new|pending,priority=p0',
      view: 'table',
    })
    const list = async (who: U) =>
      (
        (await (await req(who, 'GET', '/entry-views')).json()) as {
          items: { id: string; name: string }[]
        }
      ).items
    expect((await list(u.owner)).map((x) => x.name)).toEqual(['P0 未关闭'])
    expect(await list(u.member)).toEqual([])
    expect((await req(u.member, 'PATCH', `/entry-views/${v.id}`, { name: '偷改' })).status).toBe(
      404,
    )
    expect((await req(u.member, 'DELETE', `/entry-views/${v.id}`)).status).toBe(404)
    // 清洗后为空 → 422；看不到的空间 → 404
    expect(
      (await req(u.owner, 'POST', '/entry-views', { name: 'x', search: { evil: 1 } })).status,
    ).toBe(422)
    const hidden = await req(u.member, 'POST', '/entry-views', {
      name: 'x',
      spaceId: otherSpaceId,
      search: { kind: 'bug' },
    })
    expect(hidden.status).toBe(404)
    // 空间视图：search 里的 spaceId 被忽略
    const sv = await req(u.owner, 'POST', '/entry-views', {
      name: '本空间 Bug',
      spaceId,
      search: { kind: 'bug', spaceId: otherSpaceId },
    })
    expect(((await sv.json()) as { search: Record<string, string> }).search).toEqual({
      kind: 'bug',
    })
    const p = await req(u.owner, 'PATCH', `/entry-views/${v.id}`, {
      name: 'P0',
      search: { kind: 'bug', group: 'priority' },
    })
    expect(((await p.json()) as { name: string; search: unknown }).search).toEqual({
      kind: 'bug',
      group: 'priority',
    })
    expect((await req(u.owner, 'DELETE', `/entry-views/${v.id}`)).status).toBe(204)
    expect((await list(u.owner)).map((x) => x.name)).toEqual(['本空间 Bug'])
  })

  /** 本文件内清空记录（保留用户 / 空间）：按标题断言的用例互不干扰 */
  async function truncateEntries() {
    await db().execute(sql`delete from entries`)
  }
})

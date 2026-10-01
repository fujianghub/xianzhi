/** ADR-0044 个人清单（REQ-TASK-029 · 030 · 031）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { dayRange } from '../../shared/tz.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface L {
  id: string
  kind: string
  name: string
  color: string | null
  parentId: string | null
}
interface T {
  id: string
  title: string
  updatedAt: string
  list: { id: string; name: string; color: string } | null
}

describe('task lists', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'guest', U> = {} as never
  let spaceId = ''
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const mk = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/task-lists', body)
    expect(r.status, await r.clone().text()).toBe(201)
    return (await r.json()) as L
  }
  const lists = async (who: U) =>
    ((await (await req(who, 'GET', '/task-lists')).json()) as { items: L[] }).items
  const task = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/tasks', { spaceId, ...body })
    expect(r.status, await r.clone().text()).toBe(201)
    return (await r.json()) as T
  }
  const get = async (who: U, id: string) =>
    (await (await req(who, 'GET', `/tasks/${id}`)).json()) as T
  const ids = async (who: U, qs: string) =>
    ((await (await req(who, 'GET', `/tasks?${qs}`)).json()) as { items: T[] }).items.map(
      (x) => x.id,
    )
  async function invite(email: string, role: 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'list-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'list-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('tlm@xz.local', 'member')
    u.guest = await invite('tlg@xz.local', 'guest')
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'TL',
      slug: 'tl-s',
      kind: 'work',
      visibility: 'workspace',
    })
    spaceId = ((await s.json()) as { id: string }).id
    await req(u.owner, 'POST', `/spaces/${spaceId}/members`, {
      userId: u.member.id,
      role: 'member',
    })
  })

  it('REQ-TASK-029 清单 / 文件夹：本人新建、同名 409、文件夹无色且不能嵌套、清单可放进文件夹并排序；别人看不到也改不了；guest 403', async () => {
    const life = await mk(u.owner, { name: '生活', color: 'green' })
    expect(life).toMatchObject({ kind: 'list', color: 'green', parentId: null })
    expect((await req(u.owner, 'POST', '/task-lists', { name: '生活' })).status).toBe(409)
    const work = await mk(u.owner, { kind: 'folder', name: '工作' })
    expect(work.color).toBeNull()
    expect(
      (await req(u.owner, 'POST', '/task-lists', { kind: 'folder', name: 'x', parentId: work.id }))
        .status,
    ).toBe(422)
    const a = await mk(u.owner, { name: '产品', parentId: work.id })
    const b = await mk(u.owner, { name: '运营', parentId: work.id })
    // b 排到最前
    const p = await req(u.owner, 'PATCH', `/task-lists/${b.id}`, { after: null })
    expect(p.status).toBe(200)
    const mine = await lists(u.owner)
    const kids = mine.filter((x) => x.parentId === work.id).map((x) => x.id)
    expect(kids).toEqual([b.id, a.id])
    // 清单不能放进清单
    expect((await req(u.owner, 'PATCH', `/task-lists/${a.id}`, { parentId: life.id })).status).toBe(
      422,
    )
    expect(await lists(u.member)).toEqual([])
    expect((await req(u.member, 'PATCH', `/task-lists/${life.id}`, { name: '偷改' })).status).toBe(
      404,
    )
    expect((await req(u.member, 'DELETE', `/task-lists/${life.id}`)).status).toBe(404)
    expect((await req(u.guest, 'POST', '/task-lists', { name: '访客' })).status).toBe(403)
    // 删文件夹 → 其下清单回到根
    expect((await req(u.owner, 'DELETE', `/task-lists/${work.id}`)).status).toBe(204)
    const after = await lists(u.owner)
    expect(after.find((x) => x.id === a.id)?.parentId).toBeNull()
    expect(after.some((x) => x.id === work.id)).toBe(false)
  })

  it('REQ-TASK-030 归类按人：各人各归各的、互不覆盖；只归不改 updatedAt；别人的清单 422；listId 筛选与未归类；删清单任务仍在', async () => {
    const mine = await mk(u.owner, { name: '购物', color: 'orange' })
    const theirs = await mk(u.member, { name: '成员的', color: 'blue' })
    const t = await task(u.owner, { title: '买菜', listId: mine.id, assigneeId: u.member.id })
    expect(t.list).toMatchObject({ id: mine.id, name: '购物' })
    // 成员读同一任务看不到别人的清单
    expect((await get(u.member, t.id)).list).toBeNull()
    // 成员把它归进自己的清单，不影响主人
    const before = await get(u.owner, t.id)
    const r = await req(u.member, 'PATCH', `/tasks/${t.id}`, {
      listId: theirs.id,
      ifUpdatedAt: '2000-01-01T00:00:00.000Z', // 只归类：不查乐观锁
    })
    expect(r.status).toBe(200)
    expect(((await r.json()) as T).list?.id).toBe(theirs.id)
    const ownerView = await get(u.owner, t.id)
    expect(ownerView.list?.id).toBe(mine.id)
    expect(ownerView.updatedAt).toBe(before.updatedAt)
    // 成员清空自己的归类也不动主人的
    await req(u.member, 'PATCH', `/tasks/${t.id}`, { listId: null, ifUpdatedAt: before.updatedAt })
    expect((await get(u.owner, t.id)).list?.id).toBe(mine.id)
    // 别人的清单 → 422
    const bad = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      listId: theirs.id,
      ifUpdatedAt: before.updatedAt,
    })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.map((e) => e.path)).toContain('listId')
    // 筛选
    const loose = await task(u.owner, { title: '未归类的' })
    expect(await ids(u.owner, `view=mine&listId=${mine.id}`)).toEqual([t.id])
    const none = await ids(u.owner, 'view=mine&listId=none')
    expect(none).toContain(loose.id)
    expect(none).not.toContain(t.id)
    // 别人的清单 id 作筛选 → 空（不泄露）
    expect(await ids(u.owner, `view=mine&listId=${theirs.id}`)).toEqual([])
    // 删清单：任务还在，回到未归类
    expect((await req(u.owner, 'DELETE', `/task-lists/${mine.id}`)).status).toBe(204)
    expect((await get(u.owner, t.id)).list).toBeNull()
    expect(await ids(u.owner, `view=mine&listId=${mine.id}`)).toEqual([])
  })

  it('REQ-TASK-031 计数与智能清单：今天（同今日口径）/ 明天 / 最近 7 天 / 逾期 / 未归类 / 各清单，边界按用户时区；due=tomorrow|next7 筛选同口径', async () => {
    const who = await invite('tlc@xz.local', 'member')
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'TC',
      slug: 'tc-s',
      kind: 'work',
      visibility: 'workspace',
    })
    const sid = ((await s.json()) as { id: string }).id
    await req(u.owner, 'POST', `/spaces/${sid}/members`, { userId: who.id, role: 'member' })
    const { start } = dayRange('Asia/Shanghai', new Date())
    const at = (days: number, hours = 12) =>
      new Date(start.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString()
    const l = await mk(who, { name: '学习', color: 'purple' })
    const mkT = (title: string, extra: Record<string, unknown>) =>
      req(who, 'POST', '/tasks', { spaceId: sid, title, status: 'todo', ...extra })
    const overdue = await (await mkT('逾期', { dueAt: at(-2) })).json()
    await mkT('今天', { dueAt: at(0), listId: l.id })
    const tomorrow = await (await mkT('明天', { dueAt: at(1) })).json()
    await mkT('第六天', { dueAt: at(6) })
    await mkT('第八天', { dueAt: at(8) })
    await mkT('无日期', {})
    await mkT('已完成', { status: 'done', dueAt: at(0) })
    const c = (await (await req(who, 'GET', '/tasks/counts')).json()) as Record<string, unknown>
    expect(c).toMatchObject({
      all: 6,
      today: 2,
      tomorrow: 1,
      next7: 4,
      overdue: 1,
      unlisted: 5,
      lists: { [l.id]: 1 },
    })
    expect(await ids(who, 'view=mine&due=tomorrow')).toEqual([(tomorrow as T).id])
    const n7 = await ids(who, 'view=mine&due=next7&sort=dueAt')
    expect(n7.length).toBe(4)
    expect(n7[0]).toBe((overdue as T).id)
  })
})

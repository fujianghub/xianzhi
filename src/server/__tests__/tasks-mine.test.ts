/** ADR-0043 任务页：`GET /tasks?view=mine`（REQ-TASK-025）与快速添加带优先级 / 标签 / 截止（REQ-TASK-026）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface T {
  id: string
  title: string
  status: string
  dueAt: string | null
  priority: number
  parentId: string | null
  hasDescription: boolean
  tags?: { name: string }[]
}

describe('tasks view=mine', () => {
  let app: App
  const u: Record<'owner' | 'member', U> = {} as never
  let spaceId = ''
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/tasks', { spaceId, ...body })
    expect(r.status, await r.clone().text()).toBe(201)
    return (await r.json()) as T
  }
  const list = async (who: U, qs: string) =>
    ((await (await req(who, 'GET', `/tasks?${qs}`)).json()) as { items: T[] }).items

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    const inv = await req(u.owner, 'POST', '/workspace/invitations', {
      email: 'tm@xz.local',
      role: 'member',
    })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'tm@xz.local', name: 'tm', password: 'type-password-1' }),
    })
    u.member = {
      id: ((await acc.json()) as { userId: string }).userId,
      cookie: (await signIn(app, 'tm@xz.local', 'type-password-1')).cookie,
    }
    const s = await req(u.owner, 'POST', '/spaces', {
      name: 'TM',
      slug: 'tm-s',
      kind: 'work',
      visibility: 'workspace',
    })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-TASK-025 view=mine：我创建未指派的 + 指派给我的顶层任务；不含别人的、子任务；可叠加 status，按截止升序、无截止在后', async () => {
    const later = await create(u.owner, { title: '以后', dueAt: '2030-01-02T00:00:00.000Z' })
    const noDue = await create(u.owner, { title: '无日期' })
    const soon = await create(u.owner, { title: '很快', dueAt: '2030-01-01T00:00:00.000Z' })
    await create(u.owner, { title: '子任务', parentId: soon.id })
    await create(u.owner, { title: '给别人', assigneeId: u.member.id })
    const forMe = await create(u.member, { title: '给我', assigneeId: u.owner.id })
    await create(u.member, { title: '别人的' })
    const done = await create(u.owner, { title: '做完了', status: 'done' })

    const open = await list(u.owner, 'view=mine&status=inbox,todo,doing,blocked&sort=dueAt')
    // 有截止的按截止升序在前，无截止的在后（其间顺序不定）
    expect(open.slice(0, 2).map((x) => x.id)).toEqual([soon.id, later.id])
    expect(new Set(open.slice(2).map((x) => x.id))).toEqual(new Set([forMe.id, noDue.id]))
    expect(open.every((x) => x.parentId === null)).toBe(true)
    const doneList = await list(u.owner, 'view=mine&status=done')
    expect(doneList.map((x) => x.id)).toEqual([done.id])
  })

  it('REQ-TASK-026 快速添加一次建好：优先级、标签、截止；列表带 hasDescription', async () => {
    const tag = await req(u.owner, 'POST', '/tags', { name: '生活', color: 'green' })
    const tagId = ((await tag.json()) as { id: string }).id
    const t = await create(u.owner, {
      title: '买牛奶',
      status: 'todo',
      priority: 3,
      tagIds: [tagId],
      dueAt: '2030-02-01T15:59:00.000Z',
    })
    expect(t).toMatchObject({ priority: 3, dueAt: '2030-02-01T15:59:00.000Z', status: 'todo' })
    const row = (await list(u.owner, 'view=mine&tag=生活')).find((x) => x.id === t.id)
    expect(row?.hasDescription).toBe(false)
  })

  it('REQ-UI-022 只改标题的 PATCH 不动状态与优先级（patch schema 无默认值回归）', async () => {
    const t = await create(u.owner, { title: '改名前', status: 'doing', priority: 3 })
    const cur = (await (await req(u.owner, 'GET', `/tasks/${t.id}`)).json()) as {
      updatedAt: string
    }
    const r = await req(u.owner, 'PATCH', `/tasks/${t.id}`, {
      title: '改名后',
      ifUpdatedAt: cur.updatedAt,
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ title: '改名后', status: 'doing', priority: 3 })
  })

  it('REQ-TASK-041 批量撤销：delete → restore 恢复；complete → uncomplete 回到完成前状态；uncomplete 对已非完成态幂等（不 409、不回滚整批）', async () => {
    const a = await create(u.owner, { title: '批量甲', status: 'doing' })
    const b = await create(u.owner, { title: '批量乙', status: 'todo' })
    const batch = (ops: unknown[]) => req(u.owner, 'POST', '/tasks/batch', { ops })
    expect(
      (
        await batch([
          { op: 'delete', id: a.id },
          { op: 'delete', id: b.id },
        ])
      ).status,
    ).toBe(200)
    expect((await req(u.owner, 'GET', `/tasks/${a.id}`)).status).toBe(404)
    expect(
      (
        await batch([
          { op: 'restore', id: a.id },
          { op: 'restore', id: b.id },
        ])
      ).status,
    ).toBe(200)
    expect((await req(u.owner, 'GET', `/tasks/${a.id}`)).status).toBe(200)

    expect(
      (
        await batch([
          { op: 'complete', id: a.id },
          { op: 'complete', id: b.id },
        ])
      ).status,
    ).toBe(200)
    // b 先被单独取消完成；批量 uncomplete 里它已非完成态 → 跳过，整批仍成功
    expect((await req(u.owner, 'POST', `/tasks/${b.id}/uncomplete`)).status).toBe(200)
    const r = await batch([
      { op: 'uncomplete', id: a.id },
      { op: 'uncomplete', id: b.id },
    ])
    expect(r.status).toBe(200)
    const get = async (id: string) =>
      ((await (await req(u.owner, 'GET', `/tasks/${id}`)).json()) as { status: string }).status
    expect(await get(a.id)).toBe('doing')
    expect(await get(b.id)).toBe('todo')
  })
})

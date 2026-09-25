/** ADR-0012 目录树（REQ-KB-005）与类型视图过滤（REQ-KB-004）。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface Node {
  id: string
  title: string
  parentId: string | null
  treeOrder: string
}

describe('entry tree', () => {
  let app: App
  let cookie = ''
  let spaceId = ''
  const req = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: jsonHeaders({ cookie }) })
  const create = async (title: string, extra: Record<string, unknown> = {}) => {
    const r = await req('/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({ kind: 'note', title, spaceId, ...extra }),
    })
    expect(r.status, await r.clone().text()).toBe(201)
    return ((await r.json()) as { id: string }).id
  }
  const tree = async () => {
    const nodes = (
      (await (await req(`/api/v1/spaces/${spaceId}/tree`)).json()) as { items: Node[] }
    ).items
    // 服务端返回扁平列表（前端组树）：按父子深度优先展开成「父标题>标题」便于断言
    const title = (id: string | null) => nodes.find((n) => n.id === id)?.title ?? null
    const out: string[] = []
    const walk = (parent: string | null) => {
      for (const n of nodes
        .filter((x) => x.parentId === parent)
        .sort((x, y) => (x.treeOrder < y.treeOrder ? -1 : x.treeOrder > y.treeOrder ? 1 : 0))) {
        out.push(`${title(n.parentId) ?? '-'}>${n.title}`)
        walk(n.id)
      }
    }
    walk(null)
    return out
  }
  const move = (id: string, body: unknown) =>
    req(`/api/v1/entries/${id}/move`, { method: 'PATCH', body: JSON.stringify(body) })

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const s = await req('/api/v1/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: '衔枝', slug: 'xianzhi-kb', kind: 'project' }),
    })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-KB-005 新建带 parentId 进目录；省略不进目录（inTree=0 可列出）；子页按创建顺序在末尾', async () => {
    const a = await create('A 指南', { parentId: null })
    await create('A1 安装', { parentId: a })
    await create('A2 配置', { parentId: a })
    await create('B 散记')
    expect(await tree()).toEqual(['->A 指南', 'A 指南>A1 安装', 'A 指南>A2 配置'])
    const unfiled = (await (await req(`/api/v1/entries?spaceId=${spaceId}&inTree=0`)).json()) as {
      items: { title: string }[]
    }
    expect(unfiled.items.map((i) => i.title)).toEqual(['B 散记'])
    // 详情带面包屑
    const nodes = (
      (await (await req(`/api/v1/spaces/${spaceId}/tree`)).json()) as { items: Node[] }
    ).items
    const a1 = nodes.find((n) => n.title === 'A1 安装')?.id ?? ''
    const d = (await (await req(`/api/v1/entries/${a1}`)).json()) as { path: { title: string }[] }
    expect(d.path.map((p) => p.title)).toEqual(['A 指南'])
  })

  it('REQ-KB-005 移动：同级重排、改父页、移出目录；防环与跨级 after 422', async () => {
    const nodes = (
      (await (await req(`/api/v1/spaces/${spaceId}/tree`)).json()) as { items: Node[] }
    ).items
    const id = (t: string) => nodes.find((n) => n.title === t)?.id ?? ''
    const [a, a1, a2] = [id('A 指南'), id('A1 安装'), id('A2 配置')]
    // A2 放到 A1 之前
    expect((await move(a2, { parentId: a, after: null })).status).toBe(200)
    expect(await tree()).toEqual(['->A 指南', 'A 指南>A2 配置', 'A 指南>A1 安装'])
    // A1 挂到 A2 下
    expect((await move(a1, { parentId: a2, after: null })).status).toBe(200)
    expect(await tree()).toContain('A2 配置>A1 安装')
    // 防环：A 不能挂到自己的孙子 A1 下
    expect((await move(a, { parentId: a1, after: null })).status).toBe(422)
    // after 不是该父页下的同级
    expect((await move(a2, { parentId: null, after: a1 })).status).toBe(422)
    // 加入目录：散记 B 放到根级 A 之后
    const unfiled = (await (await req(`/api/v1/entries?spaceId=${spaceId}&inTree=0`)).json()) as {
      items: { id: string }[]
    }
    const b = unfiled.items[0]?.id ?? ''
    expect((await move(b, { parentId: null, after: a })).status).toBe(200)
    expect((await tree()).at(-1)).toBe('->B 散记')
    // 移出目录：A2 带子页 A1 → A1 上移接到 A 下
    expect((await move(a2, { detach: true })).status).toBe(200)
    expect(await tree()).toEqual(['->A 指南', 'A 指南>A1 安装', '->B 散记'])
  })

  it('REQ-KB-005 软删父页：子页上移一级', async () => {
    const nodes = (
      (await (await req(`/api/v1/spaces/${spaceId}/tree`)).json()) as { items: Node[] }
    ).items
    const a = nodes.find((n) => n.title === 'A 指南')?.id ?? ''
    expect((await req(`/api/v1/entries/${a}`, { method: 'DELETE' })).status).toBe(204)
    expect(await tree()).toEqual(['->A1 安装', '->B 散记'])
  })

  it('REQ-KB-004 类型多选与 fields 过滤：kind=bug,iteration；fields=status=open|fixed,severity=high', async () => {
    await create('高危', { kind: 'bug', fields: { severity: 'high', status: 'open' } })
    await create('低危已修', { kind: 'bug', fields: { severity: 'low', status: 'fixed' } })
    await create('迭代 1', {
      kind: 'iteration',
      fields: { periodStart: '2026-09-01', periodEnd: '2026-09-07' },
    })
    const list = async (qs: string) =>
      (
        (await (await req(`/api/v1/entries?spaceId=${spaceId}&${qs}`)).json()) as {
          items: { title: string }[]
        }
      ).items
        .map((i) => i.title)
        .sort()
    expect(await list('kind=bug,iteration')).toEqual(['低危已修', '迭代 1', '高危'].sort())
    expect(await list('kind=bug&fields=severity=high')).toEqual(['高危'])
    expect(await list('kind=bug&fields=status=open|fixed')).toEqual(['低危已修', '高危'].sort())
    expect((await req(`/api/v1/entries?fields=bad-format`)).status).toBe(422)
  })
})

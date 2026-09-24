/**
 * T1-040 横切约定验收（REQ-OPS-013 · 014）：
 * - 每个创建端点同一 Idempotency-Key 连发两次 → 同状态码、同响应体、表行只增一行（02 §5）；
 * - 全部已注册的 /api/v1 路由：未登录 → 401 problem+json；登录后用非法参数触发的每个错误响应都是 problem+json，
 *   含 code / status / requestId（02 §3）。
 */
import { randomUUID } from 'node:crypto'
import { count } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { invitation } from '../db/schema/auth.ts'
import { attachments, comments, entries, spaces, tags, tasks } from '../db/schema/business.ts'
import { inlineQueue } from '../lib/job-queue.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('T1-040 crosscut', () => {
  let app: App
  let cookie = ''
  let spaceId = ''
  let taskId = ''
  let entryId = ''
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp({ jobQueue: inlineQueue({ 'export.run': async () => ({}) }) }).app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const s = await post('/spaces', { name: '横切', slug: 'crosscut', kind: 'work' })
    spaceId = ((await s.json()) as { id: string }).id
    taskId = (
      (await (await post('/tasks', { title: '横切任务', spaceId })).json()) as { id: string }
    ).id
    entryId = (
      (await (
        await post('/entries', { kind: 'note', title: '横切记录', spaceId, visibility: 'space' })
      ).json()) as {
        id: string
      }
    ).id
  })
  function post(path: string, body: unknown, key?: string) {
    return app.request(`/api/v1${path}`, {
      method: 'POST',
      headers: jsonHeaders({ cookie, ...(key ? { 'idempotency-key': key } : {}) }),
      body: JSON.stringify(body),
    })
  }
  const rows = async (table: unknown) => {
    const [r] = await getDb()
      .select({ n: count() })
      .from(table as typeof tasks)
    return r?.n ?? 0
  }

  const JSON_CASES: { name: string; path: string; table: unknown; body: () => unknown }[] = [
    {
      name: 'spaces',
      path: '/spaces',
      table: spaces,
      body: () => ({ name: 'I', slug: `idem-${Date.now()}`, kind: 'work' }),
    },
    { name: 'tasks', path: '/tasks', table: tasks, body: () => ({ title: '幂等任务', spaceId }) },
    {
      name: 'entries',
      path: '/entries',
      table: entries,
      body: () => ({ kind: 'note', title: '幂等记录', spaceId, visibility: 'space' }),
    },
    {
      name: 'comments',
      path: '/comments',
      table: comments,
      body: () => ({ targetType: 'task', targetId: taskId, bodyPm: doc('幂等评论') }),
    },
    {
      name: 'tags',
      path: '/tags',
      table: tags,
      body: () => ({ name: `幂等标签${Date.now() % 1000}`, color: 'moss' }),
    },
    {
      name: 'invitations',
      path: '/workspace/invitations',
      table: invitation,
      body: () => ({ email: `idem-${Date.now()}@xz.local`, role: 'member' }),
    },
  ]

  for (const c of JSON_CASES)
    it(`REQ-OPS-013 POST ${c.name}：同 Idempotency-Key 重放同资源，行数只增 1`, async () => {
      const key = randomUUID()
      const body = c.body()
      const before = await rows(c.table)
      const a = await post(c.path, body, key)
      expect(a.status, await a.clone().text()).toBe(201)
      const b = await post(c.path, body, key)
      expect(b.status).toBe(a.status)
      expect(b.headers.get('idempotent-replayed')).toBe('true')
      expect(await b.json()).toEqual(await a.json())
      expect(await rows(c.table)).toBe(before + 1)
    })

  it('REQ-OPS-013 POST attachments（multipart）：同 key 重放同附件', async () => {
    const key = randomUUID()
    const send = () => {
      const fd = new FormData()
      fd.append('file', new File([PNG], 'dot.png', { type: 'image/png' }))
      fd.append('targetType', 'entry')
      fd.append('targetId', entryId)
      const h = jsonHeaders({ cookie, 'idempotency-key': key })
      delete (h as Record<string, string>)['content-type']
      return app.request('/api/v1/attachments', { method: 'POST', headers: h, body: fd })
    }
    const before = await rows(attachments)
    const a = await send()
    expect(a.status, await a.clone().text()).toBe(201)
    const b = await send()
    expect(b.status).toBe(201)
    expect(((await b.json()) as { id: string }).id).toBe(((await a.json()) as { id: string }).id)
    expect(await rows(attachments)).toBe(before + 1)
  })

  it('REQ-OPS-013 POST exports：同 key 重放同作业', async () => {
    const key = randomUUID()
    const a = await post('/exports', { scope: 'space', id: spaceId, format: 'zip' }, key)
    expect([201, 202]).toContain(a.status)
    const b = await post('/exports', { scope: 'space', id: spaceId, format: 'zip' }, key)
    expect(b.status).toBe(a.status)
    expect(await b.json()).toEqual(await a.json())
  })

  it('REQ-OPS-013 非 UUID 的 Idempotency-Key → 422 problem+json', async () => {
    const r = await post('/tasks', { title: 'x', spaceId }, 'not-a-uuid')
    expect(r.status).toBe(422)
    expect(r.headers.get('content-type')).toContain('application/problem+json')
  })

  it('REQ-OPS-014 全部 /api/v1 路由：未登录 401、错误响应一律 problem+json 且含 code / status / requestId', async () => {
    const routes = (app as unknown as { routes: { method: string; path: string }[] }).routes
      .filter(
        (r) => r.path.startsWith('/api/v1/') && !r.path.includes('/_debug/') && r.method !== 'ALL',
      )
      .map((r) => ({ method: r.method, path: r.path }))
    const uniq = [...new Map(routes.map((r) => [`${r.method} ${r.path}`, r])).values()]
    const PUBLIC = [/^\/api\/v1\/health/, /^\/api\/v1\/workspace\/invitations\/:id(\/accept)?$/]
    const fill = (p: string) => p.replace(/:[A-Za-z]+/g, 'not-a-uuid').replace(/\*$/, '')
    let errors = 0
    const bad: string[] = []
    const check = async (res: Response, label: string) => {
      if (res.status < 400) return
      errors++
      const ct = res.headers.get('content-type') ?? ''
      const body = (await res.json().catch(() => ({}))) as {
        code?: string
        status?: number
        requestId?: string
      }
      if (
        !ct.includes('application/problem+json') ||
        !body.code ||
        body.status !== res.status ||
        !body.requestId
      )
        bad.push(`${label} → ${res.status} ${ct} ${JSON.stringify(body).slice(0, 80)}`)
    }
    for (const r of uniq) {
      const url = fill(r.path)
      if (r.path.includes('/stream')) continue // SSE：未登录 401 已在 stream.test 覆盖
      const anon = await app.request(url, {
        method: r.method,
        headers: jsonHeaders(),
        body: r.method === 'GET' || r.method === 'HEAD' ? undefined : '{}',
      })
      if (!PUBLIC.some((re) => re.test(r.path))) {
        if (anon.status !== 401) bad.push(`${r.method} ${r.path} 未登录 → ${anon.status}`)
      }
      await check(anon, `anon ${r.method} ${r.path}`)
      const authed = await app.request(url, {
        method: r.method,
        headers: jsonHeaders({ cookie }),
        body: r.method === 'GET' || r.method === 'HEAD' ? undefined : '{"__invalid":true}',
      })
      await check(authed, `auth ${r.method} ${r.path}`)
    }
    expect(bad).toEqual([])
    expect(errors).toBeGreaterThan(uniq.length) // 每条路由至少各有一个错误响应被检查
    // 422 带字段路径
    const v = await post('/tasks', { title: '', spaceId })
    expect(v.status).toBe(422)
    expect(((await v.json()) as { errors: { path: string }[] }).errors[0]?.path).toBe('title')
  })
})

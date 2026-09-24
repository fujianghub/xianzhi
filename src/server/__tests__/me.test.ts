/** /me：资料、会话列表与注销、API Key（REQ-WS-010、REQ-AUTH-009 · 010）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { auditLog } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()

describe('/me', () => {
  let app: ReturnType<typeof buildApp>['app']
  let cookie = ''

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('REQ-WS-010 GET /me 含 workspaceRole；PATCH 时区校验（非法 422 / 合法 200）', async () => {
    const me = await app.request('/api/v1/me', { headers: { cookie } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { workspaceRole: string; timezone: string }).workspaceRole).toBe(
      'owner',
    )
    const bad = await app.request('/api/v1/me', {
      method: 'PATCH',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ timezone: 'Mars/Olympus' }),
    })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).errors?.[0]?.path).toBe('timezone')
    const ok = await app.request('/api/v1/me', {
      method: 'PATCH',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ timezone: 'America/New_York', displayName: '老板', weekStartsOn: 0 }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({
      timezone: 'America/New_York',
      displayName: '老板',
      weekStartsOn: 0,
    })
  })

  it('REQ-AUTH-009 本人 GET /me/sessions 列出全部会话（含 current）；DELETE /me/sessions/:id 后该会话 401', async () => {
    const other = await signIn(app, OWNER.email, OWNER.password)
    const list = await app.request('/api/v1/me/sessions', { headers: { cookie } })
    expect(list.status).toBe(200)
    const items = ((await list.json()) as { items: { id: string; current: boolean }[] }).items
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items.filter((i) => i.current)).toHaveLength(1)
    const victim = items.find((i) => !i.current)
    if (!victim) throw new Error('no other session')
    const del = await app.request(`/api/v1/me/sessions/${victim.id}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie }),
    })
    expect(del.status).toBe(204)
    expect((await app.request('/api/v1/me', { headers: { cookie: other.cookie } })).status).toBe(
      401,
    )
    expect((await app.request('/api/v1/me', { headers: { cookie } })).status).toBe(200)
    // 登出：本会话失效 + audit auth.logout
    const out = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: jsonHeaders({ cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }),
    })
    expect(out.status).toBe(200)
    expect(
      (await db().select().from(auditLog).where(eq(auditLog.action, 'auth.logout'))).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('REQ-AUTH-010 /me/keys：明文只返回一次、列表只含前缀与 scope、scope 生效（read key 写端点 403 SCOPE）、吊销后 401 且 audit 两行', async () => {
    const created = await app.request('/api/v1/me/keys', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ name: 'mcp', scope: 'read' }),
    })
    expect(created.status).toBe(201)
    const k = (await created.json()) as {
      id: string
      key: string
      scope: string
      start: string | null
    }
    expect(k.key).toMatch(/^xz_/)
    expect(k.scope).toBe('read')
    const list = await app.request('/api/v1/me/keys', { headers: { cookie } })
    const items = ((await list.json()) as { items: Record<string, unknown>[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.key).toBeUndefined()
    expect(String(items[0]?.start)).toMatch(/^xz_/)
    // read scope 调写端点 → 403 SCOPE；读端点 200
    const write = await app.request('/api/v1/workspace', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${k.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(write.status).toBe(403)
    expect((await problemOf(write)).code).toBe('SCOPE')
    expect(
      (await app.request('/api/v1/me', { headers: { authorization: `Bearer ${k.key}` } })).status,
    ).toBe(200)
    // Key 请求不能管理 Key
    expect(
      (
        await app.request('/api/v1/me/keys', {
          method: 'POST',
          headers: { authorization: `Bearer ${k.key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403)
    const del = await app.request(`/api/v1/me/keys/${k.id}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie }),
    })
    expect(del.status).toBe(204)
    expect(
      (await app.request('/api/v1/me', { headers: { authorization: `Bearer ${k.key}` } })).status,
    ).toBe(401)
    const rows = await db().select().from(auditLog)
    expect(rows.filter((r) => r.action === 'api_key.created')).toHaveLength(1)
    expect(rows.filter((r) => r.action === 'api_key.revoked')).toHaveLength(1)
  })
})

/** ADR-0024 阅读与写作偏好：REQ-READ-001（GET 补默认 / PATCH 按键合并 / 校验 / 按人隔离 / scope / 删号清理）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_READING, normalizeReading } from '../../shared/schemas/preferences.ts'
import { getDb } from '../db/index.ts'
import { userPreferences } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']

describe('preferences', () => {
  let app: App
  let owner = ''
  const call = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('REQ-READ-001 GET 未设过返回默认；PATCH 按键合并、非法值 / 未知键 422；按人隔离；read Key 不能写；删号清理', async () => {
    const first = await call(owner, 'GET', '/me/preferences')
    expect(first.status).toBe(200)
    expect(((await first.json()) as { reading: unknown }).reading).toEqual(DEFAULT_READING)

    let r = await call(owner, 'PATCH', '/me/preferences', { reading: { font: 'wenkai' } })
    expect(r.status).toBe(200)
    r = await call(owner, 'PATCH', '/me/preferences', { reading: { paper: 'grid', tocDepth: 3 } })
    const merged = ((await r.json()) as { reading: Record<string, unknown> }).reading
    expect(merged).toMatchObject({ font: 'wenkai', paper: 'grid', tocDepth: 3, size: 'md' })

    expect(
      (await call(owner, 'PATCH', '/me/preferences', { reading: { font: 'comic' } })).status,
    ).toBe(422)
    expect(
      (await call(owner, 'PATCH', '/me/preferences', { reading: { color: 'red' } })).status,
    ).toBe(422)
    expect((await call(owner, 'PATCH', '/me/preferences', { reading: {} })).status).toBe(422)

    // 另一个人看不到 owner 的偏好
    const created = await call(owner, 'POST', '/workspace/users', {
      email: 'reader@xz.local',
      username: 'reader',
      name: 'Reader',
      password: 'initial-pass-1',
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const { userId } = (await created.json()) as { userId: string }
    const other = (await signIn(app, 'reader@xz.local', 'initial-pass-1')).cookie
    const theirs = await call(other, 'GET', '/me/preferences')
    expect(((await theirs.json()) as { reading: unknown }).reading).toEqual(DEFAULT_READING)
    await call(other, 'PATCH', '/me/preferences', { reading: { width: 'wide' } })

    // read scope Key 写 → 403
    const key = await call(owner, 'POST', '/me/keys', { name: 'ro', scope: 'read' })
    const k = ((await key.json()) as { key: string }).key
    const viaKey = await app.request('/api/v1/me/preferences', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reading: { font: 'mono' } }),
    })
    expect(viaKey.status).toBe(403)

    // 删号 → 偏好行删除
    expect(
      await getDb().select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    ).toHaveLength(1)
    expect((await call(owner, 'DELETE', `/workspace/members/${userId}?purge=1`)).status).toBe(204)
    expect(
      await getDb().select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    ).toHaveLength(0)
  })

  it('REQ-READ-001 读取时逐键校验：库里的坏值 / 旧键回落默认，不整份作废', () => {
    expect(normalizeReading({ font: 'song', size: 'huge', legacy: 1 })).toEqual({
      ...DEFAULT_READING,
      font: 'song',
    })
    expect(normalizeReading(null)).toEqual(DEFAULT_READING)
  })
})

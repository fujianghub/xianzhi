/** REQ-COLLAB-007 快照策略与保留。 */
import { eq, sql } from 'drizzle-orm'
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { truncateAll } from '../../server/__tests__/db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from '../../server/__tests__/helpers.ts'
import { getDb } from '../../server/db/index.ts'
import { entries, entrySnapshots, spaces } from '../../server/db/schema/business.ts'
import { emptyYdoc } from '../derive.ts'
import { gcSnapshots, insertSnapshot, maybeAutoSnapshot, SNAPSHOT_POLICY } from '../snapshots.ts'

const db = () => getDb()

describe('snapshots', () => {
  let entryId = ''
  let workspaceId = ''
  let userId = ''
  let spaceId = ''
  const mkEntry = async () => {
    const id = v7()
    await db().insert(entries).values({
      id,
      workspaceId,
      spaceId,
      kind: 'note',
      title: 's',
      visibility: 'space',
      authorId: userId,
      ydoc: emptyYdoc(),
    })
    return id
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    userId = r.userId
    const [ps] = await db().select().from(spaces).where(eq(spaces.isPersonal, true))
    spaceId = ps?.id ?? ''
    entryId = await mkEntry()
  })

  it('REQ-COLLAB-007 触发 60 次落库 → entry_snapshots 1 行（第 50 次），快照可解码', async () => {
    const hits: number[] = []
    for (let v = 1; v <= 60; v++)
      if (await maybeAutoSnapshot(db(), entryId, emptyYdoc(), v)) hits.push(v)
    expect(hits).toEqual([50])
    const rows = await db().select().from(entrySnapshots).where(eq(entrySnapshots.entryId, entryId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.ydocVersion).toBe(50)
    expect(() => Y.decodeSnapshot(rows[0]?.snapshot ?? new Uint8Array())).not.toThrow()
  })

  it('REQ-COLLAB-007 距上次 ≥ 30 分钟且版本前进 → 生成；版本未变 → 不生成', async () => {
    const id = await mkEntry()
    const later = new Date(Date.now() + SNAPSHOT_POLICY.everyMs + 1000)
    expect(await maybeAutoSnapshot(db(), id, emptyYdoc(), 0, later)).toBe(false)
    expect(await maybeAutoSnapshot(db(), id, emptyYdoc(), 3, later)).toBe(true)
    expect(await maybeAutoSnapshot(db(), id, emptyYdoc(), 4, later)).toBe(false)
  })

  it('REQ-COLLAB-007 保留：未标记超出最近 100 且非当日最后一个的被删；标记快照永久；gc 幂等', async () => {
    const id = await mkEntry()
    const old = new Date(Date.now() - 200 * 86_400_000) // 超过 90 天
    // 1 个标记快照（很旧）+ 130 个未标记（同一旧日）
    await insertSnapshot(db(), id, emptyYdoc(), 1, { label: '里程碑' })
    for (let i = 0; i < 130; i++) await insertSnapshot(db(), id, emptyYdoc(), i + 2)
    await db()
      .update(entrySnapshots)
      .set({
        createdAt: sql`${old}::timestamptz + (${entrySnapshots.ydocVersion} || ' seconds')::interval`,
      })
      .where(eq(entrySnapshots.entryId, id))
    const deleted = await gcSnapshots(db())
    expect(deleted).toBe(30)
    const left = await db().select().from(entrySnapshots).where(eq(entrySnapshots.entryId, id))
    expect(left).toHaveLength(101)
    expect(left.some((r) => r.label === '里程碑')).toBe(true)
    expect(await gcSnapshots(db())).toBe(0)
  })

  it('REQ-COLLAB-007 POST /entries/:id/snapshots {label} → 新行带 label；列表 / 二进制可读；不存在 404', async () => {
    const app = buildApp().app
    const cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ kind: 'note', title: '版本' }),
    })
    const id = ((await created.json()) as { id: string }).id
    const res = await app.request(`/api/v1/entries/${id}/snapshots`, {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ label: 'v1.0' }),
    })
    expect(res.status).toBe(201)
    const s = (await res.json()) as { id: string; label: string }
    expect(s.label).toBe('v1.0')
    const list = (await (
      await app.request(`/api/v1/entries/${id}/snapshots`, { headers: { cookie } })
    ).json()) as { items: { id: string; label: string }[] }
    expect(list.items.map((i) => i.label)).toEqual(['v1.0'])
    const bin = await app.request(`/api/v1/entries/${id}/snapshots/${s.id}`, {
      headers: { cookie },
    })
    expect(bin.status).toBe(200)
    const snap = Y.decodeSnapshot(new Uint8Array(await bin.arrayBuffer()))
    expect(snap.sv).toBeInstanceOf(Map)
    expect(
      (await app.request(`/api/v1/entries/${v7()}/snapshots`, { headers: { cookie } })).status,
    ).toBe(404)
  })
})

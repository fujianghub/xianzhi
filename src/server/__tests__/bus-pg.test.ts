/** app → collab 跨进程广播（PG NOTIFY `xz_bus`）：REQ-WS-004 的吊销能到达独立的 collab 进程。 */
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { listenPg, relayToPg } from '../lib/bus-pg.ts'
import { EventBus } from '../lib/event-bus.ts'

describe('bus-pg', () => {
  it('REQ-WS-004 app 侧 user.revoked / entry.access_changed 经 PG 转发到 collab 侧 bus；notify 不转发', async () => {
    const url = process.env.DATABASE_URL as string
    const appBus = new EventBus()
    const collabBus = new EventBus()
    const pool = new pg.Pool({ connectionString: url, max: 1 })
    const got: unknown[] = []
    collabBus.subscribe('user.revoked', (p) => got.push(['revoked', p]))
    collabBus.subscribe('entry.access_changed', (p) => got.push(['access', p]))
    collabBus.subscribe('notify', (p) => got.push(['notify', p]))
    const stop = await listenPg(collabBus, url)
    const off = relayToPg(appBus, pool)
    appBus.publish('user.revoked', { userId: 'u1' })
    appBus.publish('entry.access_changed', { entryIds: ['e1'] })
    appBus.publish('notify', { userId: 'u1', frame: { type: 'x', data: 1 } })
    const t = Date.now()
    while (got.length < 2 && Date.now() - t < 2000) await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 100))
    expect(got).toEqual([
      ['revoked', { userId: 'u1' }],
      ['access', { entryIds: ['e1'] }],
    ])
    off()
    await stop()
    await pool.end()
  })
})

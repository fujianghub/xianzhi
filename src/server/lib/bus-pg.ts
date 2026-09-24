/**
 * EventBus 跨进程桥（xz-app → xz-collab）：`user.revoked` / `entry.access_changed` 经 PG NOTIFY 频道 `xz_bus`。
 * 02 §6 / 07 §4 写「进程内 EventBus」，但生产 app 与 collab 是两个容器（05 §7），必须跨进程；单机 PG 即可，不引 Redis。
 * app：relayToPg(bus, pool)；collab：listenPg(bus, url)。只单向转发，不会回环。
 */
import pg from 'pg'
import type { BusEvents, EventBus } from './event-bus.ts'

export const BUS_CHANNEL = 'xz_bus'
const RELAYED = ['user.revoked', 'entry.access_changed'] as const
type Relayed = (typeof RELAYED)[number]

export function relayToPg(
  bus: EventBus,
  pool: pg.Pool,
  onError: (e: unknown) => void = console.error,
): () => void {
  const offs = RELAYED.map((kind) =>
    bus.subscribe(kind, (payload) => {
      pool
        .query('select pg_notify($1, $2)', [BUS_CHANNEL, JSON.stringify({ kind, payload })])
        .catch(onError)
    }),
  )
  return () => {
    for (const off of offs) off()
  }
}

export async function listenPg(
  bus: EventBus,
  connectionString: string,
  onError: (e: unknown) => void = console.error,
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  client.on('notification', (msg) => {
    if (msg.channel !== BUS_CHANNEL || !msg.payload) return
    try {
      const { kind, payload } = JSON.parse(msg.payload) as {
        kind: Relayed
        payload: BusEvents[Relayed]
      }
      if (RELAYED.includes(kind)) bus.publish(kind, payload as never)
    } catch (e) {
      onError(e)
    }
  })
  client.on('error', onError)
  await client.query(`listen ${BUS_CHANNEL}`)
  return async () => {
    await client.end()
  }
}

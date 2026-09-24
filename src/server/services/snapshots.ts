/** 快照 API service（02 §9 /entries/:id/snapshots*；REQ-COLLAB-007）：鉴权后调 collab/snapshots.ts。 */
import { eq } from 'drizzle-orm'
import { getSnapshotRow, insertSnapshot, listSnapshotRows } from '../../collab/snapshots.ts'
import { assertCan, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { entries } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { type EntryCtx, loadEntry } from './entries.ts'

async function readable(db: Db, ctx: EntryCtx, id: string) {
  const loaded = await loadEntry(db, ctx.actor, id)
  if (!loaded || !can(ctx.actor, 'entry.read', loaded.ref)) throw AppError.notFound('记录不存在')
  return loaded
}

export async function listSnapshots(db: Db, ctx: EntryCtx, id: string) {
  await readable(db, ctx, id)
  const rows = await listSnapshotRows(db, id)
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

/** 手动「标记版本」：以当前已落库的 ydoc 生成带 label 的快照（永久保留）。 */
export async function markSnapshot(db: Db, ctx: EntryCtx, id: string, label: string) {
  const loaded = await readable(db, ctx, id)
  assertCan(ctx.actor, 'entry.write', loaded.ref)
  const [row] = await db
    .select({ ydoc: entries.ydoc, v: entries.ydocVersion })
    .from(entries)
    .where(eq(entries.id, id))
  if (!row) throw AppError.notFound()
  const s = await insertSnapshot(db, id, row.ydoc, row.v, { label, createdBy: ctx.actor.id })
  return {
    id: s.id,
    ydocVersion: row.v,
    label,
    createdBy: ctx.actor.id,
    createdAt: s.createdAt.toISOString(),
  }
}

export async function getSnapshotBinary(
  db: Db,
  ctx: EntryCtx,
  id: string,
  sid: string,
): Promise<Buffer> {
  await readable(db, ctx, id)
  const row = await getSnapshotRow(db, id, sid)
  if (!row) throw AppError.notFound('快照不存在')
  return row.snapshot
}

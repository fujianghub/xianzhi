/**
 * 快照（03 §5、REQ-COLLAB-007）：`entry_snapshots.snapshot = Y.encodeSnapshot(Y.snapshot(doc))`，附 ydoc_version。
 * 自动触发：距上个快照（无则以版本 0 / 记录创建时间为基准）版本差 ≥ 50，或 ≥ 30 分钟且版本有前进。
 * 保留：标记快照永久；未标记保留最近 100 个 + 每天最后一个 90 天（07 §3 gc.snapshots）。
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import type { DbOrTx } from '../server/db/index.ts'
import { entries, entrySnapshots } from '../server/db/schema/business.ts'
import { loadYdoc } from './derive.ts'

export const SNAPSHOT_POLICY = {
  everyStores: 50,
  everyMs: 30 * 60 * 1000,
  keepLatest: 100,
  keepDailyDays: 90,
  gcBatch: 1000,
}

export function encodeSnapshotOf(ydoc: Uint8Array): Buffer {
  const doc = loadYdoc(ydoc)
  try {
    return Buffer.from(Y.encodeSnapshot(Y.snapshot(doc)))
  } finally {
    doc.destroy()
  }
}

export async function insertSnapshot(
  db: DbOrTx,
  entryId: string,
  ydoc: Uint8Array,
  version: number,
  opts: { label?: string | null; createdBy?: string | null; createdAt?: Date } = {},
) {
  const [row] = await db
    .insert(entrySnapshots)
    .values({
      entryId,
      ydocVersion: version,
      snapshot: encodeSnapshotOf(ydoc),
      label: opts.label ?? null,
      createdBy: opts.createdBy ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: entrySnapshots.id, createdAt: entrySnapshots.createdAt })
  if (!row) throw new Error('insert snapshot failed')
  return row
}

/** onStoreDocument 落库后调用；返回是否生成了快照。 */
export async function maybeAutoSnapshot(
  db: DbOrTx,
  entryId: string,
  ydoc: Uint8Array,
  version: number,
  now = new Date(),
): Promise<boolean> {
  const [last] = await db
    .select({ v: entrySnapshots.ydocVersion, at: entrySnapshots.createdAt })
    .from(entrySnapshots)
    .where(eq(entrySnapshots.entryId, entryId))
    .orderBy(desc(entrySnapshots.createdAt))
    .limit(1)
  let baseVersion = last?.v ?? 0
  let baseAt = last?.at
  if (!baseAt) {
    const [e] = await db
      .select({ at: entries.createdAt })
      .from(entries)
      .where(eq(entries.id, entryId))
    baseAt = e?.at ?? now
    baseVersion = 0
  }
  const byCount = version - baseVersion >= SNAPSHOT_POLICY.everyStores
  const byTime =
    version > baseVersion && now.getTime() - baseAt.getTime() >= SNAPSHOT_POLICY.everyMs
  if (!byCount && !byTime) return false
  await insertSnapshot(db, entryId, ydoc, version, { createdAt: now })
  return true
}

/** 保留清理；幂等，单次上限 gcBatch 行（07 §3）。返回删除行数。 */
export async function gcSnapshots(db: DbOrTx, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SNAPSHOT_POLICY.keepDailyDays * 86_400_000)
  const r = await db.execute<{ id: string }>(sql`
    with ranked as (
      select id, label, created_at,
        row_number() over (partition by entry_id order by created_at desc, id desc) as rn,
        row_number() over (partition by entry_id, date_trunc('day', created_at) order by created_at desc, id desc) as day_rn
      from ${entrySnapshots}
    ), victims as (
      select id from ranked
      where label is null
        and rn > ${SNAPSHOT_POLICY.keepLatest}
        and not (day_rn = 1 and created_at >= ${cutoff})
      limit ${SNAPSHOT_POLICY.gcBatch}
    )
    delete from ${entrySnapshots} s using victims v where s.id = v.id returning s.id`)
  return r.rows.length
}

export async function listSnapshotRows(db: DbOrTx, entryId: string) {
  return db
    .select({
      id: entrySnapshots.id,
      ydocVersion: entrySnapshots.ydocVersion,
      label: entrySnapshots.label,
      createdBy: entrySnapshots.createdBy,
      createdAt: entrySnapshots.createdAt,
    })
    .from(entrySnapshots)
    .where(eq(entrySnapshots.entryId, entryId))
    .orderBy(desc(entrySnapshots.createdAt))
}

export async function getSnapshotRow(db: DbOrTx, entryId: string, sid: string) {
  const [row] = await db
    .select()
    .from(entrySnapshots)
    .where(and(eq(entrySnapshots.entryId, entryId), eq(entrySnapshots.id, sid)))
  return row ?? null
}

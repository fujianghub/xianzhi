/** 快照 API service（02 §9 /entries/:id/snapshots*；REQ-COLLAB-007 · 008）：鉴权后调 collab/snapshots.ts / history.ts。 */
import { eq } from 'drizzle-orm'
import { snapshotPmJson } from '../../collab/history.ts'
import { getSnapshotRow, insertSnapshot, listSnapshotRows } from '../../collab/snapshots.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { assertCan, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { entries } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { getEventBus } from '../lib/event-bus.ts'
import { audit } from './audit.ts'
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

/**
 * 快照时刻正文（REQ-COLLAB-008 预览 / 对比）：以已落库 ydoc（gc:false）重建旧状态；
 * `current` 取派生 pm_json（落库节流 ≤ 10s，预览足够）。
 */
export async function getSnapshotContent(db: Db, ctx: EntryCtx, id: string, sid: string) {
  await readable(db, ctx, id)
  const snap = await getSnapshotRow(db, id, sid)
  if (!snap) throw AppError.notFound('快照不存在')
  const [row] = await db
    .select({ ydoc: entries.ydoc, pmJson: entries.pmJson })
    .from(entries)
    .where(eq(entries.id, id))
  if (!row) throw AppError.notFound()
  return {
    id: snap.id,
    ydocVersion: snap.ydocVersion,
    label: snap.label,
    createdBy: snap.createdBy,
    createdAt: snap.createdAt.toISOString(),
    pmJson: snapshotPmJson(row.ydoc, snap.snapshot),
    currentPmJson: (row.pmJson as PmNode | null) ?? { type: 'doc', content: [] },
  }
}

/**
 * 恢复（REQ-COLLAB-008）：需 entry.write；审计后经总线请 collab 把快照状态作为一次修改写回在线文档
 * （不覆盖 ydoc，03 §5）。异步生效 → 202；在线编辑者经协同实时看到结果。
 */
export async function restoreSnapshot(db: Db, ctx: EntryCtx, id: string, sid: string) {
  const loaded = await readable(db, ctx, id)
  assertCan(ctx.actor, 'entry.write', loaded.ref)
  const snap = await getSnapshotRow(db, id, sid)
  if (!snap) throw AppError.notFound('快照不存在')
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'entry.restored',
    targetType: 'entry',
    targetId: id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta: { snapshotId: sid, ydocVersion: snap.ydocVersion, label: snap.label },
  })
  ;(ctx.bus ?? getEventBus()).publish('entry.restore', {
    entryId: id,
    snapshotId: sid,
    actorId: ctx.actor.id,
  })
  return { accepted: true as const }
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

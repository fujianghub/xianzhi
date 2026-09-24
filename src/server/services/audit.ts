/**
 * 审计日志（01 §3.12；REQ-WS-006 / 017）：只增不改；action 只能取枚举，否则抛错（Zod）。
 * 与业务写入同事务：传入 tx。
 */
import { and, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm'
import type { AuditEntry } from '../../shared/schemas/audit.ts'
import { auditEntrySchema } from '../../shared/schemas/audit.ts'
import { assertCan, type MaybeActor } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { auditLog } from '../db/schema/business.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'

export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  const v = auditEntrySchema.parse(entry) // 非枚举 action → ZodError（REQ-WS-017）
  await db.insert(auditLog).values({
    workspaceId: v.workspaceId ?? null,
    actorId: v.actorId ?? null,
    action: v.action,
    targetType: v.targetType ?? null,
    targetId: v.targetId ?? null,
    ip: v.ip ?? null,
    userAgent: v.userAgent ?? null,
    meta: v.meta ?? null,
  })
}

// ---------- 查询（REQ-WS-005；02 §4 游标） ----------

export interface AuditLogQueryInput {
  action?: string
  actorId?: string
  from?: string
  to?: string
  jobId?: string
  cursor?: string
  limit: number
}

export async function listAuditLog(
  db: DbOrTx,
  actor: MaybeActor,
  workspaceId: string,
  q: AuditLogQueryInput,
) {
  assertCan(actor, 'workspace.manage', null)
  const conds: SQL[] = [eq(auditLog.workspaceId, workspaceId)]
  if (q.action) conds.push(eq(auditLog.action, q.action))
  if (q.actorId) conds.push(eq(auditLog.actorId, q.actorId))
  if (q.from) conds.push(gte(auditLog.createdAt, new Date(q.from)))
  if (q.to) conds.push(lte(auditLog.createdAt, new Date(q.to)))
  if (q.jobId) conds.push(sql`${auditLog.meta} ->> 'jobId' = ${q.jobId}`)
  const c = decodeCursor(q.cursor, 2)
  if (q.cursor && !c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  if (c) {
    const [createdAt, id] = c
    conds.push(
      sql`(${auditLog.createdAt}, ${auditLog.id}) < (${new Date(String(createdAt))}, ${String(id)}::uuid)`,
    )
  }
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null
  return {
    items: page.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      ip: r.ip,
      userAgent: r.userAgent,
      meta: r.meta,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  }
}

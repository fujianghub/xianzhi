/**
 * 记录属性流转（ADR-0033、REQ-BUG-006）：status / priority / severity 的变化由 entries service 同事务写入
 * `entry_field_changes`；记录页属性栏「流转」时间线与 Bug 统计的「重开次数」读它。
 */
import { and, asc, eq } from 'drizzle-orm'
import { TRACKED_ENTRY_FIELDS } from '../../shared/schemas/enums.ts'
import type { DbOrTx } from '../db/index.ts'
import { member, user } from '../db/schema/auth.ts'
import { entryFieldChanges } from '../db/schema/business.ts'

type Fields = Record<string, unknown>

const scalar = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : String(v)

/** prev（新建为 null）→ next 之间被跟踪属性的变化。 */
export function trackedChanges(prev: Fields | null, next: Fields) {
  const out: { field: string; fromValue: string | null; toValue: string | null }[] = []
  for (const field of TRACKED_ENTRY_FIELDS) {
    const fromValue = scalar(prev?.[field])
    const toValue = scalar(next[field])
    if (fromValue !== toValue) out.push({ field, fromValue, toValue })
  }
  return out
}

export async function recordFieldChanges(
  tx: DbOrTx,
  ctx: { workspaceId: string; actor: { id: string } },
  entryId: string,
  prev: Fields | null,
  next: Fields,
): Promise<void> {
  const rows = trackedChanges(prev, next)
  if (!rows.length) return
  await tx.insert(entryFieldChanges).values(
    rows.map((r) => ({
      ...r,
      workspaceId: ctx.workspaceId,
      entryId,
      actorId: ctx.actor.id,
    })),
  )
}

export interface FieldChangeView {
  id: string
  field: string
  from: string | null
  to: string | null
  actor: { id: string | null; displayName: string }
  createdAt: string
}

/** 时间正序；已离开工作区的操作者显示「已离开的成员」（同记录作者，REQ-WS-012）。调用方负责 entry.read。 */
export async function listFieldChanges(
  db: DbOrTx,
  workspaceId: string,
  entryId: string,
): Promise<FieldChangeView[]> {
  const rows = await db
    .select({
      c: entryFieldChanges,
      name: user.name,
      displayName: user.displayName,
      memberId: member.id,
    })
    .from(entryFieldChanges)
    .leftJoin(user, eq(user.id, entryFieldChanges.actorId))
    .leftJoin(
      member,
      and(eq(member.userId, entryFieldChanges.actorId), eq(member.organizationId, workspaceId)),
    )
    .where(eq(entryFieldChanges.entryId, entryId))
    .orderBy(asc(entryFieldChanges.createdAt), asc(entryFieldChanges.id))
  return rows.map((r) => ({
    id: r.c.id,
    field: r.c.field,
    from: r.c.fromValue,
    to: r.c.toValue,
    actor: {
      id: r.c.actorId,
      displayName: r.memberId ? r.displayName || r.name || '' : '已离开的成员',
    },
    createdAt: r.c.createdAt.toISOString(),
  }))
}

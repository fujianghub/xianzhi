/**
 * 数据变更的实时失效（02 §6 `invalidate`、REQ-NOTIF-004）：任务 / 记录写提交后 `publishChange`，
 * app 层订阅 `data.changed`，对在线用户逐个 `can(space.read)` 后推 `invalidate { keys }`（keys 与前端 Query key 同构）。
 * 不经 events 出箱：这是缓存失效，不是通知（不变量 3 只约束通知）。
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { SpaceRole, WorkspaceRole } from '../../shared/schemas/enums.ts'
import { type Actor, can, type SpaceRef } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { member, user } from '../db/schema/auth.ts'
import { spaceMembers, spaces } from '../db/schema/business.ts'
import { getEventBus } from '../lib/event-bus.ts'

/** ctx.silentRealtime：批量等外层事务内调用时抑制，由外层提交后统一发布。 */
export function publishChange(
  ctx: object,
  spaceIds: (string | null | undefined)[],
  keys: unknown[][],
): void {
  if ((ctx as { silentRealtime?: boolean }).silentRealtime) return
  const ids = [...new Set(spaceIds.filter((x): x is string => !!x))]
  if (ids.length) getEventBus().publish('data.changed', { spaceIds: ids, keys })
}

/** userIds 中可读任一 spaceIds 的用户（三条查询，与在线人数线性）。 */
export async function spaceReaders(
  db: DbOrTx,
  spaceIds: string[],
  userIds: string[],
): Promise<string[]> {
  if (!spaceIds.length || !userIds.length) return []
  const [sps, actors, roles] = await Promise.all([
    db.select().from(spaces).where(inArray(spaces.id, spaceIds)),
    db
      .select({ id: user.id, banned: user.banned, role: member.role })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(inArray(user.id, userIds)),
    db
      .select()
      .from(spaceMembers)
      .where(and(inArray(spaceMembers.spaceId, spaceIds), inArray(spaceMembers.userId, userIds))),
  ])
  const roleOf = new Map(roles.map((r) => [`${r.spaceId}:${r.userId}`, r.role as SpaceRole]))
  const out: string[] = []
  for (const a of actors) {
    const actor: Actor = {
      id: a.id,
      workspaceRole: a.role as WorkspaceRole,
      suspended: a.banned ?? false,
    }
    const ok = sps.some((s) => {
      const ref: SpaceRef = {
        id: s.id,
        visibility: s.visibility as SpaceRef['visibility'],
        isPersonal: s.isPersonal,
        createdBy: s.createdBy,
        archivedAt: s.archivedAt,
        deletedAt: null, // 软删 / 恢复的广播也要送达有权者，列表据此移除 / 出现
        memberRole: roleOf.get(`${s.id}:${a.id}`) ?? null,
      }
      return can(actor, 'space.read', ref)
    })
    if (ok) out.push(a.id)
  }
  return out
}

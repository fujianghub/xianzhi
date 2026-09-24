/** 由 userId 解析 authz Actor（collab 票据、作业用；会话中间件同规则）：非成员 → null。 */
import { eq } from 'drizzle-orm'
import { WORKSPACE_ROLES, type WorkspaceRole } from '../../shared/schemas/enums.ts'
import type { Actor } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { member, user } from '../db/schema/auth.ts'

export interface ResolvedActor {
  actor: Actor
  workspaceId: string
  name: string
  locale: string
}

export async function loadActor(db: DbOrTx, userId: string): Promise<ResolvedActor | null> {
  const [row] = await db
    .select({ u: user, role: member.role, workspaceId: member.organizationId })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)
  if (!row || !WORKSPACE_ROLES.includes(row.role as WorkspaceRole)) return null
  return {
    actor: {
      id: row.u.id,
      workspaceRole: row.role as WorkspaceRole,
      suspended: row.u.banned ?? false,
    },
    workspaceId: row.workspaceId,
    name: row.u.displayName || row.u.name,
    locale: row.u.locale ?? 'zh-CN',
  }
}

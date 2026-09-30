/**
 * 合并空间（ADR-0022、REQ-SPACE-013 ~ 015）：把源空间 A 的全部记录与任务并入目标空间 B，A 的成员并入 B，A 移入回收站。
 * - 权限：A 需 `space.delete`（工作区 owner / admin，合并后 A 被删）；B 需 `space.manage`。个人空间两端都不行；B 已归档不行（只读）。
 * - 记录与任务整体改 `space_id`：id 不变，评论 / 附件 / 关联 / 标签 / 收藏 / 历史都跟着走；A 回收站里的也一起搬，在 B 里仍可恢复。
 * - 目录：A 的顶层页按原顺序追加到 B 顶层末尾，子页层级不变；不在目录里的记录仍不在目录。
 * - 任务：每个状态列里 A 的任务按原顺序排到 B 原有任务之后（sort_key 重排，避免与 B 交错）。
 * - 成员：A 的显式成员并入 B，角色取两边较高者（A 里的角色已按工作区角色封顶，guest 至多 viewer）。
 * - 可见性：A 仅成员、B 全员可见时，A 的内容会对全工作区可见；不拦，dryRun 标出 `visibilityWidened`，由确认弹层警告。
 * - 不改记录 / 任务的 `updated_at`：合并不是内容编辑，既不打乱「最近更新」，也不让打开着的页面保存时撞 `ifUpdatedAt`。
 * - 同一事务完成；提交后对 A、B 广播 `entry.access_changed`，collab 重新 can()。审计 `space.merged`。
 */
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import type { z } from 'zod'
import { SPACE_ROLES, type SpaceRole } from '../../shared/schemas/enums.ts'
import type { mergeSpaceSchema } from '../../shared/schemas/spaces.ts'
import { assertCan } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { entries, entryTypes, spaceMembers, spaces, tasks } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { accessChanged, loadSpace, type SpaceCtx, type SpaceView, viewOf } from './spaces.ts'

export interface MergePreview {
  /** A 下未删除的记录 / 任务数（回收站里的也会一起搬，不计入） */
  entries: number
  tasks: number
  /** 将新加入 B 或在 B 里升级角色的成员数 */
  members: number
  /** A 仅成员、B 全员可见：A 的内容会对全工作区可见 */
  visibilityWidened: boolean
  from: { id: string; name: string }
  into: { id: string; name: string }
}

/** SPACE_ROLES 按权限从高到低排列：下标越小越高 */
const higher = (a: SpaceRole, b: SpaceRole) =>
  SPACE_ROLES.indexOf(a) <= SPACE_ROLES.indexOf(b) ? a : b

async function check(db: DbOrTx, ctx: SpaceCtx, key: string, intoKey: string) {
  const from = await loadSpace(db, ctx, key)
  const into = await loadSpace(db, ctx, intoKey)
  if (from.row.id === into.row.id)
    throw AppError.validation([{ path: 'into', message: '不能合并到自己' }])
  if (from.row.isPersonal || into.row.isPersonal) throw AppError.forbidden('个人空间不参与合并')
  assertCan(ctx.actor, 'space.delete', from.ref)
  assertCan(ctx.actor, 'space.manage', into.ref)
  if (into.row.archivedAt) throw AppError.forbidden('目标空间已归档，先取消归档')
  return { from: from.row, into: into.row }
}

const liveCount = async (db: DbOrTx, t: typeof entries | typeof tasks, spaceId: string) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.spaceId, spaceId), isNull(t.deletedAt)))
  return r?.n ?? 0
}

/** A 的成员里需要写进 B 的：B 里没有，或 A 里的角色更高 */
async function memberChanges(db: DbOrTx, fromId: string, intoId: string) {
  const rows = (id: string) =>
    db
      .select({ userId: spaceMembers.userId, role: spaceMembers.role })
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, id))
  const inB = new Map((await rows(intoId)).map((r) => [r.userId, r.role as SpaceRole]))
  return (await rows(fromId))
    .map((r) => {
      const a = r.role as SpaceRole
      const b = inB.get(r.userId)
      return { userId: r.userId, role: b ? higher(a, b) : a, changed: !b || higher(a, b) !== b }
    })
    .filter((m) => m.changed)
}

/** POST /spaces/:id/merge（REQ-SPACE-013 · 014）。 */
export async function mergeSpace(
  db: Db,
  ctx: SpaceCtx,
  key: string,
  input: z.infer<typeof mergeSpaceSchema>,
): Promise<{ preview: MergePreview; into?: SpaceView }> {
  const { from, into } = await check(db, ctx, key, input.into)
  const members = await memberChanges(db, from.id, into.id)
  const preview: MergePreview = {
    entries: await liveCount(db, entries, from.id),
    tasks: await liveCount(db, tasks, from.id),
    members: members.length,
    visibilityWidened: from.visibility === 'members' && into.visibility === 'workspace',
    from: { id: from.id, name: from.name },
    into: { id: into.id, name: into.name },
  }
  if (input.dryRun) return { preview }

  await db.transaction(async (tx) => {
    // 事务内重新校验，防止预览与执行之间状态变化（如 A 已被别人删除）
    await check(tx, ctx, from.id, into.id)
    const now = new Date()

    // 目录：A 的顶层页（在目录中的）按原顺序接到 B 顶层末尾。B 的末尾键把回收站里的也算上，免得恢复后与新键重复
    const [bTail] = await tx
      .select({ k: sql<string | null>`max(${entries.treeOrder})` })
      .from(entries)
      .where(
        and(eq(entries.spaceId, into.id), isNull(entries.parentId), isNotNull(entries.treeOrder)),
      )
    const tops = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(eq(entries.spaceId, from.id), isNull(entries.parentId), isNotNull(entries.treeOrder)),
      )
      .orderBy(asc(entries.treeOrder))
    const topKeys = generateNKeysBetween(bTail?.k ?? null, null, tops.length)
    for (const [i, e] of tops.entries())
      await tx.update(entries).set({ treeOrder: topKeys[i] }).where(eq(entries.id, e.id))
    await tx.update(entries).set({ spaceId: into.id }).where(eq(entries.spaceId, from.id))

    // 任务：每个状态列里 A 的任务排到 B 原有任务之后
    const statuses = await tx
      .selectDistinct({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.spaceId, from.id))
    for (const { status } of statuses) {
      const [tail] = await tx
        .select({ k: sql<string | null>`max(${tasks.sortKey})` })
        .from(tasks)
        .where(and(eq(tasks.spaceId, into.id), eq(tasks.status, status)))
      const moving = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.spaceId, from.id), eq(tasks.status, status)))
        .orderBy(asc(tasks.sortKey))
      const keys = generateNKeysBetween(tail?.k ?? null, null, moving.length)
      for (const [i, t] of moving.entries())
        await tx
          .update(tasks)
          .set({ sortKey: keys[i] as string })
          .where(eq(tasks.id, t.id))
    }
    await tx.update(tasks).set({ spaceId: into.id }).where(eq(tasks.spaceId, from.id))

    // 空间类型（ADR-0036）：改挂到 B（记录已随之搬过去）；与 B 已有类型重名时加后缀（截到 20 字）
    const moving = await tx
      .select({ id: entryTypes.id, name: entryTypes.name })
      .from(entryTypes)
      .where(eq(entryTypes.spaceId, from.id))
    if (moving.length) {
      const taken = new Set(
        (
          await tx
            .select({ name: entryTypes.name })
            .from(entryTypes)
            .where(eq(entryTypes.spaceId, into.id))
        ).map((r) => r.name),
      )
      for (const t of moving) {
        let name = t.name
        for (let n = 1; taken.has(name); n++) {
          const suffix = n === 1 ? '（合并）' : `（合并${n}）`
          name = `${t.name.slice(0, 20 - suffix.length)}${suffix}`
        }
        taken.add(name)
        await tx
          .update(entryTypes)
          .set({ spaceId: into.id, name, updatedAt: now })
          .where(eq(entryTypes.id, t.id))
      }
      // B 有显式启用清单：把搬来的类型追加进去（null 清单本就包含全部空间类型）
      await tx.execute(sql`
        update ${spaces} set enabled_kinds = enabled_kinds || ${JSON.stringify(
          moving.map((t) => `type:${t.id}`),
        )}::jsonb
        where id = ${into.id} and enabled_kinds is not null`)
    }

    // 成员：并入 B，角色取较高者（memberChanges 已算好）
    for (const m of members)
      await tx
        .insert(spaceMembers)
        .values({ spaceId: into.id, userId: m.userId, role: m.role })
        .onConflictDoUpdate({
          target: [spaceMembers.spaceId, spaceMembers.userId],
          set: { role: m.role },
        })

    await tx.update(spaces).set({ updatedAt: now }).where(eq(spaces.id, into.id))
    // A 成空壳移入回收站（30 天后 gc 清除）
    await tx.update(spaces).set({ deletedAt: now, updatedAt: now }).where(eq(spaces.id, from.id))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'space.merged',
      targetType: 'space',
      targetId: from.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: {
        name: from.name,
        slug: from.slug,
        intoId: into.id,
        intoName: into.name,
        entries: preview.entries,
        tasks: preview.tasks,
        members: preview.members,
        visibilityWidened: preview.visibilityWidened,
      },
    })
  })
  accessChanged(ctx, { spaceId: from.id })
  accessChanged(ctx, { spaceId: into.id })
  return { preview, into: await viewOf(db, ctx, into.id) }
}

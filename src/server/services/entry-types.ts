/**
 * 类型管理（ADR-0016 · 0017、REQ-ENTRY-018 ~ 020）。增删改一律仅所有者（`entry_type.create` / `entry_type.manage`）。
 * - 自定义类型：工作区共享，名字唯一、9 色板、有序状态列表（0–12）；其下记录 kind = 'custom'、type_id = 类型 id，
 *   fields = { status?, progress?, dueDate? }，status ∈ 状态列表。
 * - 内置类型：固定 9 种（属性 schema / 图标 / 正文模板在代码里）；可改名、改色（entry_kind_overrides），可删除、可恢复。
 * - 删除（内置或自定义）：其下全部记录（含回收站）转到 moveTo（缺省随笔），fields 按目标类型重建，同事务写审计。
 *   已删除的内置类型不能再新建 / 改成该类型；恢复后照常可用。
 * - 改状态列表：`renames` 一对一改名同步到记录；不再存在的状态改为新列表第一项（空列表 = 去掉 status）。
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import {
  type customFields,
  defaultEntryFields,
  entryFieldsByKind,
} from '../../shared/schemas/entryFields.ts'
import type {
  createEntryTypeSchema,
  patchBuiltinKindSchema,
  patchEntryTypeSchema,
} from '../../shared/schemas/entryTypes.ts'
import {
  BUILTIN_ENTRY_KINDS,
  type BuiltinEntryKind,
  type EntryKind,
} from '../../shared/schemas/enums.ts'
import { type Actor, assertCan, can, type TagRef } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { entries, entryKindOverrides, entryTypes } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { fieldsForRetype } from './entries.ts'

export interface EntryTypeCtx {
  actor: Actor
  workspaceId: string
  ip?: string | null
  userAgent?: string | null
}
export interface EntryTypeView {
  id: string
  name: string
  color: string
  statuses: string[]
  createdBy: string | null
  canManage: boolean
  /** 本人的类型（ADR-0017）：只有自己的类型能用来新建 / 改类型；别人的只用于显示其记录的名 / 色 / 状态 */
  mine: boolean
  /** 未删除的记录数（仅计数，不泄露对象） */
  usage: number
}
export interface BuiltinKindView {
  kind: BuiltinEntryKind
  /** 改过的名 / 色；null = 用默认（前端 i18n 名、固定色） */
  name: string | null
  color: string | null
  deleted: boolean
  usage: number
}
export interface EntryTypesList {
  builtin: BuiltinKindView[]
  items: EntryTypeView[]
  /** 可改 / 删 / 恢复内置类型（仅所有者） */
  canManageBuiltin: boolean
  canCreate: boolean
}

const conflict = () =>
  new AppError(409, 'CONFLICT_UNIQUE', '类型名已存在', {
    errors: [{ path: 'name', message: '类型名已存在' }],
  })
const isUnique = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}
const refOf = (t: { id: string; createdBy: string | null }): TagRef => ({
  id: t.id,
  createdBy: t.createdBy,
})

/** GET /entry-types：内置（含改名 / 改色 / 已删除）+ 自定义（数量级几十，不分页）。 */
export async function listEntryTypes(db: DbOrTx, ctx: EntryTypeCtx): Promise<EntryTypesList> {
  const [rows, overrides, usage] = await Promise.all([
    db
      .select()
      .from(entryTypes)
      .where(eq(entryTypes.workspaceId, ctx.workspaceId))
      .orderBy(asc(entryTypes.createdAt), asc(entryTypes.id)),
    db.select().from(entryKindOverrides).where(eq(entryKindOverrides.workspaceId, ctx.workspaceId)),
    db
      .select({
        kind: entries.kind,
        typeId: entries.typeId,
        n: sql<number>`count(*)::int`,
      })
      .from(entries)
      .where(and(eq(entries.workspaceId, ctx.workspaceId), sql`${entries.deletedAt} is null`))
      .groupBy(entries.kind, entries.typeId),
  ])
  const ov = new Map(overrides.map((o) => [o.kind, o]))
  const byKind = new Map<string, number>()
  const byType = new Map<string, number>()
  for (const u of usage) {
    if (u.typeId) byType.set(u.typeId, u.n)
    else byKind.set(u.kind, (byKind.get(u.kind) ?? 0) + u.n)
  }
  return {
    builtin: BUILTIN_ENTRY_KINDS.map((kind) => ({
      kind,
      name: ov.get(kind)?.name ?? null,
      color: ov.get(kind)?.color ?? null,
      deleted: ov.get(kind)?.deleted ?? false,
      usage: byKind.get(kind) ?? 0,
    })),
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      statuses: r.statuses ?? [],
      createdBy: r.createdBy,
      canManage: can(ctx.actor, 'entry_type.manage', refOf(r)),
      mine: r.createdBy === ctx.actor.id,
      usage: byType.get(r.id) ?? 0,
    })),
    canManageBuiltin: can(ctx.actor, 'entry_kind.manage', null),
    canCreate: can(ctx.actor, 'entry_type.create', null),
  }
}

async function getType(db: DbOrTx, ctx: EntryTypeCtx, id: string): Promise<EntryTypeView> {
  const found = (await listEntryTypes(db, ctx)).items.find((t) => t.id === id)
  if (!found) throw AppError.notFound('类型不存在')
  return found
}

/** 同工作区的自定义类型行（记录读写时校验用）；不存在 → null。 */
export async function loadEntryType(db: DbOrTx, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(entryTypes)
    .where(and(eq(entryTypes.id, id), eq(entryTypes.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

/** 本人的自定义类型（新建 / 改类型只能用自己的，ADR-0017）；别人的或不存在 → null。 */
export async function loadOwnEntryType(
  db: DbOrTx,
  ctx: { workspaceId: string; actor: Actor },
  id: string,
) {
  const row = await loadEntryType(db, ctx.workspaceId, id)
  return row && row.createdBy === ctx.actor.id ? row : null
}

/**
 * 自定义类型记录的 fields 规范化（创建 / PATCH / 批量共用）：status 须在状态列表里；
 * 未给 status 且列表非空 → 取第一项；列表为空 → 不允许 status。不合法 → 422。
 */
export function normalizeCustomFields(
  statuses: string[],
  fields: z.infer<typeof customFields>,
  opts: { fillDefault: boolean },
): z.infer<typeof customFields> {
  const out = { ...fields }
  if (out.status !== undefined && !statuses.includes(out.status))
    throw AppError.validation([
      {
        path: 'fields.status',
        message: statuses.length ? `状态须为：${statuses.join(' / ')}` : '该类型没有状态',
      },
    ])
  if (out.status === undefined && opts.fillDefault && statuses[0]) out.status = statuses[0]
  return out
}

export async function createEntryType(
  db: Db,
  ctx: EntryTypeCtx,
  input: z.infer<typeof createEntryTypeSchema>,
): Promise<EntryTypeView> {
  assertCan(ctx.actor, 'entry_type.create', null)
  try {
    const [row] = await db
      .insert(entryTypes)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        color: input.color,
        statuses: input.statuses,
        createdBy: ctx.actor.id,
      })
      .returning({ id: entryTypes.id })
    return getType(db, ctx, row?.id ?? '')
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
}

export async function patchEntryType(
  db: Db,
  ctx: EntryTypeCtx,
  id: string,
  input: z.infer<typeof patchEntryTypeSchema>,
): Promise<EntryTypeView> {
  const cur = await getType(db, ctx, id)
  assertCan(ctx.actor, 'entry_type.manage', refOf(cur))
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(entryTypes)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.color ? { color: input.color } : {}),
          ...(input.statuses ? { statuses: input.statuses } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(entryTypes.id, id), eq(entryTypes.workspaceId, ctx.workspaceId)))
      if (!input.statuses) return
      const next = input.statuses
      // 1) 一对一改名：旧名 → 新名（新名须在新列表里）
      for (const [from, to] of Object.entries(input.renames ?? {})) {
        if (!next.includes(to)) continue
        await tx.execute(sql`
          update ${entries} set fields = jsonb_set(fields, '{status}', to_jsonb(${to}::text)), updated_at = now()
          where type_id = ${id} and fields ->> 'status' = ${from}`)
      }
      // 2) 不再存在的状态：改为新列表第一项；新列表为空 → 去掉 status
      const keep = sql.join(
        next.map((v) => sql`${v}`),
        sql`, `,
      )
      const stale = next.length
        ? sql`fields ? 'status' and fields ->> 'status' not in (${keep})`
        : sql`fields ? 'status'`
      await tx.execute(sql`
        update ${entries} set fields = ${
          next[0]
            ? sql`jsonb_set(fields, '{status}', to_jsonb(${next[0]}::text))`
            : sql`fields - 'status'`
        }, updated_at = now()
        where type_id = ${id} and ${stale}`)
    })
  } catch (err) {
    if (isUnique(err)) throw conflict()
    throw err
  }
  return getType(db, ctx, id)
}

/** 已删除的内置类型：不能新建或改成该类型（ADR-0017）。 */
export async function assertBuiltinAlive(db: DbOrTx, workspaceId: string, kind: EntryKind) {
  if (kind === 'custom') return
  const [o] = await db
    .select({ deleted: entryKindOverrides.deleted })
    .from(entryKindOverrides)
    .where(and(eq(entryKindOverrides.workspaceId, workspaceId), eq(entryKindOverrides.kind, kind)))
  if (o?.deleted) throw AppError.validation([{ path: 'kind', message: '该类型已删除' }])
}

/**
 * 解析删除时的转入目标：缺省随笔；不能是被删的类型本身、已删除的内置类型，
 * 也不能是有无默认值必填属性的类型（迭代 / 变更 / 复盘）。
 */
async function resolveMoveTo(
  db: DbOrTx,
  ctx: EntryTypeCtx,
  moveTo: string | undefined,
  from: { kind: EntryKind; typeId: string | null },
): Promise<{ kind: EntryKind; typeId: string | null }> {
  const bad = (message: string) => AppError.validation([{ path: 'moveTo', message }])
  const target =
    moveTo === undefined
      ? { kind: 'note' as EntryKind, typeId: null }
      : (BUILTIN_ENTRY_KINDS as readonly string[]).includes(moveTo)
        ? { kind: moveTo as EntryKind, typeId: null }
        : { kind: 'custom' as EntryKind, typeId: moveTo }
  if (target.kind === from.kind && target.typeId === from.typeId)
    throw bad(moveTo === undefined ? '删除随笔时须选择记录转到哪个类型' : '不能转到被删除的类型')
  if (target.kind === 'custom') {
    // 内置类型全员共用：删它时只能转到内置类型，不能把大家的记录转进某人的私有类型
    if (from.kind !== 'custom') throw bad('内置类型只能转到另一个内置类型')
    if (!target.typeId || !(await loadOwnEntryType(db, ctx, target.typeId)))
      throw bad('目标类型不存在')
    return target
  }
  if (!entryFieldsByKind[target.kind].safeParse(defaultEntryFields[target.kind]).success)
    throw bad('目标类型有必填属性，不能作为批量转入目标')
  try {
    await assertBuiltinAlive(db, ctx.workspaceId, target.kind)
  } catch {
    throw bad('目标类型已删除')
  }
  return target
}

/** 把某类型下的全部记录（含回收站）转到目标类型，fields 按目标重建（保留仍合法的状态 / 进度）。返回条数。 */
async function convertEntries(
  tx: DbOrTx,
  ctx: EntryTypeCtx,
  from: { kind: EntryKind; typeId: string | null },
  to: { kind: EntryKind; typeId: string | null },
): Promise<number> {
  const rows = await tx
    .select({ id: entries.id, fields: entries.fields })
    .from(entries)
    .where(
      and(
        eq(entries.workspaceId, ctx.workspaceId),
        from.typeId
          ? eq(entries.typeId, from.typeId)
          : and(eq(entries.kind, from.kind), sql`${entries.typeId} is null`),
      ),
    )
  for (const r of rows) {
    const fields = await fieldsForRetype(
      tx,
      ctx,
      (r.fields ?? {}) as Record<string, unknown>,
      to.kind,
      to.typeId,
    )
    await tx
      .update(entries)
      .set({ kind: to.kind, typeId: to.typeId, fields, updatedAt: new Date() })
      .where(eq(entries.id, r.id))
  }
  return rows.length
}

/** DELETE /entry-types/:id?moveTo=：其下记录（含回收站）转到目标类型，再删类型；审计留痕。 */
export async function deleteEntryType(
  db: Db,
  ctx: EntryTypeCtx,
  id: string,
  moveTo?: string,
): Promise<void> {
  const cur = await getType(db, ctx, id)
  assertCan(ctx.actor, 'entry_type.manage', refOf(cur))
  const from = { kind: 'custom' as EntryKind, typeId: id }
  const to = await resolveMoveTo(db, ctx, moveTo, from)
  await db.transaction(async (tx) => {
    const n = await convertEntries(tx, ctx, from, to)
    await tx
      .delete(entryTypes)
      .where(and(eq(entryTypes.id, id), eq(entryTypes.workspaceId, ctx.workspaceId)))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'entry_type.deleted',
      targetType: 'entry_type',
      targetId: id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { name: cur.name, entriesConverted: n, moveTo: to.typeId ?? to.kind },
    })
  })
}

async function upsertOverride(
  db: DbOrTx,
  ctx: EntryTypeCtx,
  kind: BuiltinEntryKind,
  set: { name?: string | null; color?: string | null; deleted?: boolean },
) {
  await db
    .insert(entryKindOverrides)
    .values({ workspaceId: ctx.workspaceId, kind, ...set })
    .onConflictDoUpdate({
      target: [entryKindOverrides.workspaceId, entryKindOverrides.kind],
      set: { ...set, updatedAt: new Date() },
    })
}

/** PATCH /entry-types/builtin/:kind { name?, color? }：改名 / 改色（null = 恢复默认）。 */
export async function patchBuiltinKind(
  db: Db,
  ctx: EntryTypeCtx,
  kind: BuiltinEntryKind,
  input: z.infer<typeof patchBuiltinKindSchema>,
): Promise<EntryTypesList> {
  assertCan(ctx.actor, 'entry_kind.manage', null)
  if (input.name) {
    const clash = await db
      .select({ id: entryTypes.id })
      .from(entryTypes)
      .where(and(eq(entryTypes.workspaceId, ctx.workspaceId), eq(entryTypes.name, input.name)))
    if (clash.length) throw conflict()
  }
  await upsertOverride(db, ctx, kind, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
  })
  return listEntryTypes(db, ctx)
}

/** DELETE /entry-types/builtin/:kind?moveTo=：其下记录转走后标记已删除（可恢复）；审计留痕。 */
export async function deleteBuiltinKind(
  db: Db,
  ctx: EntryTypeCtx,
  kind: BuiltinEntryKind,
  moveTo?: string,
): Promise<EntryTypesList> {
  assertCan(ctx.actor, 'entry_kind.manage', null)
  const from = { kind: kind as EntryKind, typeId: null }
  const to = await resolveMoveTo(db, ctx, moveTo, from)
  await db.transaction(async (tx) => {
    const n = await convertEntries(tx, ctx, from, to)
    await upsertOverride(tx, ctx, kind, { deleted: true })
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'entry_type.deleted',
      targetType: 'entry_kind',
      targetId: kind,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { kind, entriesConverted: n, moveTo: to.typeId ?? to.kind },
    })
  })
  return listEntryTypes(db, ctx)
}

/** POST /entry-types/builtin/:kind/restore：恢复已删除的内置类型。 */
export async function restoreBuiltinKind(
  db: Db,
  ctx: EntryTypeCtx,
  kind: BuiltinEntryKind,
): Promise<EntryTypesList> {
  assertCan(ctx.actor, 'entry_kind.manage', null)
  await upsertOverride(db, ctx, kind, { deleted: false })
  return listEntryTypes(db, ctx)
}

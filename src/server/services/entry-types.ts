/**
 * 记录类型管理（ADR-0016、REQ-ENTRY-018 · 019）。
 * - 自定义类型：工作区共享，名字唯一、9 色板、有序状态列表（0–12）。创建 = 非 guest；改 / 删 = 管理员或创建者（entry_type.manage）。
 *   其下记录 kind = 'custom'、type_id = 类型 id；fields = { status?, progress?, dueDate? }，status ∈ 状态列表。
 * - 内置类型：固定 9 种；管理员可「隐藏」（只影响筛选条与新建菜单，已有记录照常显示）。
 * - 删自定义类型：其下全部记录（含回收站）转为随手记、清空 fields，同事务，写审计。
 * - 改状态列表：`renames` 一对一改名同步到记录；不再存在的状态改为新列表第一项（空列表 = 去掉 status）。
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { customFields } from '../../shared/schemas/entryFields.ts'
import type {
  createEntryTypeSchema,
  patchEntryTypeSchema,
} from '../../shared/schemas/entryTypes.ts'
import { BUILTIN_ENTRY_KINDS, type BuiltinEntryKind } from '../../shared/schemas/enums.ts'
import { type Actor, assertCan, can, type TagRef } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { entries, entryTypes, hiddenEntryKinds } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'

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
  /** 未删除的记录数（仅计数，不泄露对象） */
  usage: number
}
export interface BuiltinKindView {
  kind: BuiltinEntryKind
  hidden: boolean
  usage: number
}
export interface EntryTypesList {
  builtin: BuiltinKindView[]
  items: EntryTypeView[]
  /** 可隐藏 / 显示内置类型（管理员） */
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

/** GET /entry-types：内置（含隐藏标记）+ 自定义（数量级几十，不分页）。 */
export async function listEntryTypes(db: DbOrTx, ctx: EntryTypeCtx): Promise<EntryTypesList> {
  const [rows, hidden, usage] = await Promise.all([
    db
      .select()
      .from(entryTypes)
      .where(eq(entryTypes.workspaceId, ctx.workspaceId))
      .orderBy(asc(entryTypes.createdAt), asc(entryTypes.id)),
    db
      .select({ kind: hiddenEntryKinds.kind })
      .from(hiddenEntryKinds)
      .where(eq(hiddenEntryKinds.workspaceId, ctx.workspaceId)),
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
  const hiddenSet = new Set(hidden.map((h) => h.kind))
  const byKind = new Map<string, number>()
  const byType = new Map<string, number>()
  for (const u of usage) {
    if (u.typeId) byType.set(u.typeId, u.n)
    else byKind.set(u.kind, (byKind.get(u.kind) ?? 0) + u.n)
  }
  return {
    builtin: BUILTIN_ENTRY_KINDS.map((kind) => ({
      kind,
      hidden: hiddenSet.has(kind),
      usage: byKind.get(kind) ?? 0,
    })),
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      statuses: r.statuses ?? [],
      createdBy: r.createdBy,
      canManage: can(ctx.actor, 'entry_type.manage', refOf(r)),
      usage: byType.get(r.id) ?? 0,
    })),
    canManageBuiltin: can(ctx.actor, 'entry_type.manage', null),
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

/** DELETE /entry-types/:id：其下记录（含回收站）转为随手记、清空 fields，再删类型；审计留痕。 */
export async function deleteEntryType(db: Db, ctx: EntryTypeCtx, id: string): Promise<void> {
  const cur = await getType(db, ctx, id)
  assertCan(ctx.actor, 'entry_type.manage', refOf(cur))
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(entries)
      .set({ kind: 'note', typeId: null, fields: {}, updatedAt: new Date() })
      .where(eq(entries.typeId, id))
      .returning({ id: entries.id })
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
      meta: { name: cur.name, entriesConverted: moved.length },
    })
  })
}

/** PUT /entry-types/builtin/:kind { hidden }：仅管理员。 */
export async function setBuiltinHidden(
  db: Db,
  ctx: EntryTypeCtx,
  kind: BuiltinEntryKind,
  hidden: boolean,
): Promise<EntryTypesList> {
  assertCan(ctx.actor, 'entry_type.manage', null)
  if (hidden)
    await db
      .insert(hiddenEntryKinds)
      .values({ workspaceId: ctx.workspaceId, kind })
      .onConflictDoNothing()
  else
    await db
      .delete(hiddenEntryKinds)
      .where(
        and(eq(hiddenEntryKinds.workspaceId, ctx.workspaceId), eq(hiddenEntryKinds.kind, kind)),
      )
  return listEntryTypes(db, ctx)
}

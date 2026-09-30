/**
 * 类型管理（ADR-0016 · 0017 · 0036、REQ-ENTRY-018 ~ 020 · 027 · 028 · 029、REQ-KB-015）。
 * - 个人类型（space_id null）：本人所有、本人使用与管理（ADR-0017）。
 * - 空间类型（space_id 非 null，ADR-0036）：属于该空间，空间管理员维护（空间须可写、非个人空间），
 *   空间成员在该空间里使用；列表按空间可见性过滤（回收站 / 不可读空间的类型不出现）。
 * - 内置类型：固定 9 种（属性 schema / 图标 / 正文模板在代码里）；可改名、改色、追加字段（entry_kind_overrides，仅所有者），
 *   可删除、可恢复。
 * - 自定义 / 空间类型 fields = { status?, progress?, dueDate? } + 字段定义给出的 x 键；status ∈ 状态列表。
 * - 改字段定义：整组替换；去掉的字段、删掉的选项同事务清空记录与模板里的值，选项改名同步值，审计 entry_type.fields_changed。
 * - 删除（内置或自定义）：其下全部记录（含回收站）转到 moveTo（缺省随笔），fields 按目标类型重建；
 *   绑它的模板转随笔；各空间启用清单里的该项清掉。同事务写审计。
 */
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { z } from 'zod'
import {
  type customFields,
  defaultEntryFields,
  entryFieldsByKind,
} from '../../shared/schemas/entryFields.ts'
import type {
  createEntryTypeSchema,
  fieldDefsInputSchema,
  optionRenamesSchema,
  patchBuiltinKindSchema,
  patchEntryTypeSchema,
} from '../../shared/schemas/entryTypes.ts'
import {
  BUILTIN_ENTRY_KINDS,
  type BuiltinEntryKind,
  type EntryKind,
} from '../../shared/schemas/enums.ts'
import {
  extraValueError,
  type FieldDef,
  fieldDefsSchema,
  newExtraFieldKey,
} from '../../shared/schemas/fieldDefs.ts'
import {
  type Actor,
  assertCan,
  can,
  type SpaceRef,
  type TagRef,
  visibleSpacesWhere,
} from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import {
  entries,
  entryKindOverrides,
  entryTemplates,
  entryTypes,
  spaces,
} from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { fieldsForRetype, loadSpaceRef } from './entries.ts'

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
  /** 状态颜色（ADR-0036）：状态名 → 色板色 */
  statusColors: Record<string, string>
  /** 字段定义（ADR-0036） */
  fieldDefs: FieldDef[]
  /** 空间类型所属空间；null = 个人类型 */
  spaceId: string | null
  createdBy: string | null
  canManage: boolean
  /** 本人的个人类型（ADR-0017） */
  mine: boolean
  /** 本人能否用它新建 / 改类型：本人的个人类型，或本人可写空间的空间类型（仅限该空间，ADR-0036） */
  usable: boolean
  /** 未删除的记录数（仅计数，不泄露对象） */
  usage: number
}
export interface BuiltinKindView {
  kind: BuiltinEntryKind
  /** 改过的名 / 色；null = 用默认（前端 i18n 名、固定色） */
  name: string | null
  color: string | null
  deleted: boolean
  /** 追加的字段（ADR-0036、REQ-ENTRY-028） */
  fieldDefs: FieldDef[]
  usage: number
}
export interface EntryTypesList {
  builtin: BuiltinKindView[]
  items: EntryTypeView[]
  /** 可改 / 删 / 恢复内置类型、追加内置字段（仅所有者） */
  canManageBuiltin: boolean
  canCreate: boolean
}

type TypeRow = typeof entryTypes.$inferSelect

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

/**
 * 空间类型可由谁维护（ADR-0036、REQ-KB-015）：`can('space.manage')`（空间管理员 / 工作区管理员）
 * 且空间可写（未归档）、非个人空间（个人空间用个人类型）。
 */
export const canManageSpaceTypes = (actor: Actor, s: SpaceRef) =>
  can(actor, 'space.manage', s) && s.archivedAt === null && !s.isPersonal

async function spaceRefs(db: DbOrTx, actor: Actor, ids: string[]) {
  const out = new Map<string, SpaceRef>()
  for (const id of new Set(ids)) {
    const r = await loadSpaceRef(db, actor, id)
    if (r) out.set(id, r.ref)
  }
  return out
}

/** GET /entry-types：内置（含改名 / 改色 / 已删除 / 追加字段）+ 自定义（个人 + 可见空间的空间类型；数量级几十，不分页）。 */
export async function listEntryTypes(db: DbOrTx, ctx: EntryTypeCtx): Promise<EntryTypesList> {
  const visibleSpaceIds = db
    .select({ id: spaces.id })
    .from(spaces)
    .where(visibleSpacesWhere(ctx.actor))
  const [rows, overrides, usage] = await Promise.all([
    db
      .select()
      .from(entryTypes)
      .where(
        and(
          eq(entryTypes.workspaceId, ctx.workspaceId),
          or(isNull(entryTypes.spaceId), inArray(entryTypes.spaceId, visibleSpaceIds)),
        ),
      )
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
  const refs = await spaceRefs(
    db,
    ctx.actor,
    rows.flatMap((r) => (r.spaceId ? [r.spaceId] : [])),
  )
  return {
    builtin: BUILTIN_ENTRY_KINDS.map((kind) => ({
      kind,
      name: ov.get(kind)?.name ?? null,
      color: ov.get(kind)?.color ?? null,
      deleted: ov.get(kind)?.deleted ?? false,
      fieldDefs: ov.get(kind)?.fieldDefs ?? [],
      usage: byKind.get(kind) ?? 0,
    })),
    items: rows.map((r) => {
      const sp = r.spaceId ? refs.get(r.spaceId) : undefined
      const mine = !r.spaceId && r.createdBy === ctx.actor.id
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        statuses: r.statuses ?? [],
        statusColors: r.statusColors ?? {},
        fieldDefs: r.fieldDefs ?? [],
        spaceId: r.spaceId,
        createdBy: r.createdBy,
        canManage: sp
          ? canManageSpaceTypes(ctx.actor, sp)
          : can(ctx.actor, 'entry_type.manage', refOf(r)),
        mine,
        usable: sp
          ? can(ctx.actor, 'entry.create', sp)
          : mine && ctx.actor.workspaceRole !== 'guest',
        usage: byType.get(r.id) ?? 0,
      }
    }),
    canManageBuiltin: can(ctx.actor, 'entry_kind.manage', null),
    canCreate: can(ctx.actor, 'entry_type.create', null),
  }
}

async function getType(db: DbOrTx, ctx: EntryTypeCtx, id: string): Promise<EntryTypeView> {
  const found = (await listEntryTypes(db, ctx)).items.find((t) => t.id === id)
  if (!found) throw AppError.notFound('类型不存在')
  return found
}

/** 管理权限：个人类型 = 本人；空间类型 = canManageSpaceTypes */
async function assertManage(db: DbOrTx, ctx: EntryTypeCtx, t: EntryTypeView) {
  if (!t.spaceId) return assertCan(ctx.actor, 'entry_type.manage', refOf(t))
  const sp = await loadSpaceRef(db, ctx.actor, t.spaceId)
  if (!sp || !canManageSpaceTypes(ctx.actor, sp.ref))
    throw AppError.forbidden('无权管理该空间的类型')
}

/** 同工作区的自定义类型行（记录读写时校验用）；不存在 → null。 */
export async function loadEntryType(
  db: DbOrTx,
  workspaceId: string,
  id: string,
): Promise<TypeRow | null> {
  const [row] = await db
    .select()
    .from(entryTypes)
    .where(and(eq(entryTypes.id, id), eq(entryTypes.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

/** 本人的个人类型（ADR-0017）；别人的、空间类型或不存在 → null。 */
export async function loadOwnEntryType(
  db: DbOrTx,
  ctx: { workspaceId: string; actor: Actor },
  id: string,
) {
  const row = await loadEntryType(db, ctx.workspaceId, id)
  return row && !row.spaceId && row.createdBy === ctx.actor.id ? row : null
}

/**
 * 在某空间新建 / 改类型时可用的类型（ADR-0036、REQ-ENTRY-029）：本人的个人类型，或该空间的空间类型。
 * 能否在该空间写记录由调用方的 entry.create / entry.write 决定。
 */
export async function loadUsableEntryType(
  db: DbOrTx,
  ctx: { workspaceId: string; actor: Actor },
  id: string,
  spaceId: string,
) {
  const row = await loadEntryType(db, ctx.workspaceId, id)
  if (!row) return null
  if (row.spaceId) return row.spaceId === spaceId ? row : null
  return row.createdBy === ctx.actor.id ? row : null
}

/** 内置类型追加的字段定义（ADR-0036、REQ-ENTRY-028） */
export async function builtinFieldDefs(
  db: DbOrTx,
  workspaceId: string,
  kind: EntryKind,
): Promise<FieldDef[]> {
  if (kind === 'custom') return []
  const [o] = await db
    .select({ defs: entryKindOverrides.fieldDefs })
    .from(entryKindOverrides)
    .where(and(eq(entryKindOverrides.workspaceId, workspaceId), eq(entryKindOverrides.kind, kind)))
  return o?.defs ?? []
}

/**
 * 自定义 / 空间类型记录的 status 规范化（创建 / PATCH / 批量共用）：status 须在状态列表里；
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

/**
 * 自定义字段（x 键）按定义规范化（ADR-0036、REQ-ENTRY-027）：未定义的键静默丢弃（定义可能刚被删，
 * 打开中的页面仍会带着旧键），空值去掉；类型 / 选项不符 → 422。必填只作提示，不拦。
 */
export function normalizeExtraFields(
  defs: FieldDef[],
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const errors: { path: string; message: string }[] = []
  for (const [k, v] of Object.entries(extra)) {
    const def = defs.find((d) => d.key === k)
    if (!def) continue
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    const msg = extraValueError(def, v)
    if (msg) errors.push({ path: `fields.${k}`, message: `${def.label}：${msg}` })
    else out[k] = v
  }
  if (errors.length) throw AppError.validation(errors)
  return out
}

/**
 * 字段定义输入 → 存储：新字段生成键；已有字段须带原键、类型不可改；整组按 fieldDefsSchema 校验。
 */
function resolveFieldDefs(
  prev: FieldDef[],
  input: z.infer<typeof fieldDefsInputSchema>,
): FieldDef[] {
  const taken = [...prev.map((d) => d.key), ...input.flatMap((d) => (d.key ? [d.key] : []))]
  const out: FieldDef[] = input.map((d, i) => {
    if (d.key) {
      const old = prev.find((p) => p.key === d.key)
      if (!old) throw AppError.validation([{ path: `fieldDefs.${i}.key`, message: '字段不存在' }])
      if (old.type !== d.type)
        throw AppError.validation([
          { path: `fieldDefs.${i}.type`, message: '字段类型建好后不能改，请新建字段' },
        ])
    }
    const key = d.key ?? newExtraFieldKey(taken)
    taken.push(key)
    return {
      key,
      label: d.label,
      type: d.type,
      ...(d.options?.length ? { options: d.options } : {}),
      ...(d.required ? { required: true } : {}),
    }
  })
  const r = fieldDefsSchema.safeParse(out)
  if (!r.success)
    throw AppError.validation(
      r.error.issues.map((i) => ({ path: ['fieldDefs', ...i.path].join('.'), message: i.message })),
    )
  return r.data
}

/**
 * 字段定义变更同步到数据（记录 + 模板，同事务）：去掉的字段清值；选项改名同步；删掉的选项清值（单选去键、多选去该项）。
 * `scope` = 该类型的记录 / 模板条件。返回受影响的记录数（用于审计）。
 */
async function applyFieldDefChanges(
  tx: DbOrTx,
  scope: { entries: SQL; templates: SQL },
  prev: FieldDef[],
  next: FieldDef[],
  renames: z.infer<typeof optionRenamesSchema> = {},
): Promise<number> {
  let touched = 0
  const run = async (table: typeof entries | typeof entryTemplates, where: SQL, stmt: SQL) => {
    const r = await tx.execute(sql`update ${table} set fields = ${stmt} where ${where}`)
    if (table === entries) touched += (r as unknown as { rowCount?: number }).rowCount ?? 0
  }
  for (const [table, where] of [
    [entries, scope.entries],
    [entryTemplates, scope.templates],
  ] as const) {
    for (const old of prev) {
      const key = sql.raw(`'${old.key}'`) // 键已按 /^x[A-Z]{6}$/ 校验
      const cur = next.find((d) => d.key === old.key)
      if (!cur) {
        await run(table, sql`${where} and fields ? ${key}`, sql`fields - ${key}`)
        continue
      }
      if (cur.type !== 'select' && cur.type !== 'multiselect') continue
      const names = new Set((cur.options ?? []).map((o) => o.name))
      for (const [from, to] of Object.entries(renames[old.key] ?? {})) {
        if (!names.has(to)) continue
        if (cur.type === 'select')
          await run(
            table,
            sql`${where} and fields ->> ${key} = ${from}`,
            sql`jsonb_set(fields, array[${key}], to_jsonb(${to}::text))`,
          )
        else
          await run(
            table,
            sql`${where} and jsonb_typeof(fields -> ${key}) = 'array' and fields -> ${key} ? ${from}`,
            sql`jsonb_set(fields, array[${key}], (select coalesce(jsonb_agg(distinct case when v = ${from} then ${to} else v end), '[]'::jsonb) from jsonb_array_elements_text(fields -> ${key}) v))`,
          )
      }
      const keep = [...names]
      const keepSql = keep.length
        ? sql`array[${sql.join(
            keep.map((n) => sql`${n}`),
            sql`, `,
          )}]::text[]`
        : sql`array[]::text[]`
      if (cur.type === 'select')
        await run(
          table,
          sql`${where} and fields ? ${key} and not ((fields ->> ${key}) = any(${keepSql}))`,
          sql`fields - ${key}`,
        )
      else
        await run(
          table,
          sql`${where} and jsonb_typeof(fields -> ${key}) = 'array' and exists (select 1 from jsonb_array_elements_text(fields -> ${key}) v where not (v = any(${keepSql})))`,
          sql`case when (select count(*) from jsonb_array_elements_text(fields -> ${key}) v where v = any(${keepSql})) = 0 then fields - ${key} else jsonb_set(fields, array[${key}], (select jsonb_agg(v) from jsonb_array_elements_text(fields -> ${key}) v where v = any(${keepSql}))) end`,
        )
    }
  }
  return touched
}

const typeScope = (id: string) => ({
  entries: sql`${entries.typeId} = ${id}`,
  templates: sql`${entryTemplates.typeId} = ${id}`,
})
const kindScope = (workspaceId: string, kind: string) => ({
  entries: sql`${entries.workspaceId} = ${workspaceId} and ${entries.kind} = ${kind} and ${entries.typeId} is null`,
  templates: sql`${entryTemplates.workspaceId} = ${workspaceId} and ${entryTemplates.kind} = ${kind} and ${entryTemplates.typeId} is null`,
})

async function auditFieldsChanged(
  tx: DbOrTx,
  ctx: EntryTypeCtx,
  target: { type: 'entry_type' | 'entry_kind'; id: string },
  meta: Record<string, unknown>,
) {
  await audit(tx, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'entry_type.fields_changed',
    targetType: target.type,
    targetId: target.id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta,
  })
}

const statusColorsFor = (statuses: string[], colors: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(colors ?? {}).filter(([k]) => statuses.includes(k)))

export async function createEntryType(
  db: Db,
  ctx: EntryTypeCtx,
  input: z.infer<typeof createEntryTypeSchema>,
): Promise<EntryTypeView> {
  assertCan(ctx.actor, 'entry_type.create', null)
  if (input.spaceId) {
    const sp = await loadSpaceRef(db, ctx.actor, input.spaceId)
    if (!sp || sp.row.workspaceId !== ctx.workspaceId || !can(ctx.actor, 'space.read', sp.ref))
      throw AppError.notFound('空间不存在')
    if (sp.row.isPersonal)
      throw AppError.validation([{ path: 'spaceId', message: '个人空间请用个人类型' }])
    if (!canManageSpaceTypes(ctx.actor, sp.ref)) throw AppError.forbidden('无权管理该空间的类型')
  }
  const fieldDefs = resolveFieldDefs([], input.fieldDefs ?? [])
  try {
    const [row] = await db
      .insert(entryTypes)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        color: input.color,
        statuses: input.statuses,
        statusColors: statusColorsFor(input.statuses, input.statusColors),
        fieldDefs,
        spaceId: input.spaceId ?? null,
        createdBy: ctx.actor.id,
      })
      .returning({ id: entryTypes.id })
    // 空间已有显式启用清单：新类型追加到末尾（null 清单本就包含全部空间类型）
    if (input.spaceId && row)
      await db.execute(sql`
        update ${spaces} set enabled_kinds = enabled_kinds || jsonb_build_array(${`type:${row.id}`}::text)
        where id = ${input.spaceId} and enabled_kinds is not null`)
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
  await assertManage(db, ctx, cur)
  const nextDefs = input.fieldDefs ? resolveFieldDefs(cur.fieldDefs, input.fieldDefs) : null
  const statuses = input.statuses ?? cur.statuses
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(entryTypes)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.color ? { color: input.color } : {}),
          ...(input.statuses ? { statuses: input.statuses } : {}),
          ...(input.statusColors || input.statuses
            ? {
                statusColors: statusColorsFor(statuses, {
                  ...renamedColors(cur.statusColors, input.renames),
                  ...(input.statusColors ?? {}),
                }),
              }
            : {}),
          ...(nextDefs ? { fieldDefs: nextDefs } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(entryTypes.id, id), eq(entryTypes.workspaceId, ctx.workspaceId)))
      if (nextDefs) {
        const n = await applyFieldDefChanges(
          tx,
          typeScope(id),
          cur.fieldDefs,
          nextDefs,
          input.optionRenames,
        )
        if (n)
          await auditFieldsChanged(
            tx,
            ctx,
            { type: 'entry_type', id },
            {
              name: cur.name,
              entriesChanged: n,
            },
          )
      }
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

/** 状态改名时颜色跟着走 */
function renamedColors(colors: Record<string, string>, renames?: Record<string, string>) {
  const out = { ...colors }
  for (const [from, to] of Object.entries(renames ?? {}))
    if (out[from]) {
      out[to] = out[from]
      delete out[from]
    }
  return out
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
 * 自定义目标：删个人类型 → 本人的另一个个人类型；删空间类型 → 同空间的另一个空间类型（ADR-0036）。
 */
async function resolveMoveTo(
  db: DbOrTx,
  ctx: EntryTypeCtx,
  moveTo: string | undefined,
  from: { kind: EntryKind; typeId: string | null; spaceId?: string | null },
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
    const t = target.typeId ? await loadEntryType(db, ctx.workspaceId, target.typeId) : null
    const ok =
      !!t &&
      (from.spaceId ? t.spaceId === from.spaceId : !t.spaceId && t.createdBy === ctx.actor.id)
    if (!ok) throw bad('目标类型不存在')
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

/** 把某类型下的全部记录（含回收站）转到目标类型，fields 按目标重建（保留仍合法的状态 / 进度 / 同键字段）。返回条数。 */
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

/** 删类型前：绑它的模板转随笔（fields 清空），各空间启用清单去掉该项（ADR-0036） */
async function detachType(tx: DbOrTx, workspaceId: string, id: string) {
  await tx
    .update(entryTemplates)
    .set({ kind: 'note', typeId: null, fields: {}, updatedAt: new Date() })
    .where(and(eq(entryTemplates.workspaceId, workspaceId), eq(entryTemplates.typeId, id)))
  await removeEnabledKind(tx, workspaceId, `type:${id}`)
}

/** 从各空间启用清单里去掉某项（jsonb 数组的 `-` 按字符串元素删除） */
export async function removeEnabledKind(tx: DbOrTx, workspaceId: string, item: string) {
  await tx.execute(sql`
    update ${spaces} set enabled_kinds = enabled_kinds - ${item}
    where workspace_id = ${workspaceId} and enabled_kinds ? ${item}`)
}

/** DELETE /entry-types/:id?moveTo=：其下记录（含回收站）转到目标类型，再删类型；审计留痕。 */
export async function deleteEntryType(
  db: Db,
  ctx: EntryTypeCtx,
  id: string,
  moveTo?: string,
): Promise<void> {
  const cur = await getType(db, ctx, id)
  await assertManage(db, ctx, cur)
  const from = { kind: 'custom' as EntryKind, typeId: id, spaceId: cur.spaceId }
  const to = await resolveMoveTo(db, ctx, moveTo, from)
  await db.transaction(async (tx) => {
    const n = await convertEntries(tx, ctx, from, to)
    await detachType(tx, ctx.workspaceId, id)
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
      meta: {
        name: cur.name,
        spaceId: cur.spaceId,
        entriesConverted: n,
        moveTo: to.typeId ?? to.kind,
      },
    })
  })
}

async function upsertOverride(
  db: DbOrTx,
  ctx: EntryTypeCtx,
  kind: BuiltinEntryKind,
  set: { name?: string | null; color?: string | null; deleted?: boolean; fieldDefs?: FieldDef[] },
) {
  await db
    .insert(entryKindOverrides)
    .values({ workspaceId: ctx.workspaceId, kind, ...set })
    .onConflictDoUpdate({
      target: [entryKindOverrides.workspaceId, entryKindOverrides.kind],
      set: { ...set, updatedAt: new Date() },
    })
}

/** PATCH /entry-types/builtin/:kind { name?, color?, fieldDefs? }：改名 / 改色（null = 恢复默认）/ 追加字段。 */
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
      .where(
        and(
          eq(entryTypes.workspaceId, ctx.workspaceId),
          eq(entryTypes.name, input.name),
          isNull(entryTypes.spaceId),
        ),
      )
    if (clash.length) throw conflict()
  }
  const prevDefs = await builtinFieldDefs(db, ctx.workspaceId, kind)
  const nextDefs = input.fieldDefs ? resolveFieldDefs(prevDefs, input.fieldDefs) : null
  await db.transaction(async (tx) => {
    await upsertOverride(tx, ctx, kind, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(nextDefs ? { fieldDefs: nextDefs } : {}),
    })
    if (nextDefs) {
      const n = await applyFieldDefChanges(
        tx,
        kindScope(ctx.workspaceId, kind),
        prevDefs,
        nextDefs,
        input.optionRenames,
      )
      if (n)
        await auditFieldsChanged(
          tx,
          ctx,
          { type: 'entry_kind', id: kind },
          { kind, entriesChanged: n },
        )
    }
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
    await removeEnabledKind(tx, ctx.workspaceId, kind)
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

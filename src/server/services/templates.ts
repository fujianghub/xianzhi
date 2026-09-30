/**
 * 记录模板 service（ADR-0011 §2、02 §9 /templates、REQ-TPL-*）：
 * - 列表 = 内置（代码常量）+ 本人个人模板 + 工作区模板；按 kind / spaceKind 过滤；列表不返回正文（02 §4），详情才带 body。
 * - 另存为模板：由记录已落库 ydoc 即时派生正文（已还原 unknownBlock）+ kind / fields；需可读该记录。
 * - 新建记录套模板（`resolveTemplateBody`）：占位符替换后写成初始 ydoc，之后正文只经协同编辑（不变量 1）。
 * - ADR-0023：非 guest 成员可把模板共享到工作区；可直接改正文 / 类型 / fields（乐观锁）；「复制到我的」；
 *   取消共享或删除时同事务清掉引用它的空间默认模板（`spaces.default_template_id` 无外键）。
 * - ADR-0036（REQ-TPL-011）：模板可绑自定义 / 空间类型（kind = custom + type_id），fields 可预填该类型的自定义字段；
 *   工作区模板只能绑内置或空间类型，个人模板还可绑本人的个人类型；类型删除时模板转随笔（entry-types service）。
 * - ADR-0038（REQ-TPL-013 ~ 015）：内置模板由所有者维护——代码内置（`builtin:<key>`）的修改存覆盖表
 *   `builtin_template_overrides`（null 列沿用代码默认；可「恢复默认」= 删覆盖行），删除为软删除（可恢复）；
 *   所有者另可新增内置模板（入库，scope = builtin，全员可见、仅所有者可改）。
 */
import { and, count, desc, eq, inArray, or } from 'drizzle-orm'
import type { z } from 'zod'
import { deriveFromYdoc } from '../../collab/derive.ts'
import {
  BUILTIN_TEMPLATES,
  type BuiltinTemplate,
  builtinTemplate,
  fillTemplateVars,
} from '../../shared/editor/builtin-templates.ts'
import { defaultEntryFields, entryFieldsByKind } from '../../shared/schemas/entryFields.ts'
import type { EntryKind, SpaceKind, TemplateScope } from '../../shared/schemas/enums.ts'
import { splitExtraFields } from '../../shared/schemas/fieldDefs.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import type {
  createTemplateSchema,
  listTemplatesQuery,
  patchTemplateSchema,
} from '../../shared/schemas/templates.ts'
import { formatLocalDate, localDateOf } from '../../shared/tz.ts'
import { type Actor, assertCan, can, type TemplateRef } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { user } from '../db/schema/auth.ts'
import { builtinTemplateOverrides, entryTemplates, spaces } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { type EntryCtx, loadEntry, loadSpaceRef } from './entries.ts'
import {
  builtinFieldDefs,
  loadEntryType,
  normalizeCustomFields,
  normalizeExtraFields,
} from './entry-types.ts'

export interface TemplateView {
  id: string
  source: 'builtin' | TemplateScope
  group: 'dev' | 'learning' | null
  name: string
  description: string
  kind: EntryKind
  /** 绑自定义 / 空间类型时（ADR-0036） */
  typeId: string | null
  spaceKinds: SpaceKind[]
  fields: Record<string, unknown>
  ownerId: string | null
  /** 作者显示名（内置为 null；账号已删为空串，前端显示「已删除的用户」） */
  ownerName: string | null
  canManage: boolean
  /** 作为多少个空间的默认模板（取消共享 / 删除前提示，ADR-0023） */
  spaceDefaults: number
  updatedAt: string | null
  /** 代码内置模板被所有者改过（可「恢复默认」，ADR-0038） */
  customized?: boolean
  /** 代码内置模板已被所有者删除（仅所有者在「已删除」里看得到，可恢复） */
  deleted?: boolean
}

/** 作者名 + 空间默认引用数（列表一次批量查，详情单条查）。 */
interface RowExtra {
  names: Map<string, string>
  defaults: Map<string, number>
}

type Row = typeof entryTemplates.$inferSelect
const refOf = (r: Row): TemplateRef => ({
  id: r.id,
  ownerId: r.ownerId,
  scope: r.scope as TemplateScope,
})

/** 未改过的代码内置模板的乐观锁基准（PATCH 须带 ifUpdatedAt） */
export const BUILTIN_EPOCH = new Date(0)
const BUILTIN_REF = (id: string): TemplateRef => ({ id, ownerId: '', scope: 'builtin' })

type Override = typeof builtinTemplateOverrides.$inferSelect
/** 代码内置模板套上覆盖后的实际样子 */
export interface EffectiveBuiltin {
  tpl: BuiltinTemplate
  customized: boolean
  deleted: boolean
  updatedAt: Date
}
const keyOf = (id: string) => id.slice('builtin:'.length)

function applyOverride(t: BuiltinTemplate, o: Override | undefined): EffectiveBuiltin {
  if (!o) return { tpl: t, customized: false, deleted: false, updatedAt: BUILTIN_EPOCH }
  const kind = (o.kind ?? t.kind) as BuiltinTemplate['kind']
  return {
    tpl: {
      ...t,
      name: o.name ?? t.name,
      description: o.description ?? t.description,
      kind,
      spaceKinds: (o.spaceKinds as SpaceKind[] | null) ?? t.spaceKinds,
      fields:
        (o.fields as Record<string, unknown> | null) ??
        (kind === t.kind ? t.fields : { ...defaultEntryFields[kind] }),
      body: (o.body as PmNode | null) ?? t.body,
    },
    customized:
      o.name !== null ||
      o.description !== null ||
      o.kind !== null ||
      o.spaceKinds !== null ||
      o.fields !== null ||
      o.body !== null,
    deleted: o.deleted,
    updatedAt: o.updatedAt,
  }
}

/** 全部代码内置模板（含已删除）套上本工作区的覆盖 */
export async function effectiveBuiltins(
  db: DbOrTx,
  workspaceId: string,
): Promise<EffectiveBuiltin[]> {
  const rows = await db
    .select()
    .from(builtinTemplateOverrides)
    .where(eq(builtinTemplateOverrides.workspaceId, workspaceId))
  const byKey = new Map(rows.map((o) => [o.key, o]))
  return BUILTIN_TEMPLATES.map((t) => applyOverride(t, byKey.get(keyOf(t.id))))
}

/** 单个代码内置模板（含已删除）；不存在的 key → null */
export async function effectiveBuiltin(
  db: DbOrTx,
  workspaceId: string,
  id: string,
): Promise<EffectiveBuiltin | null> {
  const t = builtinTemplate(id)
  if (!t) return null
  const [o] = await db
    .select()
    .from(builtinTemplateOverrides)
    .where(
      and(
        eq(builtinTemplateOverrides.workspaceId, workspaceId),
        eq(builtinTemplateOverrides.key, keyOf(id)),
      ),
    )
  return applyOverride(t, o)
}

const builtinView = (actor: Actor, e: EffectiveBuiltin): TemplateView => ({
  id: e.tpl.id,
  source: 'builtin',
  group: e.tpl.group,
  name: e.tpl.name,
  description: e.tpl.description,
  kind: e.tpl.kind,
  typeId: null,
  spaceKinds: e.tpl.spaceKinds,
  fields: e.tpl.fields ?? { ...defaultEntryFields[e.tpl.kind] },
  ownerId: null,
  ownerName: null,
  canManage: can(actor, 'template.manage', BUILTIN_REF(e.tpl.id)),
  spaceDefaults: 0,
  updatedAt: e.updatedAt.toISOString(),
  customized: e.customized,
  deleted: e.deleted,
})
const rowView = (actor: Actor, r: Row, x: RowExtra): TemplateView => ({
  id: r.id,
  // 所有者新增的内置模板（scope = builtin）与代码内置同列在「内置」分组
  source: r.scope as TemplateScope,
  group: null,
  name: r.name,
  description: r.description,
  kind: r.kind as EntryKind,
  typeId: r.typeId,
  spaceKinds: r.spaceKind ? [r.spaceKind as SpaceKind] : [],
  fields: (r.fields as Record<string, unknown>) ?? {},
  ownerId: r.ownerId,
  ownerName: x.names.get(r.ownerId) ?? '',
  canManage: can(actor, 'template.manage', refOf(r)),
  spaceDefaults: x.defaults.get(r.id) ?? 0,
  updatedAt: r.updatedAt.toISOString(),
})

async function extraOf(db: DbOrTx, ctx: EntryCtx, rows: Row[]): Promise<RowExtra> {
  const names = new Map<string, string>()
  const defaults = new Map<string, number>()
  if (!rows.length) return { names, defaults }
  const owners = [...new Set(rows.map((r) => r.ownerId))]
  for (const u of await db
    .select({ id: user.id, name: user.name, username: user.displayUsername })
    .from(user)
    .where(inArray(user.id, owners)))
    names.set(u.id, u.name || u.username || '')
  for (const d of await db
    .select({ id: spaces.defaultTemplateId, n: count() })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, ctx.workspaceId),
        inArray(
          spaces.defaultTemplateId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .groupBy(spaces.defaultTemplateId))
    if (d.id) defaults.set(d.id, d.n)
  return { names, defaults }
}

const viewOne = async (db: DbOrTx, ctx: EntryCtx, r: Row) =>
  rowView(ctx.actor, r, await extraOf(db, ctx, [r]))

/** 当前用户能否把模板共享到工作区（前端据此显示开关，不自行比较角色）。 */
export const canShareTemplate = (ctx: EntryCtx) =>
  can(ctx.actor, 'template.create', { id: '', ownerId: ctx.actor.id, scope: 'workspace' })

/** 清掉引用该模板的空间默认模板，并推进这些空间的 updated_at（打开着的编辑空间对话框会 409 而不是再写回悬空 id）。 */
async function clearSpaceDefaults(tx: DbOrTx, workspaceId: string, id: string) {
  await tx
    .update(spaces)
    .set({ defaultTemplateId: null, updatedAt: new Date() })
    .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.defaultTemplateId, id)))
}

/**
 * 模板可绑的类型（ADR-0036、REQ-TPL-011）：空间类型须可读其空间；个人类型须是本人的且模板为个人模板
 * （工作区模板绑个人类型，别人用不了）。
 */
async function assertTemplateType(db: DbOrTx, ctx: EntryCtx, typeId: string, scope: TemplateScope) {
  const bad = (message: string) => AppError.validation([{ path: 'typeId', message }])
  const t = await loadEntryType(db, ctx.workspaceId, typeId)
  if (!t) throw bad('类型不存在')
  if (t.spaceId) {
    const sp = await loadSpaceRef(db, ctx.actor, t.spaceId)
    if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw bad('类型不存在')
    return t
  }
  if (t.createdBy !== ctx.actor.id) throw bad('类型不存在')
  if (scope !== 'personal') throw bad('工作区 / 内置模板不能绑个人类型（其他成员用不了）')
  return t
}

/** fields 按类型校验并规范化（与 POST /entries 同一套：内置字段 strict，自定义字段按定义；未定义的 x 键丢弃）。 */
async function checkFields(
  db: DbOrTx,
  ctx: EntryCtx,
  kind: EntryKind,
  typeId: string | null,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { base, extra } = splitExtraFields(fields)
  const r = entryFieldsByKind[kind].safeParse(base)
  if (!r.success)
    throw AppError.validation(
      r.error.issues.map((i) => ({ path: ['fields', ...i.path].join('.'), message: i.message })),
    )
  if (kind !== 'custom')
    return {
      ...base,
      ...normalizeExtraFields(await builtinFieldDefs(db, ctx.workspaceId, kind), extra),
    }
  const t = typeId ? await loadEntryType(db, ctx.workspaceId, typeId) : null
  if (!t) throw AppError.validation([{ path: 'typeId', message: '类型不存在' }])
  return {
    ...normalizeCustomFields(t.statuses ?? [], r.data as Record<string, unknown>, {
      fillDefault: true,
    }),
    ...normalizeExtraFields(t.fieldDefs ?? [], extra),
  }
}

/** 模板不带日期（ADR-0033）：Bug 的发现 / 解决日期在用模板新建时由服务端重新补。 */
const TEMPLATE_DROP_KEYS: Partial<Record<EntryKind, string[]>> = {
  bug: ['foundAt', 'resolvedAt'],
}
function templateFields(kind: EntryKind, fields: Record<string, unknown>) {
  const drop = TEMPLATE_DROP_KEYS[kind]
  if (!drop) return fields
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !drop.includes(k)))
}

async function visibleRows(db: DbOrTx, ctx: EntryCtx) {
  return db
    .select()
    .from(entryTemplates)
    .where(
      and(
        eq(entryTemplates.workspaceId, ctx.workspaceId),
        or(
          eq(entryTemplates.scope, 'workspace'),
          eq(entryTemplates.scope, 'builtin'),
          eq(entryTemplates.ownerId, ctx.actor.id),
        ),
      ),
    )
    .orderBy(desc(entryTemplates.updatedAt))
}

export async function listTemplates(
  db: Db,
  ctx: EntryCtx,
  q: z.infer<typeof listTemplatesQuery>,
): Promise<TemplateView[]> {
  const builtins = await effectiveBuiltins(db, ctx.workspaceId)
  // 已删除的内置模板（ADR-0038）：只给所有者列出，供恢复
  if (q.deleted) {
    assertCan(ctx.actor, 'template.manage', BUILTIN_REF('builtin:*'))
    return builtins.filter((e) => e.deleted).map((e) => builtinView(ctx.actor, e))
  }
  const rows = (await visibleRows(db, ctx)).filter((r) => can(ctx.actor, 'template.read', refOf(r)))
  const x = await extraOf(db, ctx, rows)
  const all = [
    ...builtins.filter((e) => !e.deleted).map((e) => builtinView(ctx.actor, e)),
    ...rows.map((r) => rowView(ctx.actor, r, x)),
  ]
  return all.filter(
    (t) =>
      (!q.kind || t.kind === q.kind) &&
      (!q.typeId || t.typeId === q.typeId) &&
      (!q.spaceKind || !t.spaceKinds.length || t.spaceKinds.includes(q.spaceKind)),
  )
}

async function loadRow(db: DbOrTx, ctx: EntryCtx, id: string): Promise<Row> {
  const [r] = await db
    .select()
    .from(entryTemplates)
    .where(and(eq(entryTemplates.id, id), eq(entryTemplates.workspaceId, ctx.workspaceId)))
  if (!r || !can(ctx.actor, 'template.read', refOf(r))) throw AppError.notFound('模板不存在')
  return r
}

export async function getTemplate(
  db: Db,
  ctx: EntryCtx,
  id: string,
): Promise<TemplateView & { body: PmNode }> {
  if (id.startsWith('builtin:')) {
    const e = await effectiveBuiltin(db, ctx.workspaceId, id)
    // 已删除的只有所有者能看（恢复前预览）
    if (!e || (e.deleted && !can(ctx.actor, 'template.manage', BUILTIN_REF(id))))
      throw AppError.notFound('模板不存在')
    return { ...builtinView(ctx.actor, e), body: e.tpl.body }
  }
  const r = await loadRow(db, ctx, id)
  return { ...(await viewOne(db, ctx, r)), body: r.body as PmNode }
}

export async function createTemplate(
  db: Db,
  ctx: EntryCtx,
  input: z.infer<typeof createTemplateSchema>,
): Promise<TemplateView> {
  assertCan(ctx.actor, 'template.create', { id: '', ownerId: ctx.actor.id, scope: input.scope })
  let body = input.body as PmNode | undefined
  let kind: EntryKind | undefined = input.kind
  let typeId: string | null = input.typeId ?? null
  let fields = input.fields
  /** 来源（记录 / 模板）绑的类型：本模板能绑就沿用，否则退回随笔（如工作区模板不能绑个人类型） */
  const inherit = async (src: { kind: EntryKind; typeId: string | null; fields: unknown }) => {
    if (kind) return
    kind = src.kind
    typeId = src.typeId
    if (kind === 'custom' && typeId) {
      try {
        await assertTemplateType(db, ctx, typeId, input.scope)
      } catch {
        kind = 'note'
        typeId = null
      }
    }
    fields = fields ?? (kind === src.kind ? (src.fields as Record<string, unknown>) : undefined)
  }
  if (input.fromEntryId) {
    const loaded = await loadEntry(db, ctx.actor, input.fromEntryId)
    if (!loaded || !can(ctx.actor, 'entry.read', loaded.ref)) throw AppError.notFound('记录不存在')
    // 取 ydoc（唯一真源）即时派生，而不是 pm_json：从未编辑过的记录 pm_json 为空（只读派生，不写库）
    body = deriveFromYdoc(loaded.row.ydoc).pmJson
    await inherit({
      kind: loaded.row.kind as EntryKind,
      typeId: loaded.row.typeId,
      fields: loaded.row.fields,
    })
    if (JSON.stringify(body).length > 100 * 1024)
      throw AppError.validation([{ path: 'fromEntryId', message: '正文超过 100KB，不能存为模板' }])
  }
  if (input.fromTemplateId) {
    // 复制到我的（ADR-0023）：不可见 / 不存在 → 404（与 GET 一致）
    const src = await getTemplate(db, ctx, input.fromTemplateId)
    body = src.body
    await inherit(src)
  }
  if (!body || !kind) throw AppError.validation([{ path: 'body', message: '缺少正文或类型' }])
  if (kind === 'custom' && typeId) await assertTemplateType(db, ctx, typeId, input.scope)
  if (kind !== 'custom') typeId = null
  const checked = await checkFields(
    db,
    ctx,
    kind,
    typeId,
    fields ?? { ...defaultEntryFields[kind] },
  ).catch((err) => {
    // 另存为模板：记录上的旧值不合规（如定义已变）不拦，退回默认值
    if (input.fromEntryId && !input.fields) return { ...defaultEntryFields[kind as EntryKind] }
    throw err
  })
  const [row] = await db
    .insert(entryTemplates)
    .values({
      workspaceId: ctx.workspaceId,
      ownerId: ctx.actor.id,
      scope: input.scope,
      name: input.name,
      description: input.description,
      kind,
      typeId,
      spaceKind: input.spaceKind ?? null,
      body,
      fields: templateFields(kind, checked),
    })
    .returning()
  if (!row) throw new Error('insert entry_templates failed')
  return viewOne(db, ctx, row)
}

export async function patchTemplate(
  db: Db,
  ctx: EntryCtx,
  id: string,
  input: z.infer<typeof patchTemplateSchema>,
): Promise<TemplateView> {
  if (id.startsWith('builtin:')) return patchBuiltinTemplate(db, ctx, id, input)
  return db.transaction(async (tx) => {
    const r = await loadRow(tx, ctx, id)
    assertCan(ctx.actor, 'template.manage', refOf(r))
    if (input.scope && input.scope !== r.scope)
      assertCan(ctx.actor, 'template.create', { id: r.id, ownerId: r.ownerId, scope: input.scope })
    if (r.updatedAt.toISOString() !== new Date(input.ifUpdatedAt).toISOString())
      throw new AppError(409, 'CONFLICT_STALE', '模板已被他人修改', {
        current: await viewOne(tx, ctx, r),
      })
    const kind = input.kind ?? (r.kind as EntryKind)
    const typeId = input.kind ? (input.typeId ?? null) : r.typeId
    const scope = input.scope ?? (r.scope as TemplateScope)
    // 换类型 / 改共享范围时重新校验绑定（工作区模板不能绑个人类型）
    if (kind === 'custom' && typeId && (input.kind || input.scope))
      await assertTemplateType(tx, ctx, typeId, scope)
    const retyped = kind !== r.kind || typeId !== r.typeId
    let fields = input.fields
    if (fields) fields = await checkFields(tx, ctx, kind, typeId, fields)
    else if (retyped)
      fields = await checkFields(tx, ctx, kind, typeId, { ...defaultEntryFields[kind] })
    const [row] = await tx
      .update(entryTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.spaceKind !== undefined ? { spaceKind: input.spaceKind } : {}),
        ...(input.kind !== undefined ? { kind: input.kind, typeId } : {}),
        ...(fields !== undefined ? { fields: templateFields(kind, fields) } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        updatedAt: new Date(),
      })
      .where(eq(entryTemplates.id, id))
      .returning()
    if (!row) throw AppError.notFound()
    // 从共享（工作区 / 内置）改回个人：清掉引用它的空间默认模板
    if (r.scope !== 'personal' && row.scope === 'personal')
      await clearSpaceDefaults(tx, ctx.workspaceId, id)
    return viewOne(tx, ctx, row)
  })
}

/**
 * 改代码内置模板（ADR-0038、REQ-TPL-013）：仅所有者；写覆盖表（只写给出的列），乐观锁以覆盖行的 updated_at
 * （未改过 = BUILTIN_EPOCH）为准。只能用内置类型（代码内置模板全员共用，不绑个人 / 空间类型）；不能改共享范围。
 */
async function patchBuiltinTemplate(
  db: Db,
  ctx: EntryCtx,
  id: string,
  input: z.infer<typeof patchTemplateSchema>,
): Promise<TemplateView> {
  assertCan(ctx.actor, 'template.manage', BUILTIN_REF(id))
  return db.transaction(async (tx) => {
    const e = await effectiveBuiltin(tx, ctx.workspaceId, id)
    if (!e || e.deleted) throw AppError.notFound('模板不存在')
    if (e.updatedAt.toISOString() !== new Date(input.ifUpdatedAt).toISOString())
      throw new AppError(409, 'CONFLICT_STALE', '模板已被他人修改', {
        current: builtinView(ctx.actor, e),
      })
    if (input.scope !== undefined && input.scope !== 'builtin')
      throw AppError.validation([{ path: 'scope', message: '内置模板不能改共享范围' }])
    if (input.kind === 'custom')
      throw AppError.validation([{ path: 'kind', message: '内置模板只能用内置类型' }])
    const kind = (input.kind ?? e.tpl.kind) as EntryKind
    let fields: Record<string, unknown> | undefined
    if (input.fields) fields = await checkFields(tx, ctx, kind, null, input.fields)
    else if (kind !== e.tpl.kind)
      fields = await checkFields(tx, ctx, kind, null, { ...defaultEntryFields[kind] })
    const set: Partial<typeof builtinTemplateOverrides.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) set.name = input.name
    if (input.description !== undefined) set.description = input.description
    if (input.kind !== undefined) set.kind = input.kind
    if (input.spaceKind !== undefined) set.spaceKinds = input.spaceKind ? [input.spaceKind] : []
    if (fields !== undefined) set.fields = templateFields(kind, fields)
    if (input.body !== undefined) set.body = input.body
    await tx
      .insert(builtinTemplateOverrides)
      .values({ workspaceId: ctx.workspaceId, key: keyOf(id), ...set })
      .onConflictDoUpdate({
        target: [builtinTemplateOverrides.workspaceId, builtinTemplateOverrides.key],
        set,
      })
    const next = await effectiveBuiltin(tx, ctx.workspaceId, id)
    if (!next) throw AppError.notFound()
    return builtinView(ctx.actor, next)
  })
}

/** 恢复已删除的代码内置模板（保留此前的修改，REQ-TPL-014） */
export async function restoreBuiltinTemplate(db: Db, ctx: EntryCtx, id: string) {
  if (!id.startsWith('builtin:') || !builtinTemplate(id)) throw AppError.notFound('模板不存在')
  assertCan(ctx.actor, 'template.manage', BUILTIN_REF(id))
  await db
    .update(builtinTemplateOverrides)
    .set({ deleted: false, updatedAt: new Date() })
    .where(
      and(
        eq(builtinTemplateOverrides.workspaceId, ctx.workspaceId),
        eq(builtinTemplateOverrides.key, keyOf(id)),
      ),
    )
  return getTemplate(db, ctx, id)
}

/** 恢复默认（REQ-TPL-013）：删掉覆盖行，回到代码里的版本（已删除的也一并恢复） */
export async function resetBuiltinTemplate(db: Db, ctx: EntryCtx, id: string) {
  if (!id.startsWith('builtin:') || !builtinTemplate(id)) throw AppError.notFound('模板不存在')
  assertCan(ctx.actor, 'template.manage', BUILTIN_REF(id))
  await db
    .delete(builtinTemplateOverrides)
    .where(
      and(
        eq(builtinTemplateOverrides.workspaceId, ctx.workspaceId),
        eq(builtinTemplateOverrides.key, keyOf(id)),
      ),
    )
  return getTemplate(db, ctx, id)
}

export async function deleteTemplate(db: Db, ctx: EntryCtx, id: string): Promise<void> {
  if (id.startsWith('builtin:')) {
    // 删代码内置模板（REQ-TPL-014）：软删除，可恢复；同事务清掉引用它的空间默认模板
    if (!builtinTemplate(id)) throw AppError.notFound('模板不存在')
    assertCan(ctx.actor, 'template.manage', BUILTIN_REF(id))
    await db.transaction(async (tx) => {
      await tx
        .insert(builtinTemplateOverrides)
        .values({ workspaceId: ctx.workspaceId, key: keyOf(id), deleted: true })
        .onConflictDoUpdate({
          target: [builtinTemplateOverrides.workspaceId, builtinTemplateOverrides.key],
          set: { deleted: true, updatedAt: new Date() },
        })
      await clearSpaceDefaults(tx, ctx.workspaceId, id)
    })
    return
  }
  await db.transaction(async (tx) => {
    const r = await loadRow(tx, ctx, id)
    assertCan(ctx.actor, 'template.manage', refOf(r))
    await tx.delete(entryTemplates).where(eq(entryTemplates.id, id))
    await clearSpaceDefaults(tx, ctx.workspaceId, id)
  })
}

/**
 * 空间默认模板只能是大家都用得了的（ADR-0019）：内置模板（未删除）、所有者新增的内置模板，或本工作区的「工作区」模板；
 * 个人模板 / 已删除 / 不存在 → 422。
 */
export async function assertSharedTemplate(db: DbOrTx, workspaceId: string, id: string) {
  const bad = () =>
    AppError.validation([{ path: 'defaultTemplateId', message: '只能选内置模板或工作区模板' }])
  if (id.startsWith('builtin:')) {
    if (id === 'builtin:blank') return
    const e = await effectiveBuiltin(db, workspaceId, id)
    if (!e || e.deleted) throw bad()
    return
  }
  const [r] = await db
    .select({ scope: entryTemplates.scope })
    .from(entryTemplates)
    .where(and(eq(entryTemplates.id, id), eq(entryTemplates.workspaceId, workspaceId)))
  if (r?.scope !== 'workspace' && r?.scope !== 'builtin') throw bad()
}

/**
 * 新建记录时取模板正文（占位符已替换）。`builtin:blank` = 明确的空白（不注入 kind 默认骨架）。
 * 返回 null 表示未选模板（沿用首次打开按 kind 注入，03 §6）。
 */
export async function resolveTemplateBody(
  db: DbOrTx,
  ctx: EntryCtx,
  templateId: string | undefined,
  vars: { space: string },
): Promise<PmNode | null> {
  if (!templateId) return null
  if (templateId === 'builtin:blank') return { type: 'doc', content: [{ type: 'paragraph' }] }
  let body: PmNode
  if (templateId.startsWith('builtin:')) {
    // 所有者改过的用改后的正文；已删除 → 422（ADR-0038）
    const e = await effectiveBuiltin(db, ctx.workspaceId, templateId)
    if (!e || e.deleted) throw AppError.validation([{ path: 'templateId', message: '模板不存在' }])
    body = e.tpl.body
  } else {
    const [r] = await db
      .select()
      .from(entryTemplates)
      .where(
        and(eq(entryTemplates.id, templateId), eq(entryTemplates.workspaceId, ctx.workspaceId)),
      )
    if (!r || !can(ctx.actor, 'template.read', refOf(r)))
      throw AppError.validation([{ path: 'templateId', message: '模板不存在' }])
    body = r.body as PmNode
  }
  const [u] = await db
    .select({ name: user.name, username: user.displayUsername, tz: user.timezone })
    .from(user)
    .where(eq(user.id, ctx.actor.id))
  const date = formatLocalDate(localDateOf(u?.tz || 'Asia/Shanghai', new Date()))
  const filled = fillTemplateVars(body, {
    date,
    user: u?.name || u?.username || '',
    space: vars.space,
  })
  // 空正文模板也写一个空段落：fragment 非空 → 不再注入 kind 默认骨架
  return filled.content?.length ? filled : { type: 'doc', content: [{ type: 'paragraph' }] }
}

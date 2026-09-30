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
 * - ADR-0039（REQ-TPL-016 ~ 019、REQ-ENTRY-032）：模板元数据——模板自有字段（`field_defs`，增删改）与移除的类型字段
 *   （`hidden_fields`）；用模板建的记录记下来源模板（`entries.template_id`），其有效字段 = 类型字段 − 移除的 + 自有的。
 *   改 / 删自有字段同事务同步这些记录里的值；删模板（或代码内置模板恢复默认）清掉自有字段的值。
 */
import { and, count, desc, eq, exists, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { deriveFromYdoc } from '../../collab/derive.ts'
import {
  BUILTIN_TEMPLATES,
  type BuiltinTemplate,
  builtinTemplate,
  fillTemplateVars,
} from '../../shared/editor/builtin-templates.ts'
import {
  defaultEntryFields,
  entryFieldsByKind,
  hideableBaseFields,
} from '../../shared/schemas/entryFields.ts'
import type { EntryKind, SpaceKind, TemplateScope } from '../../shared/schemas/enums.ts'
import {
  type FieldDef,
  mergeFieldDefs,
  migrateExtraValues,
  splitExtraFields,
} from '../../shared/schemas/fieldDefs.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import type {
  createTemplateSchema,
  listTemplatesQuery,
  patchTemplateSchema,
} from '../../shared/schemas/templates.ts'
import { formatLocalDate, localDateOf } from '../../shared/tz.ts'
import { type Actor, assertCan, can, type TemplateRef, visibleEntriesWhere } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { user } from '../db/schema/auth.ts'
import { builtinTemplateOverrides, entries, entryTemplates, spaces } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { type EntryCtx, loadEntry, loadSpaceRef } from './entries.ts'
import {
  applyFieldDefChanges,
  builtinFieldDefs,
  loadEntryType,
  normalizeCustomFields,
  normalizeExtraFields,
  resolveOwnFieldDefs,
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
  /** 模板自有字段（ADR-0039）：用此模板建的记录多出这些属性 */
  fieldDefs: FieldDef[]
  /** 本模板移除的类型字段名（ADR-0039） */
  hiddenFields: string[]
  /** 用此模板建的记录数（含回收站；仅计数）——改 / 删自有字段、删模板前提示 */
  entryCount: number
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
  /** 模板 id → 引用它的记录数 */
  uses: Map<string, number>
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
  /** 所有者给它加的自有字段 / 移除的类型字段（ADR-0039；代码默认都为空） */
  fieldDefs: FieldDef[]
  hiddenFields: string[]
  customized: boolean
  deleted: boolean
  updatedAt: Date
}
const keyOf = (id: string) => id.slice('builtin:'.length)

function applyOverride(t: BuiltinTemplate, o: Override | undefined): EffectiveBuiltin {
  if (!o)
    return {
      tpl: t,
      fieldDefs: [],
      hiddenFields: [],
      customized: false,
      deleted: false,
      updatedAt: BUILTIN_EPOCH,
    }
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
    fieldDefs: o.fieldDefs ?? [],
    hiddenFields: o.hiddenFields ?? [],
    customized:
      o.name !== null ||
      o.description !== null ||
      o.kind !== null ||
      o.spaceKinds !== null ||
      o.fields !== null ||
      o.fieldDefs !== null ||
      o.hiddenFields !== null ||
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

const builtinView = (actor: Actor, e: EffectiveBuiltin, entryCount = 0): TemplateView => ({
  id: e.tpl.id,
  source: 'builtin',
  group: e.tpl.group,
  name: e.tpl.name,
  description: e.tpl.description,
  kind: e.tpl.kind,
  typeId: null,
  spaceKinds: e.tpl.spaceKinds,
  fields: e.tpl.fields ?? { ...defaultEntryFields[e.tpl.kind] },
  fieldDefs: e.fieldDefs,
  hiddenFields: e.hiddenFields,
  entryCount,
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
  fieldDefs: r.fieldDefs ?? [],
  hiddenFields: r.hiddenFields ?? [],
  entryCount: x.uses.get(r.id) ?? 0,
  ownerId: r.ownerId,
  ownerName: x.names.get(r.ownerId) ?? '',
  canManage: can(actor, 'template.manage', refOf(r)),
  spaceDefaults: x.defaults.get(r.id) ?? 0,
  updatedAt: r.updatedAt.toISOString(),
})

/** 各模板被多少条记录引用（含回收站；只计数，不看记录可见性——与类型的 usage 同口径） */
async function templateUses(db: DbOrTx, workspaceId: string, ids?: string[]) {
  const uses = new Map<string, number>()
  if (ids && !ids.length) return uses
  for (const u of await db
    .select({ id: entries.templateId, n: count() })
    .from(entries)
    .where(
      and(
        eq(entries.workspaceId, workspaceId),
        ids ? inArray(entries.templateId, ids) : isNotNull(entries.templateId),
      ),
    )
    .groupBy(entries.templateId))
    if (u.id) uses.set(u.id, u.n)
  return uses
}

async function extraOf(
  db: DbOrTx,
  ctx: EntryCtx,
  rows: Row[],
  uses?: Map<string, number>,
): Promise<RowExtra> {
  const names = new Map<string, string>()
  const defaults = new Map<string, number>()
  if (!rows.length) return { names, defaults, uses: uses ?? new Map() }
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
  return {
    names,
    defaults,
    uses:
      uses ??
      (await templateUses(
        db,
        ctx.workspaceId,
        rows.map((r) => r.id),
      )),
  }
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

/** 所绑类型的自定义字段定义：内置类型 = 追加的字段；自定义 / 空间类型 = 类型的字段 */
async function typeFieldDefs(
  db: DbOrTx,
  workspaceId: string,
  kind: EntryKind,
  typeId: string | null,
): Promise<FieldDef[]> {
  if (kind !== 'custom') return builtinFieldDefs(db, workspaceId, kind)
  const t = typeId ? await loadEntryType(db, workspaceId, typeId) : null
  return t?.fieldDefs ?? []
}

/**
 * fields 按类型校验并规范化（与 POST /entries 同一套：内置字段 strict，自定义字段按定义；未定义的 x 键丢弃）。
 * `own` = 模板自有字段（ADR-0039），与类型的字段一并作为可预填的自定义字段。
 */
async function checkFields(
  db: DbOrTx,
  ctx: EntryCtx,
  kind: EntryKind,
  typeId: string | null,
  fields: Record<string, unknown>,
  own: FieldDef[] = [],
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
      ...normalizeExtraFields(
        mergeFieldDefs(await builtinFieldDefs(db, ctx.workspaceId, kind), own),
        extra,
      ),
    }
  const t = typeId ? await loadEntryType(db, ctx.workspaceId, typeId) : null
  if (!t) throw AppError.validation([{ path: 'typeId', message: '类型不存在' }])
  return {
    ...normalizeCustomFields(t.statuses ?? [], r.data as Record<string, unknown>, {
      fillDefault: true,
    }),
    ...normalizeExtraFields(mergeFieldDefs(t.fieldDefs ?? [], own), extra),
  }
}

/**
 * 模板可移除的类型字段（ADR-0039、REQ-TPL-017）：类型的可移除内置字段 + 类型的自定义字段键。
 * 不认识的名字（类型后来改了 / 必填字段 / 进流转的字段）静默丢弃，去重。
 */
function cleanHidden(kind: EntryKind, typeDefs: FieldDef[], names: readonly string[]): string[] {
  const ok = new Set([...hideableBaseFields(kind), ...typeDefs.map((d) => d.key)])
  return [...new Set(names)].filter((n) => ok.has(n))
}

/**
 * 自有字段输入 → 定义（键由服务端生成，见 resolveOwnFieldDefs）；新增 / 改名的字段不得与所绑类型的自定义字段重名
 * （同一条记录上出现两个同名属性）。返回定义与临时键对照。
 */
function resolveOwn(
  prev: FieldDef[],
  input: NonNullable<z.infer<typeof patchTemplateSchema>['fieldDefs']>,
  typeDefs: FieldDef[],
) {
  const r = resolveOwnFieldDefs(
    prev,
    input,
    typeDefs.map((d) => d.key),
  )
  const typeLabels = new Set(typeDefs.map((d) => d.label))
  const errors = r.defs.flatMap((d, i) =>
    typeLabels.has(d.label) && prev.find((p) => p.key === d.key)?.label !== d.label
      ? [{ path: `fieldDefs.${i}.label`, message: `「${d.label}」与类型的字段重名` }]
      : [],
  )
  if (errors.length) throw AppError.validation(errors)
  return r
}

/** 把请求里按临时键写的预填值改到服务端生成的键上 */
const remapKeys = (fields: Record<string, unknown>, remap: Record<string, string>) =>
  Object.keys(remap).length
    ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [remap[k] ?? k, v]))
    : fields

const omitKeys = (fields: Record<string, unknown>, keys: readonly string[]) =>
  keys.length
    ? Object.fromEntries(Object.entries(fields).filter(([k]) => !keys.includes(k)))
    : fields

/** 用某模板建的记录（含回收站） */
const entriesOf = (workspaceId: string, id: string) =>
  sql`${entries.workspaceId} = ${workspaceId} and ${entries.templateId} = ${id}`

/** 清掉这些记录里的模板自有字段值（删模板 / 内置模板恢复默认）；返回受影响条数 */
async function stripOwnValues(tx: DbOrTx, workspaceId: string, id: string, defs: FieldDef[]) {
  if (!defs.length) return 0
  return applyFieldDefChanges(tx, { entries: entriesOf(workspaceId, id) }, defs, [])
}

async function auditFieldsChanged(
  tx: DbOrTx,
  ctx: EntryCtx,
  id: string,
  meta: Record<string, unknown>,
) {
  await audit(tx, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'template.fields_changed',
    targetType: 'template',
    targetId: id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta,
  })
}

/**
 * 某模板的元数据（记录读写时用，ADR-0039）：不做可见性判断——记录引用了它，它的字段定义就对该记录生效
 * （含已软删的代码内置模板）。不存在 → null。
 */
export async function templateMeta(
  db: DbOrTx,
  workspaceId: string,
  id: string | null | undefined,
): Promise<{ fieldDefs: FieldDef[]; hiddenFields: string[] } | null> {
  if (!id) return null
  if (id.startsWith('builtin:')) {
    const e = await effectiveBuiltin(db, workspaceId, id)
    return e ? { fieldDefs: e.fieldDefs, hiddenFields: e.hiddenFields } : null
  }
  const [r] = await db
    .select({ fieldDefs: entryTemplates.fieldDefs, hiddenFields: entryTemplates.hiddenFields })
    .from(entryTemplates)
    .where(and(eq(entryTemplates.id, id), eq(entryTemplates.workspaceId, workspaceId)))
  return r ? { fieldDefs: r.fieldDefs ?? [], hiddenFields: r.hiddenFields ?? [] } : null
}

export interface TemplateFieldMeta {
  id: string
  /** 模板名（ADR-0040：筛选 / 分组里区分同名属性）；读者读不到该模板（别人的个人模板）时为 null */
  name: string | null
  kind: EntryKind
  typeId: string | null
  fieldDefs: FieldDef[]
  hiddenFields: string[]
}

/**
 * GET /templates/fields（ADR-0039、REQ-TPL-019）：读者「认得」的模板元数据目录（只含有自有字段或移除了字段的）。
 * 自己可读的模板（内置含已软删的——旧记录仍引用）；别人的个人模板仅当有读者可读的记录引用它
 * （看得到记录就该看得懂它的属性；不给模板名 / 正文 / 作者——`name` 只对读得到的模板给出）。
 */
export async function listTemplateFieldMetas(db: Db, ctx: EntryCtx): Promise<TemplateFieldMeta[]> {
  const builtins = await effectiveBuiltins(db, ctx.workspaceId)
  const usedByVisibleEntry = exists(
    db
      .select({ one: sql`1` })
      .from(entries)
      .where(
        and(
          eq(entries.workspaceId, ctx.workspaceId),
          sql`${entries.templateId} = ${entryTemplates.id}::text`,
          // 可读的记录，或读者回收站里的（本人的；管理员全部——与列表 deleted=1 同口径）
          or(
            visibleEntriesWhere(ctx.actor),
            and(
              isNotNull(entries.deletedAt),
              can(ctx.actor, 'workspace.manage', null)
                ? undefined
                : eq(entries.authorId, ctx.actor.id),
            ),
          ),
        ),
      ),
  )
  const rows = await db
    .select({
      id: entryTemplates.id,
      name: entryTemplates.name,
      ownerId: entryTemplates.ownerId,
      scope: entryTemplates.scope,
      kind: entryTemplates.kind,
      typeId: entryTemplates.typeId,
      fieldDefs: entryTemplates.fieldDefs,
      hiddenFields: entryTemplates.hiddenFields,
    })
    .from(entryTemplates)
    .where(
      and(
        eq(entryTemplates.workspaceId, ctx.workspaceId),
        sql`(jsonb_array_length(${entryTemplates.fieldDefs}) > 0 or jsonb_array_length(${entryTemplates.hiddenFields}) > 0)`,
        or(
          eq(entryTemplates.scope, 'workspace'),
          eq(entryTemplates.scope, 'builtin'),
          eq(entryTemplates.ownerId, ctx.actor.id),
          usedByVisibleEntry,
        ),
      ),
    )
  return [
    ...builtins
      .filter((e) => e.fieldDefs.length || e.hiddenFields.length)
      .map((e) => ({
        id: e.tpl.id,
        name: e.tpl.name,
        kind: e.tpl.kind,
        typeId: null,
        fieldDefs: e.fieldDefs,
        hiddenFields: e.hiddenFields,
      })),
    ...rows.map((r) => ({
      id: r.id,
      // 只因「看得到用它建的记录」才进目录的别人的个人模板：不给名字
      name: can(ctx.actor, 'template.read', refOf(r as Row)) ? r.name : null,
      kind: r.kind as EntryKind,
      typeId: r.typeId,
      fieldDefs: r.fieldDefs ?? [],
      hiddenFields: r.hiddenFields ?? [],
    })),
  ]
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
  const uses = await templateUses(db, ctx.workspaceId)
  const x = await extraOf(db, ctx, rows, uses)
  const all = [
    ...builtins
      .filter((e) => !e.deleted)
      .map((e) => builtinView(ctx.actor, e, uses.get(e.tpl.id) ?? 0)),
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
    const uses = await templateUses(db, ctx.workspaceId, [id])
    return { ...builtinView(ctx.actor, e, uses.get(id) ?? 0), body: e.tpl.body }
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
  /** 沿用来源的模板元数据（ADR-0039）：复制到我的 = 原模板的；另存为模板 = 该记录来源模板的 */
  let srcMeta: { fieldDefs: FieldDef[]; hiddenFields: string[] } | null = null
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
    // 能读记录就能沿用它的属性定义（不要求能读来源模板）
    srcMeta = await templateMeta(db, ctx.workspaceId, loaded.row.templateId)
    if (JSON.stringify(body).length > 100 * 1024)
      throw AppError.validation([{ path: 'fromEntryId', message: '正文超过 100KB，不能存为模板' }])
  }
  if (input.fromTemplateId) {
    // 复制到我的（ADR-0023）：不可见 / 不存在 → 404（与 GET 一致）
    const src = await getTemplate(db, ctx, input.fromTemplateId)
    body = src.body
    await inherit(src)
    srcMeta = { fieldDefs: src.fieldDefs, hiddenFields: src.hiddenFields }
  }
  if (!body || !kind) throw AppError.validation([{ path: 'body', message: '缺少正文或类型' }])
  if (kind === 'custom' && typeId) await assertTemplateType(db, ctx, typeId, input.scope)
  if (kind !== 'custom') typeId = null
  // 模板元数据（ADR-0039）：自有字段（给了就按输入，否则沿用来源的——键不变，值可互通）+ 移除的类型字段
  const typeDefs = await typeFieldDefs(db, ctx.workspaceId, kind, typeId)
  const typeKeys = typeDefs.map((d) => d.key)
  const own = input.fieldDefs ? resolveOwn([], input.fieldDefs, typeDefs) : null
  const fieldDefs = own
    ? own.defs
    : (srcMeta?.fieldDefs ?? []).filter((d) => !typeKeys.includes(d.key))
  const hiddenFields = cleanHidden(
    kind,
    typeDefs,
    input.hiddenFields ?? srcMeta?.hiddenFields ?? [],
  )
  const checked = await checkFields(
    db,
    ctx,
    kind,
    typeId,
    remapKeys(fields ?? { ...defaultEntryFields[kind] }, own?.remap ?? {}),
    fieldDefs,
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
      fields: omitKeys(templateFields(kind, checked), hiddenFields),
      fieldDefs,
      hiddenFields,
    })
    .returning()
  if (!row) throw new Error('insert entry_templates failed')
  return viewOne(db, ctx, row)
}

type PatchInput = z.infer<typeof patchTemplateSchema>

/**
 * PATCH 后的模板元数据与预填（ADR-0039）：
 * - 自有字段整组替换（新字段的键由服务端生成 / 已有字段类型不可改 / 不与所绑类型的字段重名）；
 * - 移除的类型字段：给了就按新类型过滤；换了类型没给 → 清空；
 * - 预填 fields：给了 / 换了类型 / 元数据变了就重算——先按定义变更迁移（删字段、选项改名 / 删除），
 *   再按「类型字段 + 自有字段」校验，最后去掉被移除字段的值。
 * 未变的项返回 undefined（不写库）。
 */
async function nextMetadata(
  tx: DbOrTx,
  ctx: EntryCtx,
  input: PatchInput,
  cur: {
    kind: EntryKind
    typeId: string | null
    retyped: boolean
    fieldDefs: FieldDef[]
    hiddenFields: string[]
    fields: Record<string, unknown>
  },
): Promise<{
  fieldDefs: FieldDef[] | undefined
  hiddenFields: string[] | undefined
  fields: Record<string, unknown> | undefined
}> {
  const typeDefs = await typeFieldDefs(tx, ctx.workspaceId, cur.kind, cur.typeId)
  const own = input.fieldDefs ? resolveOwn(cur.fieldDefs, input.fieldDefs, typeDefs) : null
  const fieldDefs = own?.defs
  // 换了类型而没动自有字段：已有的自有字段也不能与新类型的字段重名
  if (cur.retyped && !own) {
    const clash = cur.fieldDefs.find((d) => typeDefs.some((t) => t.label === d.label))
    if (clash)
      throw AppError.validation([
        { path: 'kind', message: `模板属性「${clash.label}」与该类型的字段重名，请先改名` },
      ])
  }
  const hiddenFields =
    input.hiddenFields !== undefined
      ? cleanHidden(cur.kind, typeDefs, input.hiddenFields)
      : cur.retyped && cur.hiddenFields.length
        ? []
        : undefined
  const raw =
    (input.fields && remapKeys(input.fields, own?.remap ?? {})) ??
    (cur.retyped
      ? // 换类型：回到新类型的默认值，自有字段的预填保留
        { ...defaultEntryFields[cur.kind], ...splitExtraFields(cur.fields).extra }
      : fieldDefs !== undefined || hiddenFields !== undefined
        ? cur.fields
        : undefined)
  if (raw === undefined) return { fieldDefs, hiddenFields, fields: undefined }
  const migrated = fieldDefs
    ? migrateExtraValues(raw, cur.fieldDefs, fieldDefs, input.optionRenames)
    : raw
  const checked = await checkFields(
    tx,
    ctx,
    cur.kind,
    cur.typeId,
    migrated,
    fieldDefs ?? cur.fieldDefs,
  )
  return { fieldDefs, hiddenFields, fields: omitKeys(checked, hiddenFields ?? cur.hiddenFields) }
}

/** 自有字段定义变了：同事务同步用此模板建的记录里的值（删字段清值、选项改名 / 删除），有改动则审计 */
async function syncOwnFieldValues(
  tx: DbOrTx,
  ctx: EntryCtx,
  id: string,
  name: string,
  prev: FieldDef[],
  next: FieldDef[] | undefined,
  input: PatchInput,
) {
  if (!next) return
  const n = await applyFieldDefChanges(
    tx,
    { entries: entriesOf(ctx.workspaceId, id) },
    prev,
    next,
    input.optionRenames,
  )
  if (n) await auditFieldsChanged(tx, ctx, id, { name, entriesChanged: n })
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
    const meta = await nextMetadata(tx, ctx, input, {
      kind,
      typeId,
      retyped,
      fieldDefs: r.fieldDefs ?? [],
      hiddenFields: r.hiddenFields ?? [],
      fields: (r.fields ?? {}) as Record<string, unknown>,
    })
    const fields = meta.fields
    const [row] = await tx
      .update(entryTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.spaceKind !== undefined ? { spaceKind: input.spaceKind } : {}),
        ...(input.kind !== undefined ? { kind: input.kind, typeId } : {}),
        ...(fields !== undefined ? { fields: templateFields(kind, fields) } : {}),
        ...(meta.fieldDefs !== undefined ? { fieldDefs: meta.fieldDefs } : {}),
        ...(meta.hiddenFields !== undefined ? { hiddenFields: meta.hiddenFields } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        updatedAt: new Date(),
      })
      .where(eq(entryTemplates.id, id))
      .returning()
    if (!row) throw AppError.notFound()
    await syncOwnFieldValues(tx, ctx, id, r.name, r.fieldDefs ?? [], meta.fieldDefs, input)
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
    const meta = await nextMetadata(tx, ctx, input, {
      kind,
      typeId: null,
      retyped: kind !== e.tpl.kind,
      fieldDefs: e.fieldDefs,
      hiddenFields: e.hiddenFields,
      fields: e.tpl.fields ?? { ...defaultEntryFields[e.tpl.kind] },
    })
    const fields = meta.fields
    const set: Partial<typeof builtinTemplateOverrides.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) set.name = input.name
    if (input.description !== undefined) set.description = input.description
    if (input.kind !== undefined) set.kind = input.kind
    if (input.spaceKind !== undefined) set.spaceKinds = input.spaceKind ? [input.spaceKind] : []
    if (fields !== undefined) set.fields = templateFields(kind, fields)
    // 空 = 代码默认：写回 null，免得「已修改」一直亮着
    if (meta.fieldDefs !== undefined) set.fieldDefs = meta.fieldDefs.length ? meta.fieldDefs : null
    if (meta.hiddenFields !== undefined)
      set.hiddenFields = meta.hiddenFields.length ? meta.hiddenFields : null
    if (input.body !== undefined) set.body = input.body
    await tx
      .insert(builtinTemplateOverrides)
      .values({ workspaceId: ctx.workspaceId, key: keyOf(id), ...set })
      .onConflictDoUpdate({
        target: [builtinTemplateOverrides.workspaceId, builtinTemplateOverrides.key],
        set,
      })
    await syncOwnFieldValues(tx, ctx, id, e.tpl.name, e.fieldDefs, meta.fieldDefs, input)
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
  await db.transaction(async (tx) => {
    // 自有字段回到代码默认（没有）：清掉用它建的记录里这些字段的值（ADR-0039；来源模板不变）
    const e = await effectiveBuiltin(tx, ctx.workspaceId, id)
    const n = await stripOwnValues(tx, ctx.workspaceId, id, e?.fieldDefs ?? [])
    if (n)
      await auditFieldsChanged(tx, ctx, id, { name: e?.tpl.name, reset: true, entriesChanged: n })
    await tx
      .delete(builtinTemplateOverrides)
      .where(
        and(
          eq(builtinTemplateOverrides.workspaceId, ctx.workspaceId),
          eq(builtinTemplateOverrides.key, keyOf(id)),
        ),
      )
  })
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
    // 用它建的记录（ADR-0039）：自有字段的值清掉、来源模板置空（定义随模板一起没了）
    const n = await stripOwnValues(tx, ctx.workspaceId, id, r.fieldDefs ?? [])
    if (n) await auditFieldsChanged(tx, ctx, id, { name: r.name, deleted: true, entriesChanged: n })
    await tx.execute(
      sql`update ${entries} set template_id = null where ${entriesOf(ctx.workspaceId, id)}`,
    )
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

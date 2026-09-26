/**
 * 记录模板 service（ADR-0011 §2、02 §9 /templates、REQ-TPL-*）：
 * - 列表 = 内置（代码常量）+ 本人个人模板 + 工作区模板；按 kind / spaceKind 过滤；列表不返回正文（02 §4），详情才带 body。
 * - 另存为模板：由记录已落库 ydoc 即时派生正文（已还原 unknownBlock）+ kind / fields；需可读该记录。
 * - 新建记录套模板（`resolveTemplateBody`）：占位符替换后写成初始 ydoc，之后正文只经协同编辑（不变量 1）。
 */
import { and, desc, eq, or } from 'drizzle-orm'
import type { z } from 'zod'
import { deriveFromYdoc } from '../../collab/derive.ts'
import {
  BUILTIN_TEMPLATES,
  type BuiltinTemplate,
  builtinTemplate,
  fillTemplateVars,
} from '../../shared/editor/builtin-templates.ts'
import { defaultEntryFields } from '../../shared/schemas/entryFields.ts'
import type {
  BuiltinEntryKind,
  EntryKind,
  SpaceKind,
  TemplateScope,
} from '../../shared/schemas/enums.ts'
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
import { entryTemplates } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { type EntryCtx, loadEntry } from './entries.ts'

export interface TemplateView {
  id: string
  source: 'builtin' | TemplateScope
  group: 'dev' | 'learning' | null
  name: string
  description: string
  kind: EntryKind
  spaceKinds: SpaceKind[]
  fields: Record<string, unknown>
  ownerId: string | null
  canManage: boolean
  updatedAt: string | null
}

type Row = typeof entryTemplates.$inferSelect
const refOf = (r: Row): TemplateRef => ({
  id: r.id,
  ownerId: r.ownerId,
  scope: r.scope as TemplateScope,
})

const builtinView = (t: BuiltinTemplate): TemplateView => ({
  id: t.id,
  source: 'builtin',
  group: t.group,
  name: t.name,
  description: t.description,
  kind: t.kind,
  spaceKinds: t.spaceKinds,
  fields: t.fields ?? { ...defaultEntryFields[t.kind] },
  ownerId: null,
  canManage: false,
  updatedAt: null,
})
const rowView = (actor: Actor, r: Row): TemplateView => ({
  id: r.id,
  source: r.scope as TemplateScope,
  group: null,
  name: r.name,
  description: r.description,
  kind: r.kind as EntryKind,
  spaceKinds: r.spaceKind ? [r.spaceKind as SpaceKind] : [],
  fields: (r.fields as Record<string, unknown>) ?? {},
  ownerId: r.ownerId,
  canManage: can(actor, 'template.manage', refOf(r)),
  updatedAt: r.updatedAt.toISOString(),
})

async function visibleRows(db: DbOrTx, ctx: EntryCtx) {
  return db
    .select()
    .from(entryTemplates)
    .where(
      and(
        eq(entryTemplates.workspaceId, ctx.workspaceId),
        or(eq(entryTemplates.scope, 'workspace'), eq(entryTemplates.ownerId, ctx.actor.id)),
      ),
    )
    .orderBy(desc(entryTemplates.updatedAt))
}

export async function listTemplates(
  db: Db,
  ctx: EntryCtx,
  q: z.infer<typeof listTemplatesQuery>,
): Promise<TemplateView[]> {
  const rows = (await visibleRows(db, ctx)).filter((r) => can(ctx.actor, 'template.read', refOf(r)))
  const all = [...BUILTIN_TEMPLATES.map(builtinView), ...rows.map((r) => rowView(ctx.actor, r))]
  return all.filter(
    (t) =>
      (!q.kind || t.kind === q.kind) &&
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
    const t = builtinTemplate(id)
    if (!t) throw AppError.notFound('模板不存在')
    return { ...builtinView(t), body: t.body }
  }
  const r = await loadRow(db, ctx, id)
  return { ...rowView(ctx.actor, r), body: r.body as PmNode }
}

export async function createTemplate(
  db: Db,
  ctx: EntryCtx,
  input: z.infer<typeof createTemplateSchema>,
): Promise<TemplateView> {
  assertCan(ctx.actor, 'template.create', { id: '', ownerId: ctx.actor.id, scope: input.scope })
  let body = input.body as PmNode | undefined
  let kind = input.kind
  let fields = input.fields
  if (input.fromEntryId) {
    const loaded = await loadEntry(db, ctx.actor, input.fromEntryId)
    if (!loaded || !can(ctx.actor, 'entry.read', loaded.ref)) throw AppError.notFound('记录不存在')
    // 取 ydoc（唯一真源）即时派生，而不是 pm_json：从未编辑过的记录 pm_json 为空（只读派生，不写库）
    body = deriveFromYdoc(loaded.row.ydoc).pmJson
    // 自定义类型的记录存为模板 → 随手记（模板只认内置类型，ADR-0016）
    kind = kind ?? (loaded.row.kind === 'custom' ? 'note' : (loaded.row.kind as BuiltinEntryKind))
    fields =
      fields ??
      (kind === loaded.row.kind ? (loaded.row.fields as Record<string, unknown>) : undefined)
    if (JSON.stringify(body).length > 100 * 1024)
      throw AppError.validation([{ path: 'fromEntryId', message: '正文超过 100KB，不能存为模板' }])
  }
  if (!body || !kind) throw AppError.validation([{ path: 'body', message: '缺少正文或类型' }])
  const [row] = await db
    .insert(entryTemplates)
    .values({
      workspaceId: ctx.workspaceId,
      ownerId: ctx.actor.id,
      scope: input.scope,
      name: input.name,
      description: input.description,
      kind,
      spaceKind: input.spaceKind ?? null,
      body,
      fields: fields ?? { ...defaultEntryFields[kind] },
    })
    .returning()
  if (!row) throw new Error('insert entry_templates failed')
  return rowView(ctx.actor, row)
}

export async function patchTemplate(
  db: Db,
  ctx: EntryCtx,
  id: string,
  input: z.infer<typeof patchTemplateSchema>,
): Promise<TemplateView> {
  if (id.startsWith('builtin:')) throw AppError.forbidden('内置模板不可修改')
  const r = await loadRow(db, ctx, id)
  assertCan(ctx.actor, 'template.manage', refOf(r))
  if (input.scope && input.scope !== r.scope)
    assertCan(ctx.actor, 'template.create', { id: r.id, ownerId: r.ownerId, scope: input.scope })
  const [row] = await db
    .update(entryTemplates)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.spaceKind !== undefined ? { spaceKind: input.spaceKind } : {}),
      updatedAt: new Date(),
    })
    .where(eq(entryTemplates.id, id))
    .returning()
  if (!row) throw AppError.notFound()
  return rowView(ctx.actor, row)
}

export async function deleteTemplate(db: Db, ctx: EntryCtx, id: string): Promise<void> {
  if (id.startsWith('builtin:')) throw AppError.forbidden('内置模板不可删除')
  const r = await loadRow(db, ctx, id)
  assertCan(ctx.actor, 'template.manage', refOf(r))
  await db.delete(entryTemplates).where(eq(entryTemplates.id, id))
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
    const t = builtinTemplate(templateId)
    if (!t) throw AppError.validation([{ path: 'templateId', message: '模板不存在' }])
    body = t.body
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

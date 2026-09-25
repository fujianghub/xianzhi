/**
 * 记录 service（T0-013；01 §3.4、02 §9、REQ-ENTRY-001 · 003 · 004 · 007、REQ-WS-008）。
 * 正文永不经此写入（Yjs 唯一真源）；这里只管元数据 + 初始 ydoc（空 / 所选模板，ADR-0011 §2）。列表不返回正文列（02 §4）。
 */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { z } from 'zod'
import { emptyYdoc } from '../../collab/derive.ts'
import { ydocFromPm } from '../../collab/ydoc-json.ts'
import type {
  createEntrySchema,
  listEntriesQuery,
  patchEntrySchema,
} from '../../shared/schemas/entries.ts'
import { entryFieldsByKind } from '../../shared/schemas/entryFields.ts'
import type { EntryKind, EntryVisibility, SpaceRole } from '../../shared/schemas/enums.ts'
import {
  type Actor,
  assertCan,
  can,
  type EntryRef,
  type SpaceRef,
  visibleEntriesWhere,
} from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { member, user } from '../db/schema/auth.ts'
import { entries, entryTags, spaceMembers, spaces, tags } from '../db/schema/business.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'
import { type EventBus, getEventBus } from '../lib/event-bus.ts'
import { audit } from './audit.ts'
import { weightedTsv } from './derived.ts'
import { entryPath, liftChildren, placeNew } from './entry-tree.ts'
import { purgeLinksOf } from './links.ts'
import { publishChange } from './realtime.ts'
import { resolveTemplateBody } from './templates.ts'

export interface EntryCtx {
  actor: Actor
  workspaceId: string
  ip?: string | null
  userAgent?: string | null
  bus?: EventBus
}

type EntryRow = typeof entries.$inferSelect
type SpaceRow = typeof spaces.$inferSelect

export interface EntryView {
  id: string
  kind: EntryKind
  title: string
  spaceId: string
  spaceSlug: string
  fields: Record<string, unknown>
  visibility: EntryVisibility
  authorId: string
  author: { id: string; displayName: string }
  pinned: boolean
  wordCount: number | null
  ydocVersion: number
  editorSchemaVersion: number
  archivedAt: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  excerpt?: string
  pmJson?: unknown
  tagIds?: string[]
  /** 目录树（ADR-0012） */
  parentId: string | null
  treeOrder: string | null
  /** 仅详情：面包屑（根 → 父页） */
  path?: { id: string; title: string }[]
}

const EXCERPT_LEN = 160
const LEFT_MEMBER = '已离开的成员'

// ---------- 加载与鉴权引用 ----------

export async function loadSpaceRef(
  db: DbOrTx,
  actor: Actor,
  spaceId: string,
): Promise<{ row: SpaceRow; ref: SpaceRef } | null> {
  const [row] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1)
  if (!row) return null
  const [sm] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, actor.id)))
    .limit(1)
  return { row, ref: toSpaceRef(row, (sm?.role as SpaceRole | undefined) ?? null) }
}

const toSpaceRef = (s: SpaceRow, memberRole: SpaceRole | null): SpaceRef => ({
  id: s.id,
  visibility: s.visibility as SpaceRef['visibility'],
  isPersonal: s.isPersonal,
  createdBy: s.createdBy,
  archivedAt: s.archivedAt,
  deletedAt: s.deletedAt,
  memberRole,
})

const toEntryRef = (e: EntryRow, space: SpaceRef): EntryRef => ({
  id: e.id,
  authorId: e.authorId,
  visibility: e.visibility as EntryVisibility,
  deletedAt: e.deletedAt,
  archivedAt: e.archivedAt,
  space,
})

/** 读取一条记录并附鉴权引用；不存在 → null（collab onAuthenticate / 权限复核也用）。 */
export async function loadEntry(db: DbOrTx, actor: Actor, id: string) {
  const [e] = await db.select().from(entries).where(eq(entries.id, id)).limit(1)
  if (!e) return null
  const sp = await loadSpaceRef(db, actor, e.spaceId)
  if (!sp) return null
  return { row: e, space: sp, ref: toEntryRef(e, sp.ref) }
}

/** 不可见一律 404（02 §2）；回收站里的软删对象对作者 / admin 可见（用于 restore / permanent）。 */
async function requireEntry(
  db: DbOrTx,
  ctx: EntryCtx,
  id: string,
  opts: { allowDeleted?: boolean } = {},
) {
  const loaded = await loadEntry(db, ctx.actor, id)
  if (!loaded) throw AppError.notFound('记录不存在')
  const { row, ref } = loaded
  if (row.deletedAt && opts.allowDeleted) {
    const alive = { ...ref, deletedAt: null }
    const admin = can(ctx.actor, 'workspace.manage', null)
    if (!(admin || (row.authorId === ctx.actor.id && can(ctx.actor, 'entry.read', alive))))
      throw AppError.notFound('记录不存在')
    return loaded
  }
  if (!can(ctx.actor, 'entry.read', ref)) throw AppError.notFound('记录不存在')
  return loaded
}

// ---------- 序列化 ----------

/** 作者显示名；已不是工作区成员（被移除 / 注销）→ 不在 map 中，序列化为「已离开的成员」（REQ-WS-012）。 */
async function authorNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await db
    .select({ id: user.id, name: user.name, displayName: user.displayName })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(inArray(user.id, ids))
  return new Map(rows.map((r) => [r.id, r.displayName || r.name]))
}

function toView(
  e: EntryRow,
  space: SpaceRow,
  author: string | undefined,
  opts: { withBody?: boolean; excerpt?: boolean } = {},
): EntryView {
  const v: EntryView = {
    id: e.id,
    kind: e.kind as EntryKind,
    title: e.title,
    spaceId: e.spaceId,
    spaceSlug: space.slug,
    fields: (e.fields ?? {}) as Record<string, unknown>,
    visibility: e.visibility as EntryVisibility,
    authorId: e.authorId,
    author: { id: e.authorId, displayName: author ?? LEFT_MEMBER },
    pinned: e.pinned,
    wordCount: e.wordCount,
    ydocVersion: e.ydocVersion,
    editorSchemaVersion: e.editorSchemaVersion,
    archivedAt: e.archivedAt?.toISOString() ?? null,
    deletedAt: e.deletedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    parentId: e.parentId,
    treeOrder: e.treeOrder,
  }
  if (opts.excerpt) v.excerpt = (e.plain ?? '').slice(0, EXCERPT_LEN)
  if (opts.withBody) v.pmJson = e.pmJson ?? null
  return v
}

/** 记录元数据变更的实时失效；private 记录不在 key 里带 id（只失效列表前缀）。 */
function entryChanged(ctx: EntryCtx, spaceIds: string[], id: string, visibility: string) {
  publishChange(
    ctx,
    spaceIds,
    visibility === 'private' ? [['entries']] : [['entries'], ['entry', id]],
  )
}

// ---------- 列表 ----------

const SORT_COL = {
  updatedAt: entries.updatedAt,
  createdAt: entries.createdAt,
  title: entries.title,
} as const

export async function listEntries(db: Db, ctx: EntryCtx, q: z.infer<typeof listEntriesQuery>) {
  const conds: SQL[] = [eq(entries.workspaceId, ctx.workspaceId)]
  if (q.deleted) {
    // 回收站：本人可恢复的（作者）；owner/admin 全部（02 §5）
    conds.push(isNotNull(entries.deletedAt))
    if (!can(ctx.actor, 'workspace.manage', null)) conds.push(eq(entries.authorId, ctx.actor.id))
  } else {
    conds.push(visibleEntriesWhere(ctx.actor))
    conds.push(q.archived ? isNotNull(entries.archivedAt) : isNull(entries.archivedAt))
  }
  if (q.spaceId) {
    const sp = await loadSpaceRef(db, ctx.actor, q.spaceId)
    if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在') // 02 §4：不可见筛选 → 404
    conds.push(eq(entries.spaceId, q.spaceId))
  }
  if (q.kind?.length) conds.push(inArray(entries.kind, q.kind))
  for (const [name, vals] of Object.entries(q.fields ?? {}))
    conds.push(
      sql`${entries.fields} ->> ${name} in (${sql.join(
        vals.map((v) => sql`${v}`),
        sql`, `,
      )})`,
    )
  if (q.authorId) conds.push(eq(entries.authorId, q.authorId === 'me' ? ctx.actor.id : q.authorId))
  if (q.pinned !== undefined) conds.push(eq(entries.pinned, q.pinned))
  if (q.inTree !== undefined)
    conds.push(q.inTree ? isNotNull(entries.treeOrder) : isNull(entries.treeOrder))
  if (q.tag) {
    conds.push(
      sql`exists (select 1 from ${entryTags} et join ${tags} t on t.id = et.tag_id where et.entry_id = ${entries.id} and t.name in (${sql.join(
        q.tag.map((name) => sql`${name}`),
        sql`, `,
      )}))`,
    )
  }
  if (q.q) conds.push(or(ilike(entries.title, `%${q.q}%`), ilike(entries.plain, `%${q.q}%`))!)

  const primary = q.sort[0] ?? { field: 'updatedAt' as const, dir: 'desc' as const }
  const col = SORT_COL[primary.field]
  const c = decodeCursor(q.cursor, 2)
  if (q.cursor && !c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  if (c) {
    const [v, id] = c
    const val = primary.field === 'title' ? String(v) : new Date(String(v))
    conds.push(
      primary.dir === 'desc'
        ? sql`(${col}, ${entries.id}) < (${val}, ${String(id)}::uuid)`
        : sql`(${col}, ${entries.id}) > (${val}, ${String(id)}::uuid)`,
    )
  }
  const order = primary.dir === 'desc' ? [desc(col), desc(entries.id)] : [asc(col), asc(entries.id)]
  // 不取正文列（ydoc / pm_json / tsv），plain 只取前 EXCERPT_LEN 字（CLAUDE 不变量 6、REQ-ENTRY-002）
  const { ydoc: _y, pmJson: _p, tsv: _t, plain: _pl, ...listCols } = getTableColumns(entries)
  const rows = (
    await db
      .select({
        e: { ...listCols, plain: sql<string | null>`left(${entries.plain}, ${EXCERPT_LEN})` },
        s: spaces,
      })
      .from(entries)
      .innerJoin(spaces, eq(spaces.id, entries.spaceId))
      .where(and(...conds))
      .orderBy(...order)
      .limit(q.limit + 1)
  ).map((r) => ({ e: r.e as unknown as EntryRow, s: r.s }))
  const page = rows.slice(0, q.limit)
  const names = await authorNames(db, [...new Set(page.map((r) => r.e.authorId))])
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > q.limit && last
      ? encodeCursor([
          primary.field === 'title' ? last.e.title : (last.e[primary.field] as Date).toISOString(),
          last.e.id,
        ])
      : null
  // 卡片 / 表格显示标签（ADR-0012）：一次查出本页全部 tagIds
  const tagRows = page.length
    ? await db
        .select({ entryId: entryTags.entryId, tagId: entryTags.tagId })
        .from(entryTags)
        .where(
          inArray(
            entryTags.entryId,
            page.map((r) => r.e.id),
          ),
        )
    : []
  const tagsOf = new Map<string, string[]>()
  for (const r of tagRows) tagsOf.set(r.entryId, [...(tagsOf.get(r.entryId) ?? []), r.tagId])
  const items = page.map((r) => ({
    ...toView(r.e, r.s, names.get(r.e.authorId), { excerpt: true }),
    tagIds: tagsOf.get(r.e.id) ?? [],
  }))
  const total = q.withTotal
    ? ((
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(entries)
          .where(and(...conds.filter((x) => x !== undefined)))
      )[0]?.n ?? 0)
    : undefined
  return total === undefined ? { items, nextCursor } : { items, nextCursor, total }
}

// ---------- 创建 / 详情 / 修改 ----------

async function personalSpaceId(db: DbOrTx, ctx: EntryCtx): Promise<string> {
  const [s] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, ctx.workspaceId),
        eq(spaces.createdBy, ctx.actor.id),
        eq(spaces.isPersonal, true),
      ),
    )
    .limit(1)
  if (!s) throw AppError.notFound('个人空间不存在')
  return s.id
}

/**
 * 个人空间里的记录只能是 private（REQ-ENTRY-003）：工作区 owner/admin 能读任何人的个人空间（01 §5），
 * `space` / `workspace` 可见的随笔会被他们看到，违背「个人随笔」语义。
 */
function assertPersonalPrivate(isPersonal: boolean, visibility: EntryVisibility) {
  if (isPersonal && visibility !== 'private')
    throw AppError.validation([{ path: 'visibility', message: '个人空间里的记录只能是「仅自己」' }])
}

export async function createEntry(
  db: Db,
  ctx: EntryCtx,
  input: z.infer<typeof createEntrySchema>,
): Promise<{ id: string }> {
  const spaceId = input.spaceId ?? (await personalSpaceId(db, ctx))
  const sp = await loadSpaceRef(db, ctx.actor, spaceId)
  if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在')
  assertCan(ctx.actor, 'entry.create', sp.ref)
  const visibility = input.visibility ?? (sp.row.isPersonal ? 'private' : 'space')
  assertPersonalPrivate(sp.row.isPersonal, visibility)
  // 套模板（ADR-0011 §2）：模板正文一次性写成初始 ydoc；未选模板则首次打开按 kind 注入（03 §6）
  const body = await resolveTemplateBody(db, ctx, input.templateId, {
    space: sp.row.isPersonal ? '' : sp.row.name,
  })
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(entries)
      .values({
        workspaceId: ctx.workspaceId,
        spaceId,
        kind: input.kind,
        title: input.title,
        fields: input.fields,
        visibility,
        authorId: ctx.actor.id,
        ydoc: body ? ydocFromPm(body) : emptyYdoc(),
        ...(input.parentId !== undefined ? await placeNew(tx, ctx, spaceId, input.parentId) : {}),
      })
      .returning({ id: entries.id })
    if (!row) throw new Error('insert entries failed')
    if (input.tagIds?.length)
      await tx
        .insert(entryTags)
        .values(input.tagIds.map((tagId) => ({ entryId: row.id, tagId })))
        .onConflictDoNothing()
    return { id: row.id }
  })
  entryChanged(ctx, [spaceId], created.id, visibility)
  return created
}

export async function getEntry(
  db: Db,
  ctx: EntryCtx,
  id: string,
  opts: { withBody?: boolean } = {},
): Promise<EntryView> {
  const { row, space } = await requireEntry(db, ctx, id)
  const names = await authorNames(db, [row.authorId])
  const tagRows = await db
    .select({ tagId: entryTags.tagId })
    .from(entryTags)
    .where(eq(entryTags.entryId, id))
  return {
    ...toView(row, space.row, names.get(row.authorId), { withBody: opts.withBody }),
    tagIds: tagRows.map((t) => t.tagId),
    path: row.treeOrder !== null ? await entryPath(db, ctx, row.parentId) : [],
  }
}

/** 元数据乐观锁（02 §5）：ifUpdatedAt 不匹配 → 409 + current。 */
export async function patchEntry(
  db: Db,
  ctx: EntryCtx,
  id: string,
  patch: z.infer<typeof patchEntrySchema>,
): Promise<EntryView> {
  const loaded = await requireEntry(db, ctx, id)
  assertCan(ctx.actor, 'entry.write', loaded.ref)
  if (loaded.row.updatedAt.toISOString() !== new Date(patch.ifUpdatedAt).toISOString()) {
    const current = await getEntry(db, ctx, id)
    throw new AppError(409, 'CONFLICT_STALE', '记录已被他人修改', { current })
  }
  if (patch.fields !== undefined) {
    const r = entryFieldsByKind[loaded.row.kind as EntryKind].safeParse(patch.fields)
    if (!r.success)
      throw AppError.validation(
        r.error.issues.map((i) => ({ path: ['fields', ...i.path].join('.'), message: i.message })),
      )
  }
  let targetSpaceId = loaded.row.spaceId
  if (patch.spaceId && patch.spaceId !== loaded.row.spaceId) {
    const sp = await loadSpaceRef(db, ctx.actor, patch.spaceId)
    if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在')
    assertCan(ctx.actor, 'entry.create', sp.ref)
    targetSpaceId = patch.spaceId
  }
  const targetIsPersonal =
    targetSpaceId === loaded.row.spaceId
      ? loaded.space.row.isPersonal
      : !!(await loadSpaceRef(db, ctx.actor, targetSpaceId))?.row.isPersonal
  assertPersonalPrivate(
    targetIsPersonal,
    (patch.visibility ?? loaded.row.visibility) as EntryVisibility,
  )
  const accessChanged =
    (patch.visibility && patch.visibility !== loaded.row.visibility) ||
    targetSpaceId !== loaded.row.spaceId
  await db.transaction(async (tx) => {
    const set: Partial<typeof entries.$inferInsert> = { updatedAt: new Date() }
    if (patch.title !== undefined && patch.title !== loaded.row.title) {
      set.title = patch.title
      // 标题进 tsv（权重 A），正文部分取已派生的 plain（02 §4.1）
      set.tsv = weightedTsv(patch.title, loaded.row.plain ?? '') as unknown as string
    }
    if (patch.fields !== undefined) set.fields = patch.fields
    if (patch.visibility !== undefined) set.visibility = patch.visibility
    if (patch.pinned !== undefined) set.pinned = patch.pinned
    set.spaceId = targetSpaceId
    if (targetSpaceId !== loaded.row.spaceId) {
      // 移到别的分类：离开原目录，子页上移一级（ADR-0012）
      await liftChildren(tx, loaded.row)
      set.parentId = null
      set.treeOrder = null
    }
    await tx.update(entries).set(set).where(eq(entries.id, id))
    if (patch.tagIds) {
      await tx.delete(entryTags).where(eq(entryTags.entryId, id))
      if (patch.tagIds.length)
        await tx
          .insert(entryTags)
          .values(patch.tagIds.map((tagId) => ({ entryId: id, tagId })))
          .onConflictDoNothing()
    }
  })
  if (accessChanged) (ctx.bus ?? getEventBus()).publish('entry.access_changed', { entryIds: [id] })
  const view = await getEntry(db, ctx, id)
  entryChanged(ctx, [loaded.row.spaceId, targetSpaceId], id, view.visibility)
  return view
}

// ---------- 软删 / 永久删 / 恢复 / 归档 ----------

export async function softDeleteEntry(db: Db, ctx: EntryCtx, id: string): Promise<void> {
  const loaded = await requireEntry(db, ctx, id)
  assertCan(ctx.actor, 'entry.delete', loaded.ref)
  await db.transaction(async (tx) => {
    await liftChildren(tx, loaded.row) // 子页上移一级（ADR-0012）
    await tx
      .update(entries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(entries.id, id))
  })
  ;(ctx.bus ?? getEventBus()).publish('entry.access_changed', { entryIds: [id] })
  entryChanged(ctx, [loaded.row.spaceId], id, loaded.row.visibility)
}

export async function permanentlyDeleteEntry(db: Db, ctx: EntryCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'workspace.manage', null) // 仅 owner/admin（02 §5）
  const loaded = await loadEntry(db, ctx.actor, id)
  if (!loaded) throw AppError.notFound('记录不存在')
  await db.transaction(async (tx) => {
    await purgeLinksOf(tx, 'entry', id)
    await tx.delete(entries).where(eq(entries.id, id))
    await audit(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      action: 'entry.permanently_deleted',
      targetType: 'entry',
      targetId: id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { title: loaded.row.title, kind: loaded.row.kind, wasDeleted: !!loaded.row.deletedAt },
    })
  })
  ;(ctx.bus ?? getEventBus()).publish('entry.access_changed', { entryIds: [id] })
  entryChanged(ctx, [loaded.row.spaceId], id, loaded.row.visibility)
}

export async function restoreEntry(db: Db, ctx: EntryCtx, id: string): Promise<EntryView> {
  const loaded = await requireEntry(db, ctx, id, { allowDeleted: true })
  if (!loaded.row.deletedAt) throw new AppError(409, 'CONFLICT_STALE', '记录未被删除')
  await db.update(entries).set({ deletedAt: null, updatedAt: new Date() }).where(eq(entries.id, id))
  entryChanged(ctx, [loaded.row.spaceId], id, loaded.row.visibility)
  return getEntry(db, ctx, id)
}

export async function archiveEntry(
  db: Db,
  ctx: EntryCtx,
  id: string,
  archived: boolean,
): Promise<EntryView> {
  const loaded = await requireEntry(db, ctx, id)
  assertCan(ctx.actor, 'entry.write', loaded.ref)
  await db
    .update(entries)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(entries.id, id))
  entryChanged(ctx, [loaded.row.spaceId], id, loaded.row.visibility)
  return getEntry(db, ctx, id)
}

// ---------- 预览卡片（REQ-ENTRY-008、03 §3.2） ----------

export interface EntryPreview {
  id: string
  kind: EntryKind
  title: string
  excerpt: string
  author: { id: string; displayName: string }
  spaceSlug: string
  visibility: EntryVisibility
  updatedAt: string
  /** 按 kind 挑出的关键字段（标量，最多 3 个），供卡片角标。 */
  fieldsSummary: Record<string, string | number | boolean>
}

const SUMMARY_KEYS: Record<EntryKind, string[]> = {
  decision: ['status', 'decidedAt'],
  iteration: ['version', 'periodStart', 'periodEnd'],
  bug: ['severity', 'status'],
  changelog: ['version', 'releasedAt'],
  journal: ['mood'],
  note: [],
  review: [],
  optimize: ['status', 'metric'],
  plan: ['status', 'progress', 'endDate'],
}

/** GET /entries/:id/preview：受 entry.read 约束（不可见 → 404）。 */
export async function previewEntry(db: Db, ctx: EntryCtx, id: string): Promise<EntryPreview> {
  const { row, space } = await requireEntry(db, ctx, id)
  const names = await authorNames(db, [row.authorId])
  const fields = (row.fields ?? {}) as Record<string, unknown>
  const summary: EntryPreview['fieldsSummary'] = {}
  for (const k of SUMMARY_KEYS[row.kind as EntryKind] ?? []) {
    const v = fields[k]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') summary[k] = v
    if (Object.keys(summary).length >= 3) break
  }
  return {
    id: row.id,
    kind: row.kind as EntryKind,
    title: row.title,
    excerpt: (row.plain ?? '').slice(0, EXCERPT_LEN),
    author: { id: row.authorId, displayName: names.get(row.authorId) ?? LEFT_MEMBER },
    spaceSlug: space.row.slug,
    visibility: row.visibility as EntryVisibility,
    updatedAt: row.updatedAt.toISOString(),
    fieldsSummary: summary,
  }
}

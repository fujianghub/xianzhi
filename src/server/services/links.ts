/**
 * 链接与反链（01 §3.6、02 §9 /links、REQ-LINK-001 ~ 005、ADR-0012 §4 Bug ↔ 迭代）。
 * - 手动链接：需对「源」可写（entry.write / task.write）、对「目标」可读；五元组唯一，重复 409。
 * - `mentions` 只由正文派生（collab 落库 → writeEntryDerived → syncEntryMentions，与 rebuild 同路径），不可手建 / 手删。
 * - 读：出链与反链都逐个 can(read) 过滤——读不到的一端不出现（REQ-LINK-002）。
 * - 语义约定（ADR-0012）：「迭代 / 变更 → Bug」`resolves` = 该 Bug 在本期修复。
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { LinkFromType, LinkKind } from '../../shared/schemas/enums.ts'
import type { createLinkSchema } from '../../shared/schemas/links.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { type Actor, can } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { entries, links } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { loadEntryRef, loadTaskRef } from './refs.ts'

export interface LinkCtx {
  actor: Actor
  workspaceId: string
}

export interface LinkEnd {
  type: 'entry' | 'task' | 'cycle' | 'external'
  id: string | null
  title: string
  /** 记录 kind / 任务 status */
  kind?: string
  spaceSlug?: string
  fields?: Record<string, unknown>
  url?: string
}
export interface LinkView {
  id: string
  kind: LinkKind
  from: LinkEnd
  to: LinkEnd
  createdAt: string
}

type Row = typeof links.$inferSelect

/** 读一端（读不到 → null）。 */
async function endOf(
  db: DbOrTx,
  ctx: LinkCtx,
  type: string,
  id: string | null,
  ext?: { url: string | null; title: string | null },
): Promise<LinkEnd | null> {
  if (type === 'external')
    return { type: 'external', id: null, title: ext?.title || ext?.url || '', url: ext?.url ?? '' }
  if (!id) return null
  if (type === 'entry') {
    const e = await loadEntryRef(db, ctx.actor, ctx.workspaceId, id)
    if (!e || !can(ctx.actor, 'entry.read', e.ref)) return null
    return {
      type: 'entry',
      id,
      title: e.row.title,
      kind: e.row.kind,
      spaceSlug: e.space.row.slug,
      fields: (e.row.fields ?? {}) as Record<string, unknown>,
    }
  }
  if (type === 'task') {
    const t = await loadTaskRef(db, ctx.actor, ctx.workspaceId, id)
    if (!t || !can(ctx.actor, 'task.read', t.ref)) return null
    return { type: 'task', id, title: t.row.title, kind: t.row.status, spaceSlug: t.space.row.slug }
  }
  return null // cycle：二期
}

async function view(db: DbOrTx, ctx: LinkCtx, r: Row): Promise<LinkView | null> {
  const from = await endOf(db, ctx, r.fromType, r.fromId)
  const to = await endOf(db, ctx, r.toType, r.toId, { url: r.externalUrl, title: r.externalTitle })
  if (!from || !to) return null
  return { id: r.id, kind: r.kind as LinkKind, from, to, createdAt: r.createdAt.toISOString() }
}

async function assertWritable(db: DbOrTx, ctx: LinkCtx, type: string, id: string) {
  if (type === 'entry') {
    const e = await loadEntryRef(db, ctx.actor, ctx.workspaceId, id)
    if (!e || !can(ctx.actor, 'entry.read', e.ref)) throw AppError.notFound('记录不存在')
    if (!can(ctx.actor, 'entry.write', e.ref)) throw AppError.forbidden()
    return
  }
  if (type === 'task') {
    const t = await loadTaskRef(db, ctx.actor, ctx.workspaceId, id)
    if (!t || !can(ctx.actor, 'task.read', t.ref)) throw AppError.notFound('任务不存在')
    if (!can(ctx.actor, 'task.write', t.ref)) throw AppError.forbidden()
    return
  }
  throw AppError.validation([{ path: 'fromType', message: '一期只支持记录 / 任务' }])
}

/** GET /links?fromType&fromId：出链（REQ-LINK-003 · 005）。 */
export async function listLinks(
  db: DbOrTx,
  ctx: LinkCtx,
  q: { fromType: LinkFromType; fromId: string },
): Promise<LinkView[]> {
  if (!(await endOf(db, ctx, q.fromType, q.fromId))) throw AppError.notFound()
  const rows = await db
    .select()
    .from(links)
    .where(
      and(
        eq(links.workspaceId, ctx.workspaceId),
        eq(links.fromType, q.fromType),
        eq(links.fromId, q.fromId),
      ),
    )
    .orderBy(links.createdAt)
  return (await Promise.all(rows.map((r) => view(db, ctx, r)))).filter((x): x is LinkView => !!x)
}

/** GET /entries/:id/backlinks：指向该记录的链接（含 mentions），逐条 can(read) 过滤（REQ-LINK-002）。 */
export async function listBacklinks(
  db: DbOrTx,
  ctx: LinkCtx,
  entryId: string,
): Promise<LinkView[]> {
  if (!(await endOf(db, ctx, 'entry', entryId))) throw AppError.notFound('记录不存在')
  const rows = await db
    .select()
    .from(links)
    .where(
      and(
        eq(links.workspaceId, ctx.workspaceId),
        eq(links.toType, 'entry'),
        eq(links.toId, entryId),
      ),
    )
    .orderBy(links.createdAt)
  return (await Promise.all(rows.map((r) => view(db, ctx, r)))).filter((x): x is LinkView => !!x)
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === '23505' ||
  (err as { cause?: { code?: string } })?.cause?.code === '23505'

/** POST /links（REQ-LINK-003 · 004）。 */
export async function createLink(
  db: DbOrTx,
  ctx: LinkCtx,
  input: z.infer<typeof createLinkSchema>,
): Promise<LinkView> {
  await assertWritable(db, ctx, input.fromType, input.fromId)
  if (input.toType !== 'external') {
    if (input.toType === input.fromType && input.toId === input.fromId)
      throw AppError.validation([{ path: 'toId', message: '不能链接自己' }])
    if (!(await endOf(db, ctx, input.toType, input.toId ?? null)))
      throw AppError.validation([{ path: 'toId', message: '目标不存在' }])
  }
  try {
    const [row] = await db
      .insert(links)
      .values({
        workspaceId: ctx.workspaceId,
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: input.toType === 'external' ? null : (input.toId ?? null),
        externalUrl: input.toType === 'external' ? (input.externalUrl ?? null) : null,
        externalTitle: input.externalTitle ?? null,
        kind: input.kind,
        createdBy: ctx.actor.id,
      })
      .returning()
    if (!row) throw new Error('insert links failed')
    const v = await view(db, ctx, row)
    if (!v) throw AppError.notFound()
    return v
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'CONFLICT_UNIQUE', '链接已存在')
    throw err
  }
}

/** DELETE /links/:id：对源或目标任一端可写即可；mentions 403（REQ-LINK-001）。 */
export async function deleteLink(db: DbOrTx, ctx: LinkCtx, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(links)
    .where(and(eq(links.id, id), eq(links.workspaceId, ctx.workspaceId)))
  if (!row || !(await view(db, ctx, row))) throw AppError.notFound('链接不存在')
  if (row.kind === 'mentions') throw AppError.forbidden('正文里的链接随正文维护')
  const writable = async (type: string, oid: string | null) => {
    if (!oid) return false
    try {
      await assertWritable(db, ctx, type, oid)
      return true
    } catch {
      return false
    }
  }
  if (!(await writable(row.fromType, row.fromId)) && !(await writable(row.toType, row.toId)))
    throw AppError.forbidden()
  await db.delete(links).where(eq(links.id, id))
}

/** 正文里指向的记录：entryLink(id) 与 entryCard(entryId)。 */
export function mentionedEntryIds(doc: PmNode | null | undefined): Set<string> {
  const out = new Set<string>()
  const walk = (n: PmNode) => {
    const a = n.attrs as Record<string, unknown> | undefined
    if (n.type === 'entryLink' && typeof a?.id === 'string') out.add(a.id)
    if (n.type === 'entryCard' && typeof a?.entryId === 'string') out.add(a.entryId)
    for (const c of n.content ?? []) walk(c)
  }
  if (doc) walk(doc)
  return out
}

/**
 * REQ-LINK-001：把正文里的记录引用同步为 `links(kind=mentions)`（增删到一致）。
 * 与 writeEntryDerived 同事务调用（collab 落库与 rebuild-derived 同一路径）；只链向同工作区、未删除的记录。
 */
export async function syncEntryMentions(db: DbOrTx, entryId: string, doc: PmNode | null) {
  const [src] = await db
    .select({ ws: entries.workspaceId, author: entries.authorId })
    .from(entries)
    .where(eq(entries.id, entryId))
  if (!src) return
  const want = mentionedEntryIds(doc)
  want.delete(entryId)
  const valid = want.size
    ? (
        await db
          .select({ id: entries.id })
          .from(entries)
          .where(and(inArray(entries.id, [...want]), eq(entries.workspaceId, src.ws)))
      ).map((r) => r.id)
    : []
  const have = await db
    .select({ id: links.id, toId: links.toId })
    .from(links)
    .where(and(eq(links.fromType, 'entry'), eq(links.fromId, entryId), eq(links.kind, 'mentions')))
  const haveIds = new Set(have.map((h) => h.toId))
  const gone = have.filter((h) => !h.toId || !valid.includes(h.toId)).map((h) => h.id)
  if (gone.length) await db.delete(links).where(inArray(links.id, gone))
  const add = valid.filter((id) => !haveIds.has(id))
  if (add.length)
    await db
      .insert(links)
      .values(
        add.map((toId) => ({
          workspaceId: src.ws,
          fromType: 'entry',
          fromId: entryId,
          toType: 'entry',
          toId,
          kind: 'mentions',
          createdBy: src.author,
        })),
      )
      .onConflictDoNothing()
}

/** 删除记录 / 任务时顺带清理其链接（永久删除路径调用）。 */
export async function purgeLinksOf(db: DbOrTx, type: 'entry' | 'task', id: string) {
  await db
    .delete(links)
    .where(
      sql`(${links.fromType} = ${type} and ${links.fromId} = ${id}) or (${links.toType} = ${type} and ${links.toId} = ${id})`,
    )
}

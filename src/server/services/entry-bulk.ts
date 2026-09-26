/**
 * 记录的收藏与批量操作（ADR-0014、REQ-ENTRY-012 · 013）。
 * - 收藏：个人（entry_favorites），需可读该记录；列表 `favorite=1` 过滤、每项带 `favorited`。
 * - 批量：逐条走既有 service（鉴权 / 审计 / 实时失效与单条一致），单条失败不影响其它条，返回 ok / failed 明细。
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import type { batchEntriesSchema } from '../../shared/schemas/entries.ts'
import { assertCan, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { entries, entryFavorites, entryTags, tags } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { archiveEntry, type EntryCtx, loadEntry, patchEntry, softDeleteEntry } from './entries.ts'

export async function setFavorite(db: Db, ctx: EntryCtx, id: string, on: boolean) {
  const e = await loadEntry(db, ctx.actor, id)
  if (!e || e.row.deletedAt || !can(ctx.actor, 'entry.read', e.ref))
    throw AppError.notFound('记录不存在')
  if (on)
    await db
      .insert(entryFavorites)
      .values({ userId: ctx.actor.id, entryId: id })
      .onConflictDoNothing()
  else
    await db
      .delete(entryFavorites)
      .where(and(eq(entryFavorites.userId, ctx.actor.id), eq(entryFavorites.entryId, id)))
  return { id, favorited: on }
}

export interface BatchResult {
  ok: string[]
  failed: { id: string; code: string; message: string }[]
}

export async function batchEntries(
  db: Db,
  ctx: EntryCtx,
  input: z.infer<typeof batchEntriesSchema>,
): Promise<BatchResult> {
  const out: BatchResult = { ok: [], failed: [] }
  let tagIds: { add: string[]; remove: string[] } | null = null
  if (input.op === 'tags') {
    const all = [...input.add, ...input.remove]
    const found = all.length
      ? (
          await db
            .select({ id: tags.id })
            .from(tags)
            .where(and(inArray(tags.id, all), eq(tags.workspaceId, ctx.workspaceId)))
        ).map((t) => t.id)
      : []
    if (found.length !== new Set(all).size)
      throw AppError.validation([{ path: 'add', message: '标签不存在' }])
    tagIds = { add: input.add, remove: input.remove }
  }
  for (const id of [...new Set(input.ids)]) {
    try {
      switch (input.op) {
        case 'move': {
          const [row] = await db
            .select({ u: entries.updatedAt })
            .from(entries)
            .where(eq(entries.id, id))
          if (!row) throw AppError.notFound('记录不存在')
          await patchEntry(db, ctx, id, {
            spaceId: input.spaceId,
            ifUpdatedAt: row.u.toISOString(),
          })
          break
        }
        case 'tags': {
          const e = await loadEntry(db, ctx.actor, id)
          if (!e || e.row.deletedAt || !can(ctx.actor, 'entry.read', e.ref))
            throw AppError.notFound('记录不存在')
          assertCan(ctx.actor, 'entry.write', e.ref)
          if (tagIds?.remove.length)
            await db
              .delete(entryTags)
              .where(and(eq(entryTags.entryId, id), inArray(entryTags.tagId, tagIds.remove)))
          if (tagIds?.add.length)
            await db
              .insert(entryTags)
              .values(tagIds.add.map((tagId) => ({ entryId: id, tagId })))
              .onConflictDoNothing()
          break
        }
        case 'archive':
        case 'unarchive':
          await archiveEntry(db, ctx, id, input.op === 'archive')
          break
        case 'delete':
          await softDeleteEntry(db, ctx, id)
          break
      }
      out.ok.push(id)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      out.failed.push({
        id,
        code: err instanceof AppError ? err.code : 'INTERNAL',
        message: e.message ?? '',
      })
    }
  }
  return out
}

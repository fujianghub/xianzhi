/**
 * 记录的收藏与批量操作（ADR-0014、REQ-ENTRY-012 · 013）。
 * - 收藏：个人（entry_favorites），需可读该记录；列表 `favorite=1` 过滤、每项带 `favorited`。
 * - 批量：逐条走既有 service（鉴权 / 审计 / 实时失效与单条一致），单条失败不影响其它条，返回 ok / failed 明细。
 * - ADR-0016：retype（改类型，fields 按目标类型重建）· fields（改状态 / 进度，合并进现有 fields 再按类型校验）· pin / unpin。
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import type { batchEntriesSchema } from '../../shared/schemas/entries.ts'
import { assertCan, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { entries, entryFavorites, entryTags } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { archiveEntry, type EntryCtx, loadEntry, patchEntry, softDeleteEntry } from './entries.ts'
import { loadOwnEntryType } from './entry-types.ts'
import { assertOwnTags } from './tags.ts'

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
    // 只能用自己的标签（ADR-0017）；增删只动这些标签的关联，别人打的标签不受影响
    await assertOwnTags(db, ctx, [...input.add, ...input.remove], 'add')
    tagIds = { add: input.add, remove: input.remove }
  }
  if (input.op === 'retype' && input.typeId && !(await loadOwnEntryType(db, ctx, input.typeId)))
    throw AppError.validation([{ path: 'typeId', message: '类型不存在' }])
  /** 读当前 updatedAt / fields，再走 patchEntry（与单条 PATCH 同一套鉴权、校验与失效） */
  const current = async (id: string) => {
    const [row] = await db
      .select({ u: entries.updatedAt, fields: entries.fields })
      .from(entries)
      .where(eq(entries.id, id))
    if (!row) throw AppError.notFound('记录不存在')
    return {
      ifUpdatedAt: row.u.toISOString(),
      fields: (row.fields ?? {}) as Record<string, unknown>,
    }
  }
  for (const id of [...new Set(input.ids)]) {
    try {
      switch (input.op) {
        case 'move': {
          const c = await current(id)
          await patchEntry(db, ctx, id, { spaceId: input.spaceId, ifUpdatedAt: c.ifUpdatedAt })
          break
        }
        case 'retype': {
          const c = await current(id)
          await patchEntry(db, ctx, id, {
            kind: input.kind,
            ...(input.typeId ? { typeId: input.typeId } : {}),
            ifUpdatedAt: c.ifUpdatedAt,
          })
          break
        }
        case 'fields': {
          const c = await current(id)
          await patchEntry(db, ctx, id, {
            fields: { ...c.fields, ...input.set },
            ifUpdatedAt: c.ifUpdatedAt,
          })
          break
        }
        case 'pin':
        case 'unpin': {
          const c = await current(id)
          await patchEntry(db, ctx, id, { pinned: input.op === 'pin', ifUpdatedAt: c.ifUpdatedAt })
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

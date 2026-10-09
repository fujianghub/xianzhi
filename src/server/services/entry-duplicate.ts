/**
 * 复制记录（ADR-0054 §C、REQ-ENTRY-038）：`POST /entries/:id/duplicate`。
 * - 源须可读（404），目标空间须可读（404）且可建记录（403）；
 * - 正文：从 ydoc（唯一真源）即时派生 PM JSON → 去掉评论标记（评论线程不随副本走）→ 引用的附件为副本另建
 *   （复制者能读的；文件复制、绑副本）并改写引用 → 新建一份 gc:false ydoc；同事务写派生列（不等首次打开）；
 * - 元数据：类型 / 来源模板 / 属性沿用；空间类型到不了别的空间 → 降为随笔（同模板「复制到我的」）；
 *   可见性：进个人空间 = 仅自己，离开个人空间 = 空间可见，其余沿用；标签只带复制者自己的（标签是个人的）；
 *   流转从新建起算；不带收藏 / 固定 / 归档 / 评论 / 版本 / 手动关联；
 * - 位置：见 duplicateEntrySchema。
 */
import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import { deriveFromYdoc, emptyYdoc } from '../../collab/derive.ts'
import { ydocFromPm } from '../../collab/ydoc-json.ts'
import type { duplicateEntrySchema } from '../../shared/schemas/entries.ts'
import type { EntryKind, EntryVisibility } from '../../shared/schemas/enums.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { assertCan, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { attachments, entries, entryTags } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { cloneAttachmentsFor } from './attachments.ts'
import { localDay, normalizeBugFields, timezoneOf } from './bug-fields.ts'
import { writeEntryDerived } from './derived.ts'
import {
  assertPersonalPrivate,
  type EntryCtx,
  entryChanged,
  loadSpaceRef,
  requireEntry,
  resolveKindFields,
} from './entries.ts'
import { placeNew } from './entry-tree.ts'
import { recordFieldChanges } from './field-changes.ts'
import { ownTagIdsSql } from './tags.ts'

const ATTACH = /^xz:attachment\/([0-9a-f-]{36})$/i

/** 正文里引用的附件 id（图片 src、文件节点 attachmentId） */
export function attachmentIdsOf(doc: PmNode | null | undefined): string[] {
  const out = new Set<string>()
  const walk = (n: PmNode) => {
    const a = n.attrs as Record<string, unknown> | undefined
    if (a) {
      const m = typeof a.src === 'string' ? ATTACH.exec(a.src) : null
      if (m?.[1]) out.add(m[1].toLowerCase())
      if (typeof a.attachmentId === 'string') out.add(a.attachmentId.toLowerCase())
    }
    for (const c of n.content ?? []) walk(c)
  }
  if (doc) walk(doc)
  return [...out]
}

/** 副本正文：去评论标记 + 按 map 改写附件引用（纯函数，单测覆盖） */
export function rewriteForCopy(doc: PmNode, map: Map<string, string>): PmNode {
  const walk = (n: PmNode): PmNode => {
    const next: PmNode = { ...n }
    if (n.marks) {
      const marks = n.marks.filter((m) => m.type !== 'comment')
      if (marks.length) next.marks = marks
      else delete next.marks
    }
    const a = n.attrs as Record<string, unknown> | undefined
    if (a) {
      const attrs = { ...a }
      const m = typeof a.src === 'string' ? ATTACH.exec(a.src) : null
      const to = m?.[1] ? map.get(m[1].toLowerCase()) : undefined
      if (to) attrs.src = `xz:attachment/${to}`
      if (typeof a.attachmentId === 'string') {
        const id = map.get(a.attachmentId.toLowerCase())
        if (id) attrs.attachmentId = id
      }
      next.attrs = attrs
    }
    if (n.content) next.content = n.content.map(walk)
    return next
  }
  return walk(doc)
}

const copyTitle = (title: string) => {
  const base = title.trim() || '无标题'
  const suffix = ' 副本'
  return `${base.slice(0, 200 - suffix.length)}${suffix}`
}

export async function duplicateEntry(
  db: Db,
  ctx: EntryCtx,
  id: string,
  input: z.infer<typeof duplicateEntrySchema>,
): Promise<{ id: string }> {
  const { row: src, space: srcSpace } = await requireEntry(db, ctx, id)
  const spaceId = input.spaceId ?? src.spaceId
  const sp = spaceId === src.spaceId ? srcSpace : await loadSpaceRef(db, ctx.actor, spaceId)
  if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在')
  assertCan(ctx.actor, 'entry.create', sp.ref)

  const visibility: EntryVisibility = sp.row.isPersonal
    ? 'private'
    : srcSpace.row.isPersonal
      ? 'space'
      : (src.visibility as EntryVisibility)
  assertPersonalPrivate(sp.row.isPersonal, visibility)

  // 类型与属性：到不了目标空间的空间类型（或已被删的内置类型）降为随笔
  const templateId = src.templateId
  let typed: { kind: EntryKind; typeId: string | null; fields: Record<string, unknown> }
  try {
    typed = await resolveKindFields(
      db,
      ctx,
      src.kind as EntryKind,
      src.typeId,
      (src.fields ?? {}) as Record<string, unknown>,
      { fillDefault: true, spaceId, templateId },
    )
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 422) throw err
    typed = await resolveKindFields(db, ctx, 'note', null, {}, { fillDefault: true, spaceId })
  }
  if (typed.kind === 'bug')
    typed.fields = normalizeBugFields(null, typed.fields, {
      today: localDay(await timezoneOf(db, ctx.actor.id, ctx.timezone), new Date()),
    })

  // 位置
  const sameSpace = spaceId === src.spaceId
  const place = async (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => {
    if (input.detach) return {}
    if (input.parentId !== undefined) return placeNew(tx, ctx, spaceId, input.parentId)
    if (!sameSpace || src.treeOrder === null) return {}
    // 紧跟在源之后：源与其下一个同级之间
    const [next] = await tx
      .select({ k: entries.treeOrder })
      .from(entries)
      .where(
        and(
          eq(entries.spaceId, spaceId),
          src.parentId ? eq(entries.parentId, src.parentId) : isNull(entries.parentId),
          isNotNull(entries.treeOrder),
          isNull(entries.deletedAt),
          gt(entries.treeOrder, src.treeOrder),
        ),
      )
      .orderBy(asc(entries.treeOrder))
      .limit(1)
    return {
      parentId: src.parentId,
      treeOrder: generateKeyBetween(src.treeOrder, next?.k ?? null),
    }
  }

  // 正文（ydoc 唯一真源；从未落库过的空文档保持 version 0，首次打开照常注入骨架）
  const derived = src.ydoc.length ? deriveFromYdoc(src.ydoc).pmJson : null
  const newId = crypto.randomUUID()
  const cloned =
    derived && ctx.dataDir
      ? await cloneAttachmentsFor(
          db,
          { actor: ctx.actor, workspaceId: ctx.workspaceId, dataDir: ctx.dataDir },
          attachmentIdsOf(derived),
          { type: 'entry', id: newId },
        )
      : null
  const body = derived ? rewriteForCopy(derived, cloned?.map ?? new Map()) : null
  const ydoc = body ? ydocFromPm(body) : emptyYdoc()

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(entries)
        .values({
          id: newId,
          workspaceId: ctx.workspaceId,
          spaceId,
          kind: typed.kind,
          typeId: typed.typeId,
          templateId: typed.typeId === src.typeId ? templateId : null,
          title: input.title ?? copyTitle(src.title),
          fields: typed.fields,
          visibility,
          authorId: ctx.actor.id,
          ydoc,
          ydocVersion: src.ydocVersion > 0 ? 1 : 0,
          ...(await place(tx)),
        })
        .returning({ id: entries.id })
      if (!row) throw new Error('insert entries failed')
      if (cloned?.rows.length) await tx.insert(attachments).values(cloned.rows)
      await recordFieldChanges(tx, ctx, newId, null, typed.fields)
      // 复制者自己的标签（标签是个人的，ADR-0017）
      await tx.execute(sql`
        insert into ${entryTags} (entry_id, tag_id)
        select ${newId}, et.tag_id from ${entryTags} et
        where et.entry_id = ${src.id} and et.tag_id in ${ownTagIdsSql(ctx.actor.id)}
        on conflict do nothing`)
      // 派生列同事务写（列表摘要 / 搜索不等首次打开）
      if (body) await writeEntryDerived(tx, newId, ydoc)
    })
  } catch (err) {
    await cloned?.cleanup()
    throw err
  }
  entryChanged(ctx, [spaceId], newId, visibility)
  return { id: newId }
}

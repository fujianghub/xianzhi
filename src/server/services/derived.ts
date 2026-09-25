/**
 * 派生列重建（01 §7、REQ-ENTRY-010）：entries 从 ydoc，tasks / comments 从 pm_json；与实时路径共用 collab/derive.ts。
 * 每批 200 行、逐行独立事务；失败写 entries.derived_error 不中断。
 */
import { eq, sql } from 'drizzle-orm'
import { deriveFromPm, deriveFromYdoc } from '../../collab/derive.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { comments, entries, tasks } from '../db/schema/business.ts'
import { tsvText } from '../lib/tokenize.ts'
import { syncEntryMentions } from './links.ts'

export interface RebuildReport {
  entries?: { total: number; ok: number; failed: number }
  tasks?: { total: number; ok: number }
  comments?: { total: number; ok: number }
}

/**
 * 加权 tsvector（02 §4.1）：标题 A、正文 D。任务、记录（collab 落库 / 改标题 / 重建）、seed 共用，
 * 保证实时派生与 `xz rebuild-derived` 逐字节一致（REQ-ENTRY-010）。
 */
export function weightedTsv(title: string, body: string) {
  return sql`setweight(to_tsvector('simple', ${tsvText(title)}), 'A') || setweight(to_tsvector('simple', ${tsvText(body)}), 'D')`
}

/** 写单条记录的派生列（onStoreDocument 与 rebuild 共用）。 */
export async function writeEntryDerived(db: DbOrTx, id: string, ydoc: Uint8Array): Promise<void> {
  const d = deriveFromYdoc(ydoc)
  const [row] = await db.select({ title: entries.title }).from(entries).where(eq(entries.id, id))
  await db
    .update(entries)
    .set({
      pmJson: d.pmJson,
      plain: d.plain,
      wordCount: d.wordCount,
      tsv: weightedTsv(row?.title ?? '', d.plain),
      derivedAt: new Date(),
      derivedError: null,
    })
    .where(eq(entries.id, id))
  await syncCommentAnchors(db, id, d.pmJson)
  await syncEntryMentions(db, id, d.pmJson) // REQ-LINK-001：正文引用 → links(kind=mentions)
}

/** 正文里所有 `comment(threadId)` 标记（03 §3.2）。 */
export function commentThreadIds(doc: PmNode | null | undefined): Set<string> {
  const out = new Set<string>()
  const walk = (n: PmNode) => {
    for (const m of n.marks ?? [])
      if (m.type === 'comment' && typeof m.attrs?.threadId === 'string') out.add(m.attrs.threadId)
    for (const c of n.content ?? []) walk(c)
  }
  if (doc) walk(doc)
  return out
}

/**
 * 锚定线程的 orphaned（REQ-COMMENT-002、01 §3.9）：根评论 `thread_id ≠ id` 的线程由编辑器锚定创建；
 * 正文里找不到其标记 → orphaned = true，标记恢复（撤销删除）→ false。非锚定线程（任务评论、记录级评论）不动。
 */
export async function syncCommentAnchors(db: DbOrTx, entryId: string, doc: PmNode | null) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const present = [...commentThreadIds(doc)].filter((t) => UUID.test(t))
  const presentSql = present.length
    ? sql`array[${sql.join(
        present.map((t) => sql`${t}`),
        sql`, `,
      )}]::uuid[]`
    : sql`array[]::uuid[]`
  await db.execute(sql`
    update comments c set orphaned = not (c.thread_id = any(${presentSql}))
    where c.target_type = 'entry' and c.target_id = ${entryId}
      and c.thread_id in (
        select r.thread_id from comments r
        where r.target_type = 'entry' and r.target_id = ${entryId}
          and r.parent_id is null and r.thread_id <> r.id
      )
      and c.orphaned is distinct from not (c.thread_id = any(${presentSql}))
  `)
}

export async function rebuildEntries(
  db: Db,
  onProgress?: (n: number) => void,
): Promise<NonNullable<RebuildReport['entries']>> {
  const ids = await db.select({ id: entries.id }).from(entries).orderBy(entries.id)
  let ok = 0
  let failed = 0
  for (const { id } of ids) {
    const [row] = await db
      .select({ ydoc: entries.ydoc })
      .from(entries)
      .where(eq(entries.id, id))
      .limit(1)
    if (!row) continue
    try {
      await writeEntryDerived(db, id, row.ydoc)
      ok++
    } catch (err) {
      failed++
      await db
        .update(entries)
        .set({ derivedError: String(err instanceof Error ? err.message : err).slice(0, 500) })
        .where(eq(entries.id, id))
    }
    onProgress?.(ok + failed)
  }
  return { total: ids.length, ok, failed }
}

/**
 * 任务派生列（01 §3.2、CLAUDE 不变量 1）：title + descriptionPm → description_plain / tsv。
 * tasks service 在写 title / descriptionPm 的同一事务里调用；`xz rebuild-derived` 复用。
 */
export function taskDerivedSet(title: string, pm: unknown) {
  const d = deriveFromPm((pm ?? null) as PmNode | null)
  return { descriptionPlain: pm ? d.plain : null, tsv: weightedTsv(title, pm ? d.plain : '') }
}

export async function rebuildTasks(db: Db): Promise<NonNullable<RebuildReport['tasks']>> {
  const rows = await db
    .select({ id: tasks.id, pm: tasks.descriptionPm, title: tasks.title })
    .from(tasks)
  for (const r of rows)
    await db.update(tasks).set(taskDerivedSet(r.title, r.pm)).where(eq(tasks.id, r.id))
  return { total: rows.length, ok: rows.length }
}

export async function rebuildComments(db: Db): Promise<NonNullable<RebuildReport['comments']>> {
  const rows = await db.select({ id: comments.id, pm: comments.bodyPm }).from(comments)
  for (const r of rows) {
    const d = deriveFromPm(r.pm as PmNode)
    await db.update(comments).set({ bodyPlain: d.plain }).where(eq(comments.id, r.id))
  }
  return { total: rows.length, ok: rows.length }
}

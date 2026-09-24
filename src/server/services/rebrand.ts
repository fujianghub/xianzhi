/**
 * 品牌更名数据迁移（ADR-0004：生长间奏 / gi → 衔枝 / xz）：`pnpm xz migrate-prefix`，幂等，可重复执行。
 * - 正文 ydoc：元素属性（image.src、entryLink 等）与文本 link 标记里的 `gi:attachment/`、`gi://` → `xz:`；改写后重算派生列。
 * - 任务描述 / 评论正文 JSON：同样的前缀替换（liteKit 不走 Yjs）。
 * - 工作区：名称「生长间奏」→「衔枝」、slug `gi` → `xz`（仅当仍是旧默认值）。
 * - outbox 触发器：旧的 `gi_events_notify` 函数 / 触发器（通道 `gi_outbox`）换成迁移 0002 的 `xz_*` 版本。
 */
import { eq, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { YDOC_FRAGMENT } from '../../collab/derive.ts'
import type { Db } from '../db/index.ts'
import { organization } from '../db/schema/auth.ts'
import { entries } from '../db/schema/business.ts'
import { writeEntryDerived } from './derived.ts'

const LEGACY = [
  ['gi:attachment/', 'xz:attachment/'],
  ['gi://', 'xz://'],
] as const
const fix = (v: string) => {
  for (const [a, b] of LEGACY) if (v.startsWith(a)) return b + v.slice(a.length)
  return v
}

/** 改写 ydoc 里的旧前缀；无改动返回 null。 */
export function rewriteYdoc(bytes: Uint8Array): Uint8Array | null {
  const doc = new Y.Doc({ gc: false })
  Y.applyUpdate(doc, bytes)
  let changed = false
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement) {
        for (const [k, v] of Object.entries(child.getAttributes())) {
          if (typeof v === 'string' && fix(v) !== v) {
            child.setAttribute(k, fix(v) as never)
            changed = true
          }
        }
        walk(child)
      } else if (child instanceof Y.XmlText) {
        let pos = 0
        for (const d of child.toDelta() as {
          insert: string
          attributes?: Record<string, { href?: string }>
        }[]) {
          const len = typeof d.insert === 'string' ? d.insert.length : 1
          const href = d.attributes?.link?.href
          if (href && fix(href) !== href) {
            child.format(pos, len, { link: { ...d.attributes?.link, href: fix(href) } })
            changed = true
          }
          pos += len
        }
      }
    }
  }
  doc.transact(() => walk(doc.getXmlFragment(YDOC_FRAGMENT)))
  return changed ? Y.encodeStateAsUpdate(doc) : null
}

export async function migrateLegacyPrefix(db: Db) {
  const report = { entries: 0, tasks: 0, comments: 0, workspace: 0, outboxTrigger: false }
  const rows = await db.select({ id: entries.id, ydoc: entries.ydoc }).from(entries)
  for (const r of rows) {
    const next = rewriteYdoc(r.ydoc)
    if (!next) continue
    await db
      .update(entries)
      .set({ ydoc: Buffer.from(next) })
      .where(eq(entries.id, r.id))
    await writeEntryDerived(db, r.id, next)
    report.entries++
  }
  for (const [table, col, key] of [
    ['tasks', 'description_pm', 'tasks'],
    ['comments', 'body_pm', 'comments'],
  ] as const) {
    const res = await db.execute(sql`
      update ${sql.identifier(table)}
      set ${sql.identifier(col)} = replace(replace(${sql.identifier(col)}::text, '"gi:attachment/', '"xz:attachment/'), '"gi://', '"xz://')::jsonb
      where ${sql.identifier(col)}::text like '%"gi:attachment/%' or ${sql.identifier(col)}::text like '%"gi://%'`)
    report[key] = res.rowCount ?? 0
  }
  const ws = await db
    .update(organization)
    .set({ name: '衔枝' })
    .where(eq(organization.name, '生长间奏'))
    .returning({ id: organization.id })
  const slug = await db
    .update(organization)
    .set({ slug: 'xz' })
    .where(eq(organization.slug, 'gi'))
    .returning({ id: organization.id })
  report.workspace = ws.length + slug.length
  const [old] = (
    await db.execute(sql`select 1 as x from pg_proc where proname = 'gi_events_notify'`)
  ).rows as { x: number }[]
  if (old) {
    await db.execute(sql`CREATE OR REPLACE FUNCTION xz_events_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('xz_outbox', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`)
    await db.execute(sql`DROP TRIGGER IF EXISTS gi_events_notify ON events`)
    await db.execute(sql`DROP TRIGGER IF EXISTS xz_events_notify ON events`)
    await db.execute(
      sql`CREATE TRIGGER xz_events_notify AFTER INSERT ON events FOR EACH STATEMENT EXECUTE FUNCTION xz_events_notify()`,
    )
    await db.execute(sql`DROP FUNCTION IF EXISTS gi_events_notify()`)
    report.outboxTrigger = true
  }
  return report
}

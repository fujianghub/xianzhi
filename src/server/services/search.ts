/**
 * 搜索（02 §4.1、REQ-SEARCH-001 ~ 005）。
 * - 范围：任务 title + description_plain、记录 title + plain、标签名；先 visible*Where 过滤（软删、归档记录、归档空间不入结果）。
 * - 匹配：分词与索引同一个 tokenize()；q 分词后 plainto_tsquery（AND）命中 tsv，或标题 / 标签 ILIKE 子串（pg_trgm 兜底）；
 *   q 只有 1 个字符或分不出词时只走子串（规范原文 ≤ 2 字符，对中文词不适用，见 02 §4.1 注）。
 * - 排序：ts_rank_cd（标题 A / 正文 D）× 近期系数 1/(1+天数/30)，标题子串命中 +0.1，固定记录 +0.2；同分按 updated_at desc, id。
 * - 高亮：在 JS 里按分词结果定位并转义其余文本（ts_headline 的默认解析器把连续中文当成一个词，无法高亮「缓存」这类词）。
 * - 分组独立游标；空 q 时按客户端回传的最近访问 id 返回可见对象。
 */
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { searchQuery } from '../../shared/schemas/search.ts'
import { type Actor, can, visibleEntriesWhere, visibleTasksWhere } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { entries, entryTags, spaces, tags, tasks, taskTags } from '../db/schema/business.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'
import { tokenize } from '../lib/tokenize.ts'
import { loadSpaceRef } from './entries.ts'

export interface SearchCtx {
  actor: Actor
  workspaceId: string
}

export interface SearchHit {
  type: 'task' | 'entry'
  id: string
  title: string
  /** 只含 <mark> 标签，其余已转义 */
  highlight: string
  spaceSlug: string
  kind?: string
  status?: string
  updatedAt: string
  score: number
}

interface Group {
  items: SearchHit[]
  nextCursor: string | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

/** 片段高亮：最多 2 段、每段约 60 字，命中词用 <mark> 包裹，其余转义（02 §4.1 高亮规则的 JS 实现）。 */
export function highlight(text: string, terms: string[], maxFragments = 2, radius = 30): string {
  const src = text.replace(/\s+/g, ' ').trim()
  if (!src) return ''
  const words = [...new Set(terms.map((t) => t.toLowerCase()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  if (!words.length) return esc(src.slice(0, radius * 2))
  const lower = src.toLowerCase()
  const hits: [number, number][] = []
  for (const w of words) {
    let i = lower.indexOf(w)
    while (i >= 0) {
      if (!hits.some(([s, e]) => i < e && i + w.length > s)) hits.push([i, i + w.length])
      i = lower.indexOf(w, i + w.length)
    }
  }
  if (!hits.length) return esc(src.slice(0, radius * 2))
  hits.sort((a, b) => a[0] - b[0])
  const frags: [number, number][] = []
  for (const [s, e] of hits) {
    const last = frags[frags.length - 1]
    if (last && s - radius <= last[1]) last[1] = Math.max(last[1], e + radius)
    else if (frags.length < maxFragments) frags.push([Math.max(0, s - radius), e + radius])
  }
  return frags
    .map(([fs, fe]) => {
      const end = Math.min(src.length, fe)
      let out = ''
      let pos = fs
      for (const [s, e] of hits) {
        if (e <= fs || s >= end) continue
        out +=
          esc(src.slice(pos, Math.max(pos, s))) +
          `<mark>${esc(src.slice(Math.max(s, pos), e))}</mark>`
        pos = e
      }
      out += esc(src.slice(pos, end))
      return `${fs > 0 ? '…' : ''}${out}${end < src.length ? '…' : ''}`
    })
    .join(' ')
}

function cursorCond(rank: SQL, updatedAt: SQL, id: SQL, raw?: string): SQL | undefined {
  if (!raw) return undefined
  const c = decodeCursor(raw, 3)
  if (!c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  return sql`(round((${rank})::numeric, 6), ${updatedAt}, ${id}) < (${String(c[0])}::numeric, ${String(c[1])}::timestamptz, ${String(c[2])}::uuid)`
}

export async function search(
  db: DbOrTx,
  ctx: SearchCtx,
  q: z.infer<typeof searchQuery> & { recent?: string[] },
) {
  const types = new Set<string>(q.types ?? ['task', 'entry'])
  if (q.spaceId) {
    const sp = await loadSpaceRef(db, ctx.actor, q.spaceId)
    if (!sp || !can(ctx.actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在')
  }
  const text = q.q.trim()
  const terms = tokenize(text)
  // 规范原文「≤ 2 个字符只走子串」对中文不成立（两字即一个词，如「缓存」），改为 1 个字符或分不出词才只走子串（02 §4.1 注）
  const short = [...text].length <= 1 || !terms.length
  const like = `%${likeEsc(text)}%`
  const tsq = !short && terms.length ? sql`plainto_tsquery('simple', ${terms.join(' ')})` : null
  const recent = !text ? (q.recent ?? []) : []
  const days = (col: SQL) => sql`(extract(epoch from (now() - ${col})) / 86400.0)`
  const groups: { tasks?: Group; entries?: Group } = {}

  if (types.has('task')) {
    const upd = sql`${tasks.updatedAt}`
    const titleHit = sql`${tasks.title} ilike ${like}`
    const tagHit = sql`exists (select 1 from ${taskTags} tt join ${tags} tg on tg.id = tt.tag_id where tt.task_id = ${tasks.id} and tg.name ilike ${like})`
    const rank = tsq
      ? sql`(ts_rank_cd(coalesce(${tasks.tsv}, ''::tsvector), ${tsq}) + case when ${titleHit} then 0.1 else 0 end) / (1 + ${days(upd)} / 30)`
      : sql`(case when ${titleHit} then 0.5 else 0.2 end) / (1 + ${days(upd)} / 30)`
    const match = text
      ? tsq
        ? sql`(${tasks.tsv} @@ ${tsq} or ${titleHit} or ${tagHit})`
        : sql`(${titleHit} or ${tagHit})`
      : recent.length
        ? inArray(tasks.id, recent)
        : sql`false`
    const conds: SQL[] = [
      eq(tasks.workspaceId, ctx.workspaceId),
      visibleTasksWhere(ctx.actor),
      isNull(spaces.archivedAt),
      match,
    ]
    if (q.spaceId) conds.push(eq(tasks.spaceId, q.spaceId))
    if (q.status) conds.push(inArray(tasks.status, q.status))
    if (q.tag)
      conds.push(
        sql`exists (select 1 from ${taskTags} tt join ${tags} tg on tg.id = tt.tag_id where tt.task_id = ${tasks.id} and tg.name = ${q.tag})`,
      )
    const cc = cursorCond(rank, upd, sql`${tasks.id}`, q.cursorTasks)
    if (cc) conds.push(cc)
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        plain: tasks.descriptionPlain,
        status: tasks.status,
        updatedAt: tasks.updatedAt,
        slug: spaces.slug,
        score: sql<string>`round((${rank})::numeric, 6)`,
      })
      .from(tasks)
      .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
      .where(and(...conds))
      .orderBy(sql`round((${rank})::numeric, 6) desc`, sql`${upd} desc`, sql`${tasks.id} desc`)
      .limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    const last = page[page.length - 1]
    groups.tasks = {
      items: page.map((r) => ({
        type: 'task',
        id: r.id,
        title: r.title,
        highlight: highlight(r.plain || r.title, terms.length ? terms : [text]),
        spaceSlug: r.slug,
        status: r.status,
        updatedAt: r.updatedAt.toISOString(),
        score: Number(r.score),
      })),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor([last.score, last.updatedAt.toISOString(), last.id])
          : null,
    }
    if (recent.length)
      groups.tasks.items.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id))
  }

  if (types.has('entry')) {
    const upd = sql`${entries.updatedAt}`
    const titleHit = sql`${entries.title} ilike ${like}`
    const tagHit = sql`exists (select 1 from ${entryTags} et join ${tags} tg on tg.id = et.tag_id where et.entry_id = ${entries.id} and tg.name ilike ${like})`
    const pinned = sql`case when ${entries.pinned} then 0.2 else 0 end`
    const rank = tsq
      ? sql`(ts_rank_cd(coalesce(${entries.tsv}, ''::tsvector), ${tsq}) + case when ${titleHit} then 0.1 else 0 end) / (1 + ${days(upd)} / 30) + ${pinned}`
      : sql`(case when ${titleHit} then 0.5 else 0.2 end) / (1 + ${days(upd)} / 30) + ${pinned}`
    const match = text
      ? tsq
        ? sql`(${entries.tsv} @@ ${tsq} or ${titleHit} or ${tagHit})`
        : sql`(${titleHit} or ${tagHit})`
      : recent.length
        ? inArray(entries.id, recent)
        : sql`false`
    const conds: SQL[] = [
      eq(entries.workspaceId, ctx.workspaceId),
      visibleEntriesWhere(ctx.actor),
      isNull(entries.archivedAt),
      isNull(spaces.archivedAt),
      match,
    ]
    if (q.spaceId) conds.push(eq(entries.spaceId, q.spaceId))
    if (q.kind) conds.push(eq(entries.kind, q.kind))
    if (q.tag)
      conds.push(
        sql`exists (select 1 from ${entryTags} et join ${tags} tg on tg.id = et.tag_id where et.entry_id = ${entries.id} and tg.name = ${q.tag})`,
      )
    const cc = cursorCond(rank, upd, sql`${entries.id}`, q.cursorEntries)
    if (cc) conds.push(cc)
    const rows = await db
      .select({
        id: entries.id,
        title: entries.title,
        plain: sql<string>`left(${entries.plain}, 4000)`,
        kind: entries.kind,
        updatedAt: entries.updatedAt,
        slug: spaces.slug,
        score: sql<string>`round((${rank})::numeric, 6)`,
      })
      .from(entries)
      .innerJoin(spaces, eq(spaces.id, entries.spaceId))
      .where(and(...conds))
      .orderBy(sql`round((${rank})::numeric, 6) desc`, sql`${upd} desc`, sql`${entries.id} desc`)
      .limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    const last = page[page.length - 1]
    groups.entries = {
      items: page.map((r) => ({
        type: 'entry',
        id: r.id,
        title: r.title,
        highlight: highlight(r.plain || r.title, terms.length ? terms : [text]),
        spaceSlug: r.slug,
        kind: r.kind,
        updatedAt: r.updatedAt.toISOString(),
        score: Number(r.score),
      })),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor([last.score, last.updatedAt.toISOString(), last.id])
          : null,
    }
    if (recent.length)
      groups.entries.items.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id))
  }
  return { q: text, groups }
}

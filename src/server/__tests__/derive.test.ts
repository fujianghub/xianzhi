/** REQ-ENTRY-010：rebuild-derived 与实时派生逐字节相同；tokenize / wordCount。 */
import { eq, sql } from 'drizzle-orm'
import { v7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { deriveFromPm, deriveFromYdoc, emptyYdoc, YDOC_FRAGMENT } from '../../collab/derive.ts'
import { getDb } from '../db/index.ts'
import { entries, spaces, tasks } from '../db/schema/business.ts'
import { tokenize, wordCount } from '../lib/tokenize.ts'
import { rebuildEntries, rebuildTasks, writeEntryDerived } from '../services/derived.ts'
import { truncateAll } from './db.ts'
import { seedOwner } from './helpers.ts'

const db = () => getDb()

function docWith(paragraphs: string[]): Buffer {
  const doc = new Y.Doc({ gc: false })
  const frag = doc.getXmlFragment(YDOC_FRAGMENT)
  frag.insert(
    0,
    paragraphs.map((t) => {
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText(t)])
      return p
    }),
  )
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

describe('derive', () => {
  it('tokenize：jieba 精确模式、小写、去停用词与标点；索引与查询共用', () => {
    expect(tokenize('衔枝是一个个人工作台，Hello World!')).toEqual([
      '衔',
      '枝',
      '个人',
      '工作台',
      'hello',
      'world',
    ])
    expect(tokenize('')).toEqual([])
    expect(wordCount('你好 world 2026')).toBe(4)
  })

  it('deriveFromYdoc：空文档 → 空 pm_json / plain / 0 字；有内容 → 段落与占位', () => {
    const empty = deriveFromYdoc(emptyYdoc())
    expect(empty.pmJson).toEqual({ type: 'doc', content: [] })
    expect(empty.plain).toBe('')
    expect(empty.wordCount).toBe(0)
    const d = deriveFromYdoc(docWith(['第一段 hello', '第二段']))
    expect(d.plain).toBe('第一段 hello\n第二段')
    expect(d.wordCount).toBe(7)
    expect(d.tsvText).toBe('第一段 hello 第二段')
    expect(
      deriveFromPm({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '评论 body' }] }],
      }),
    ).toEqual({ plain: '评论 body', tsvText: '评论 body' })
  })

  describe('rebuild-derived', () => {
    let workspaceId = ''
    let userId = ''
    let spaceId = ''
    beforeAll(async () => {
      await truncateAll()
      const r = await seedOwner()
      workspaceId = r.workspaceId
      userId = r.userId
      const [ps] = await db().select().from(spaces).where(eq(spaces.isPersonal, true))
      spaceId = ps?.id ?? ''
    })

    it('REQ-ENTRY-010 10 篇记录：清空派生列后重建，pm_json / plain / tsv / word_count 与实时派生逐字节相同', async () => {
      const ids: string[] = []
      for (let i = 0; i < 10; i++) {
        const id = v7()
        ids.push(id)
        await db()
          .insert(entries)
          .values({
            id,
            workspaceId,
            spaceId,
            kind: 'note',
            title: `n${i}`,
            visibility: 'space',
            authorId: userId,
            ydoc: docWith([`记录 ${i} 的正文 hello world`, `第二段 ${i * 7}`]),
          })
        await writeEntryDerived(
          db(),
          id,
          docWith([`记录 ${i} 的正文 hello world`, `第二段 ${i * 7}`]),
        ) // 实时路径（onStoreDocument 同函数）
      }
      const snapshot = async () =>
        db()
          .select({
            id: entries.id,
            pm: sql<string>`${entries.pmJson}::text`,
            plain: entries.plain,
            tsv: sql<string>`${entries.tsv}::text`,
            wc: entries.wordCount,
          })
          .from(entries)
          .orderBy(entries.id)
      const before = await snapshot()
      expect(before.every((r) => r.tsv && r.pm && r.wc !== null)).toBe(true)
      await db().update(entries).set({
        pmJson: null,
        plain: null,
        tsv: null,
        wordCount: null,
        derivedAt: null,
        derivedError: 'x',
      })
      const cleared = await snapshot()
      expect(cleared.every((r) => r.tsv === null && r.pm === null)).toBe(true)
      const report = await rebuildEntries(db())
      expect(report).toEqual({ total: 10, ok: 10, failed: 0 })
      const after = await snapshot()
      expect(after).toEqual(before)
      const [e] = await db()
        .select({ err: entries.derivedError, at: entries.derivedAt })
        .from(entries)
        .limit(1)
      expect(e?.err).toBeNull()
      expect(e?.at).not.toBeNull()
    })

    it('rebuild --tasks：description_plain 与 tsv（含标题）', async () => {
      const id = v7()
      await db()
        .insert(tasks)
        .values({
          id,
          workspaceId,
          spaceId,
          title: '写周报',
          creatorId: userId,
          sortKey: 'a0',
          descriptionPm: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '包含数据图表' }] }],
          },
        })
      await rebuildTasks(db())
      const [t] = await db()
        .select({ plain: tasks.descriptionPlain, tsv: sql<string>`${tasks.tsv}::text` })
        .from(tasks)
        .where(eq(tasks.id, id))
      expect(t?.plain).toBe('包含数据图表')
      expect(t?.tsv).toContain("'周报'")
      expect(t?.tsv).toContain("'图表'")
    })
  })
})

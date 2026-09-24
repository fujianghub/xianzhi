/** ADR-0004 品牌更名数据迁移：ydoc / JSON 列里的 gi: 前缀改写为 xz:，幂等；outbox 触发器换名。 */
import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { YDOC_FRAGMENT } from '../../collab/derive.ts'
import { getDb } from '../db/index.ts'
import { migrateLegacyPrefix, rewriteYdoc } from '../services/rebrand.ts'
import { truncateAll } from './db.ts'

const docWith = () => {
  const d = new Y.Doc({ gc: false })
  const frag = d.getXmlFragment(YDOC_FRAGMENT)
  const img = new Y.XmlElement('image')
  img.setAttribute('src', 'gi:attachment/0192f000-0000-7000-8000-000000000001')
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, '链接', { link: { href: 'gi://entry/abc' } })
  t.insert(2, ' 普通')
  p.insert(0, [t])
  frag.insert(0, [img, p])
  return Y.encodeStateAsUpdate(d)
}

describe('ADR-0004 rebrand migration', () => {
  beforeAll(async () => {
    await truncateAll()
  })

  it('rewriteYdoc：图片 src 与 link href 的 gi: 前缀改为 xz:；已是新前缀时返回 null（幂等）', () => {
    const next = rewriteYdoc(docWith())
    expect(next).not.toBeNull()
    const d = new Y.Doc({ gc: false })
    Y.applyUpdate(d, next as Uint8Array)
    const frag = d.getXmlFragment(YDOC_FRAGMENT)
    expect((frag.get(0) as Y.XmlElement).getAttribute('src')).toBe(
      'xz:attachment/0192f000-0000-7000-8000-000000000001',
    )
    const delta = ((frag.get(1) as Y.XmlElement).get(0) as Y.XmlText).toDelta() as {
      insert: string
      attributes?: { link?: { href: string } }
    }[]
    expect(delta[0]?.attributes?.link?.href).toBe('xz://entry/abc')
    expect(delta[1]?.attributes).toBeUndefined()
    expect(rewriteYdoc(next as Uint8Array)).toBeNull()
  })

  it('migrateLegacyPrefix：旧 gi_events_notify 触发器换为 xz_*，再次执行无改动', async () => {
    const db = getDb()
    await db.execute(sql`CREATE OR REPLACE FUNCTION gi_events_notify() RETURNS trigger AS $$
BEGIN PERFORM pg_notify('gi_outbox', ''); RETURN NULL; END; $$ LANGUAGE plpgsql`)
    const first = await migrateLegacyPrefix(db)
    expect(first.outboxTrigger).toBe(true)
    const procs = (
      await db.execute(sql`select proname from pg_proc where proname like '%_events_notify'`)
    ).rows as { proname: string }[]
    expect(procs.map((p) => p.proname)).toEqual(['xz_events_notify'])
    const again = await migrateLegacyPrefix(db)
    expect(again).toEqual({ entries: 0, tasks: 0, comments: 0, workspace: 0, outboxTrigger: false })
  })
})

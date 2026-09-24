/** REQ-COMMENT-002 锚定评论 orphaned（派生层）：正文里 comment 标记消失 → orphaned；恢复 → 取消；非锚定线程不动。 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { appendPmJson } from '../../collab/ydoc-json.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { getDb } from '../db/index.ts'
import { comments } from '../db/schema/business.ts'
import { commentThreadIds, writeEntryDerived } from '../services/derived.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const ydocOf = (doc: PmNode) => {
  const y = new Y.Doc({ gc: false })
  appendPmJson(y.getXmlFragment('default'), doc)
  return Y.encodeStateAsUpdate(y)
}

describe('REQ-COMMENT-002 comment anchors', () => {
  let cookie = ''
  let app: ReturnType<typeof buildApp>['app']
  const req = (method: string, path: string, b?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie }),
      body: b === undefined ? undefined : JSON.stringify(b),
    })
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
  })

  it('commentThreadIds 收集所有 comment 标记', () => {
    const doc: PmNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect([...commentThreadIds(doc)]).toEqual(['t1'])
  })

  it('REQ-COMMENT-002 删除锚定文本后线程 orphaned（回复一并），恢复后取消；非锚定线程不受影响', async () => {
    const e = await req('POST', '/entries', { kind: 'note', title: '锚点' })
    const entryId = ((await e.json()) as { id: string }).id
    const threadId = randomUUID()
    const root = await req('POST', '/comments', {
      targetType: 'entry',
      targetId: entryId,
      threadId,
      bodyPm: body('锚定评论'),
    })
    expect(root.status, await root.clone().text()).toBe(201)
    const rootId = ((await root.json()) as { id: string }).id
    await req('POST', '/comments', {
      targetType: 'entry',
      targetId: entryId,
      threadId,
      parentId: rootId,
      bodyPm: body('回复'),
    })
    const plain = await req('POST', '/comments', {
      targetType: 'entry',
      targetId: entryId,
      bodyPm: body('整篇评论'),
    })
    const plainId = ((await plain.json()) as { id: string }).id
    const orphanedOf = async (id: string) =>
      (
        await getDb()
          .select({ o: comments.orphaned })
          .from(comments)
          .where(eq(comments.threadId, id))
      ).map((r) => r.o)

    const marked: PmNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '被评论的句子',
              marks: [{ type: 'comment', attrs: { threadId } }],
            },
          ],
        },
      ],
    }
    await writeEntryDerived(getDb(), entryId, ydocOf(marked))
    expect(await orphanedOf(threadId)).toEqual([false, false])
    await writeEntryDerived(getDb(), entryId, ydocOf(body('句子被删掉了') as PmNode))
    expect(await orphanedOf(threadId)).toEqual([true, true])
    expect(await orphanedOf(plainId)).toEqual([false])
    await writeEntryDerived(getDb(), entryId, ydocOf(marked))
    expect(await orphanedOf(threadId)).toEqual([false, false])
    // 列表接口带 orphaned（侧栏据此显示）
    const list = await req('GET', `/comments?targetType=entry&targetId=${entryId}`)
    const items = ((await list.json()) as { items: { threadId: string; orphaned: boolean }[] })
      .items
    expect(items.some((c) => c.threadId === threadId)).toBe(true)
  })
})

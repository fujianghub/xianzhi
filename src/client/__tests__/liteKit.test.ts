/** REQ-TASK-015 · REQ-COMMENT-004：liteKit schema 与服务端校验一致（无 table / mermaid；评论子集无 heading / callout / image）。 */
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { COMMENT_NODES, LITE_MARKS, LITE_NODES } from '../../shared/schemas/pm.ts'
import { liteKit } from '../editor/liteKit.ts'

const names = (variant: 'description' | 'comment') => {
  const s = getSchema(liteKit({ variant }))
  return { nodes: Object.keys(s.nodes), marks: Object.keys(s.marks) }
}

describe('liteKit', () => {
  it('REQ-TASK-015 描述 schema 无 table / mermaid / mathBlock，节点均在服务端 LITE_NODES 白名单内', () => {
    const { nodes, marks } = names('description')
    for (const n of ['table', 'mermaid', 'mathBlock', 'blockquote', 'horizontalRule'])
      expect(nodes).not.toContain(n)
    for (const n of nodes) expect(LITE_NODES as readonly string[], n).toContain(n)
    for (const m of marks) expect(LITE_MARKS as readonly string[], m).toContain(m)
    for (const n of [
      'heading',
      'taskList',
      'taskItem',
      'codeBlock',
      'image',
      'mention',
      'entryLink',
      'callout',
    ])
      expect(nodes).toContain(n)
  })
  it('REQ-COMMENT-004 评论子集无 heading / callout / image', () => {
    const { nodes } = names('comment')
    for (const n of ['heading', 'callout', 'image']) expect(nodes).not.toContain(n)
    for (const n of nodes) expect(COMMENT_NODES as readonly string[], n).toContain(n)
  })
})

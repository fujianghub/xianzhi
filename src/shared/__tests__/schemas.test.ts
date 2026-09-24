/** 其余共享 schema：recurrence、sort 白名单 / limit（02 §4）、liteKit 文档与派生、链接、周期目标、导出。 */
import { describe, expect, it } from 'vitest'
import { createCycleSchema, goalsSchema } from '../schemas/cycles.ts'
import { createEntrySchema, listEntriesQuery } from '../schemas/entries.ts'
import { createExportSchema } from '../schemas/exports.ts'
import { createLinkSchema } from '../schemas/links.ts'
import { commentDocSchema, liteDocSchema, pmMentionUserIds, pmToPlain } from '../schemas/pm.ts'
import { listSpacesQuery } from '../schemas/spaces.ts'
import { createTagSchema } from '../schemas/tags.ts'
import { batchTasksSchema, listTasksQuery, recurrenceSchema } from '../schemas/tasks.ts'

const U = '01920000-0000-7000-8000-000000000001'

describe('tasks', () => {
  it('REQ-TASK-011 recurrence：weekly 需 byWeekday，monthly 需 byMonthday，daily 不带', () => {
    expect(recurrenceSchema.safeParse({ freq: 'daily' }).success).toBe(true)
    expect(recurrenceSchema.safeParse({ freq: 'weekly', byWeekday: [1, 3] }).success).toBe(true)
    expect(
      recurrenceSchema.safeParse({ freq: 'monthly', byMonthday: 31, until: '2027-01-01' }).success,
    ).toBe(true)
    expect(recurrenceSchema.safeParse({ freq: 'weekly' }).success).toBe(false)
    expect(recurrenceSchema.safeParse({ freq: 'monthly' }).success).toBe(false)
    expect(recurrenceSchema.safeParse({ freq: 'daily', byWeekday: [1] }).success).toBe(false)
    expect(recurrenceSchema.safeParse({ freq: 'daily', interval: 0 }).success).toBe(false)
  })
  it('02 §4 sort 白名单：非法字段 422、`-` 降序；limit 超 200 失败、默认 50；status 逗号多值；assigneeId=me', () => {
    const ok = listTasksQuery.parse({
      sort: '-dueAt,title',
      status: 'todo,doing',
      assigneeId: 'me',
      deleted: '1',
    })
    expect(ok.sort).toEqual([
      { field: 'dueAt', dir: 'desc' },
      { field: 'title', dir: 'asc' },
    ])
    expect(ok.status).toEqual(['todo', 'doing'])
    expect(ok.assigneeId).toBe('me')
    expect(ok.deleted).toBe(true)
    expect(ok.limit).toBe(50)
    expect(listTasksQuery.safeParse({ sort: 'password' }).success).toBe(false)
    expect(listTasksQuery.safeParse({ limit: '201' }).success).toBe(false)
    expect(listTasksQuery.safeParse({ status: 'todo,nope' }).success).toBe(false)
    expect(listTasksQuery.parse({}).sort).toEqual([{ field: 'updatedAt', dir: 'desc' }])
  })
  it('REQ-TASK-016 batch ≤ 100 条且每条带 ifUpdatedAt', () => {
    const op = {
      op: 'update',
      id: U,
      patch: { title: 'x', ifUpdatedAt: '2026-09-23T00:00:00+08:00' },
    }
    expect(batchTasksSchema.safeParse({ ops: [op] }).success).toBe(true)
    expect(batchTasksSchema.safeParse({ ops: Array.from({ length: 101 }, () => op) }).success).toBe(
      false,
    )
    expect(
      batchTasksSchema.safeParse({ ops: [{ op: 'update', id: U, patch: { title: 'x' } }] }).success,
    ).toBe(false)
  })
})

describe('liteKit pm', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '你好 ', marks: [{ type: 'bold' }] },
          { type: 'mention', attrs: { id: 'u2', label: '小明' } },
          { type: 'hardBreak' },
          { type: 'entryLink', attrs: { id: U, title: '某记录' } },
        ],
      },
    ],
  }
  it('03 §7 liteKit 通过；评论子集拒绝 heading；表格 / 外域图片拒绝', () => {
    expect(liteDocSchema.safeParse(doc).success).toBe(true)
    expect(commentDocSchema.safeParse(doc).success).toBe(false)
    expect(liteDocSchema.safeParse({ type: 'doc', content: [{ type: 'table' }] }).success).toBe(
      false,
    )
    expect(
      liteDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://evil/x.png' } }],
      }).success,
    ).toBe(false)
    expect(
      liteDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: `xz:attachment/${U}` } }],
      }).success,
    ).toBe(true)
    expect(liteDocSchema.safeParse({ type: 'doc', content: [{ type: 'text' }] }).success).toBe(
      false,
    )
  })
  it('pmToPlain / pmMentionUserIds 派生', () => {
    expect(pmToPlain(doc)).toBe('标题\n你好 @小明\n某记录')
    expect(pmMentionUserIds(doc)).toEqual(['u2'])
  })
})

describe('others', () => {
  it('REQ-ENTRY-001 createEntry 缺省不带 visibility（service 按空间决定）、fields={}；bug 缺 severity 422 path fields.severity', () => {
    const ok = createEntrySchema.parse({ kind: 'note', title: '随笔' })
    expect(ok.visibility).toBeUndefined() // 个人空间 → private，其余 → space（REQ-ENTRY-003）
    expect(ok.fields).toEqual({})
    const r = createEntrySchema.safeParse({ kind: 'bug', title: 'x', fields: { status: 'open' } })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('fields.severity')
    expect(listEntriesQuery.safeParse({ sort: 'ydoc' }).success).toBe(false)
  })
  it('REQ-SPACE-001 listSpaces sort 白名单；REQ-TAG-001 颜色只能是 8 色', () => {
    expect(listSpacesQuery.parse({ sort: 'name' }).sort).toEqual([{ field: 'name', dir: 'asc' }])
    expect(listSpacesQuery.safeParse({ sort: 'slug' }).success).toBe(false)
    expect(createTagSchema.safeParse({ name: '重要', color: 'moss' }).success).toBe(true)
    expect(createTagSchema.safeParse({ name: '重要', color: '#ff0000' }).success).toBe(false)
  })
  it('REQ-LINK-003 external 需 URL 无 toId；mentions 不可手建', () => {
    expect(
      createLinkSchema.safeParse({
        fromType: 'entry',
        fromId: U,
        toType: 'external',
        externalUrl: 'https://github.com/x',
      }).success,
    ).toBe(true)
    expect(
      createLinkSchema.safeParse({ fromType: 'entry', fromId: U, toType: 'external' }).success,
    ).toBe(false)
    expect(
      createLinkSchema.safeParse({ fromType: 'entry', fromId: U, toType: 'task' }).success,
    ).toBe(false)
    expect(
      createLinkSchema.safeParse({
        fromType: 'entry',
        fromId: U,
        toType: 'task',
        toId: U,
        kind: 'mentions',
      }).success,
    ).toBe(false)
  })
  it('REQ-CYCLE-001 goals 结构；startDate 为日期', () => {
    expect(
      goalsSchema.safeParse([{ id: U, text: '读完一本书', done: false, taskIds: [U] }]).success,
    ).toBe(true)
    expect(goalsSchema.safeParse([{ id: U, text: '' }]).success).toBe(false)
    expect(createCycleSchema.safeParse({ kind: 'week', startDate: '2026-09-21' }).success).toBe(
      true,
    )
    expect(
      createCycleSchema.safeParse({ kind: 'week', startDate: '2026-09-21T00:00:00Z' }).success,
    ).toBe(false)
  })
  it('REQ-EXPORT-001 scope=space/entry 需 id', () => {
    expect(createExportSchema.safeParse({ scope: 'workspace' }).success).toBe(true)
    expect(createExportSchema.safeParse({ scope: 'entry' }).success).toBe(false)
    expect(createExportSchema.parse({ scope: 'space', id: U }).format).toBe('zip')
  })
})

/** ADR-0033 查询块与记录页筛选白名单（REQ-BUG-010，unit）。 */
import { describe, expect, it } from 'vitest'
import { fullPlain } from '../../collab/derive.ts'
import { pmToHtmlDocument } from '../editor/serializers/html.ts'
import { pmToMarkdown } from '../editor/serializers/markdown.ts'
import { toSource } from '../editor/source.ts'
import { parseEntryFilter, sanitizeEntryFilter, stringifyEntryFilter } from '../entry-search.ts'
import { bugFields } from '../schemas/entryFields.ts'
import { fullDocSchema, pmToPlain } from '../schemas/pm.ts'

const query = {
  type: 'entryQuery',
  attrs: {
    title: '未关闭 Bug',
    query: 'kind=bug&fields=status%3Dnew%7Cpending&sort=priority',
    view: 'table',
    limit: 20,
  },
}
const doc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '前' }] }, query],
}

describe('REQ-BUG-010 entryQuery', () => {
  it('REQ-BUG-010 筛选白名单：未知键 / 非法值丢弃，往返稳定；recent / select 不可持久化', () => {
    const f = sanitizeEntryFilter({
      kind: 'bug,nope',
      fields: 'status=new|pending',
      view: 'stats',
      group: 'priority',
      sort: 'priority',
      spaceId: 'not-a-uuid',
      recent: '1',
      select: '1',
      evil: '<script>',
    })
    expect(f).toEqual({
      fields: 'status=new|pending',
      view: 'stats',
      group: 'priority',
      sort: 'priority',
    })
    const s = stringifyEntryFilter({ kind: 'bug', fields: 'status=new|pending', sort: 'priority' })
    expect(parseEntryFilter(s)).toEqual({
      kind: 'bug',
      fields: 'status=new|pending',
      sort: 'priority',
    })
    expect(parseEntryFilter(`?${s}`)).toEqual(parseEntryFilter(s))
  })

  it('REQ-BUG-010 节点进全量正文白名单；纯文本只含标题；Markdown / HTML 导出为指向记录页的链接；源码对话框占位保留', () => {
    expect(fullDocSchema.safeParse(doc).success).toBe(true)
    expect(pmToPlain(doc as never)).toContain('未关闭 Bug')
    expect(fullPlain(doc as never)).toContain('未关闭 Bug')
    const md = pmToMarkdown(doc as never, { appUrl: 'https://xz.example/' })
    expect(md).toContain('> [查询：未关闭 Bug](https://xz.example/entries?kind=bug&fields=')
    expect(pmToMarkdown(doc as never)).toContain('](/entries?kind=bug')
    const html = pmToHtmlDocument('t', doc as never)
    expect(html).toContain('<a href="/entries?kind=bug')
    expect(html).toContain('查询：未关闭 Bug')
    expect(toSource(doc as never)).toContain('⟦xz-keep:1:entryQuery⟧')
  })

  it('REQ-BUG-001 bug fields：解决日期不得早于发现日期；module 不含分隔符；priority 可省略', () => {
    expect(bugFields.safeParse({ status: 'new', severity: 'low' }).success).toBe(true)
    expect(
      bugFields.safeParse({
        status: 'fixed',
        severity: 'low',
        foundAt: '2026-09-02',
        resolvedAt: '2026-09-01',
      }).success,
    ).toBe(false)
    expect(bugFields.safeParse({ status: 'new', severity: 'low', module: 'a|b' }).success).toBe(
      false,
    )
    expect(bugFields.safeParse({ status: 'open', severity: 'low' }).success).toBe(false)
  })
})

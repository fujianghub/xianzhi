/** ADR-0042：内置字段覆盖层的纯函数（REQ-ENTRY-034 · 035）。 */
import { describe, expect, it } from 'vitest'
import {
  baseFieldCatalog,
  defaultsSatisfy,
  fillHiddenDefaults,
  normalizeBaseFields,
  normalizeFieldOrder,
  sortByFieldOrder,
} from '../schemas/baseFields.ts'
import { entryFieldsSchema } from '../schemas/entryFields.ts'

describe('base field overrides', () => {
  it('REQ-ENTRY-034 目录由代码 schema 反射：Bug 的状态是选项字段、严重度必填、模块可选', () => {
    const cat = baseFieldCatalog('bug')
    expect(cat.find((f) => f.name === 'status')).toMatchObject({
      kind: 'select',
      options: ['new', 'pending', 'fixed', 'wontfix'],
      required: true,
    })
    expect(cat.find((f) => f.name === 'severity')?.required).toBe(true)
    expect(cat.find((f) => f.name === 'module')?.required).toBe(false)
    expect(cat.find((f) => f.name === 'foundAt')?.kind).toBe('date')
  })

  it('REQ-ENTRY-034 规范化：去掉空项与 hidden:false；默认值选项不能隐藏；显示名去重', () => {
    const r = normalizeBaseFields(
      'bug',
      {
        module: { hidden: false, label: '模块名' },
        commit: {},
        status: { options: { fixed: { label: '已解决' }, pending: {} } },
      },
      [],
    )
    expect(r.issues).toEqual([])
    expect(r.value).toEqual({
      module: { label: '模块名' },
      status: { options: { fixed: { label: '已解决' } } },
    })
    const d = normalizeBaseFields(
      'decision',
      { status: { options: { proposed: { hidden: true } } } },
      [],
    )
    expect(d.issues.map((i) => i.path)).toEqual(['baseFields.status.options.proposed'])
    const dup = normalizeBaseFields('bug', { module: { label: '模块' } }, [
      { key: 'xABCDEF', label: '模块', type: 'text' },
    ])
    expect(dup.issues.length).toBe(1)
  })

  it('REQ-ENTRY-035 隐藏必填：有默认值补默认，无默认值放宽为可选；跨字段检查照旧', () => {
    expect(fillHiddenDefaults('bug', { status: 'new' }, { severity: { hidden: true } })).toEqual({
      status: 'new',
      severity: 'medium',
    })
    const s = entryFieldsSchema('iteration', ['periodStart', 'periodEnd'])
    expect(s.safeParse({}).success).toBe(true)
    expect(s.safeParse({ periodStart: '2026-02-01', periodEnd: '2026-01-01' }).success).toBe(false)
    expect(s.safeParse({ nope: 1 }).success).toBe(false) // 仍 strict
    expect(entryFieldsSchema('iteration').safeParse({}).success).toBe(false)
    expect(defaultsSatisfy('iteration', {})).toBe(false)
    expect(
      defaultsSatisfy('iteration', { periodStart: { hidden: true }, periodEnd: { hidden: true } }),
    ).toBe(true)
  })

  it('REQ-ENTRY-034 顺序：只留该类型的键并去重；排序稳定，未列出的按原序排在后面', () => {
    expect(
      normalizeFieldOrder(
        'bug',
        ['module', 'x', 'module', 'xABCDEF'],
        [{ key: 'xABCDEF', label: 'a', type: 'text' }],
      ),
    ).toEqual(['module', 'xABCDEF'])
    expect(sortByFieldOrder(['a', 'b', 'c', 'd'], (k) => k, ['c', 'a'])).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })
})

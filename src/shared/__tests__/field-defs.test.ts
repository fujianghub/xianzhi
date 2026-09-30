import { describe, expect, it } from 'vitest'
import {
  extraValueError,
  type FieldDef,
  fieldDefSchema,
  fieldDefsSchema,
  isExtraFieldKey,
  newExtraFieldKey,
  splitExtraFields,
} from '../schemas/fieldDefs.ts'

const sel: FieldDef = {
  key: 'xABCDEF',
  label: '阶段',
  type: 'select',
  options: [
    { name: '设计', color: 'blue' },
    { name: '上线', color: 'green' },
  ],
}
const plain = (type: FieldDef['type']): FieldDef => ({ key: 'xAAAAAA', label: '值', type })

describe('字段定义', () => {
  it('REQ-ENTRY-027 键为 x + 6 位大写字母，与内置键不重名', () => {
    expect(isExtraFieldKey('xABCDEF')).toBe(true)
    for (const k of ['status', 'foundAt', 'xabcdef', 'xABCDE', 'x_ABCDEF'])
      expect(isExtraFieldKey(k)).toBe(false)
    expect(isExtraFieldKey(newExtraFieldKey(['xAAAAAA']))).toBe(true)
  })

  it('REQ-ENTRY-027 单选须有选项、非选择类不能有选项、选项 / 键 / 名不重复', () => {
    expect(fieldDefSchema.safeParse(sel).success).toBe(true)
    expect(fieldDefSchema.safeParse({ ...sel, options: [] }).success).toBe(false)
    expect(fieldDefSchema.safeParse({ ...plain('text'), options: sel.options }).success).toBe(false)
    expect(
      fieldDefSchema.safeParse({ ...sel, options: [sel.options?.[0], sel.options?.[0]] }).success,
    ).toBe(false)
    expect(
      fieldDefSchema.safeParse({ ...sel, options: [{ name: 'a,b', color: 'red' }] }).success,
    ).toBe(false)
    expect(fieldDefsSchema.safeParse([sel, { ...sel, key: 'xBBBBBB' }]).success).toBe(false)
  })

  it('REQ-ENTRY-027 值按类型校验', () => {
    expect(extraValueError(sel, '设计')).toBeNull()
    expect(extraValueError(sel, '不存在')).not.toBeNull()
    expect(extraValueError({ ...sel, type: 'multiselect' }, ['设计', '上线'])).toBeNull()
    expect(extraValueError({ ...sel, type: 'multiselect' }, ['设计', 'x'])).not.toBeNull()
    expect(extraValueError(plain('date'), '2026-09-30')).toBeNull()
    expect(extraValueError(plain('date'), '9/30')).not.toBeNull()
    expect(extraValueError(plain('progress'), 101)).not.toBeNull()
    expect(extraValueError(plain('url'), 'javascript:alert(1)')).not.toBeNull()
    expect(extraValueError(plain('url'), 'https://x.dev/a')).toBeNull()
    expect(extraValueError(plain('checkbox'), true)).toBeNull()
    expect(extraValueError(plain('number'), '3')).not.toBeNull()
  })

  it('REQ-ENTRY-027 拆分内置字段与自定义字段', () => {
    expect(splitExtraFields({ status: 'new', xABCDEF: '设计' })).toEqual({
      base: { status: 'new' },
      extra: { xABCDEF: '设计' },
    })
  })
})

/** ADR-0040：记录页筛选 / 分组里的模板属性（REQ-ENTRY-033）。 */
import { describe, expect, it } from 'vitest'
import type { FieldDef } from '../../shared/schemas/fieldDefs.ts'
import { type TemplateFieldSource, typeTemplateFields } from '../lib/template-fields.ts'

const sel = (key: string, label: string): FieldDef => ({
  key,
  label,
  type: 'select',
  options: [{ name: 'a', color: 'blue' }],
})
const tpl = (
  id: string,
  name: string | null,
  kind: string,
  fieldDefs: FieldDef[],
  typeId: string | null = null,
): TemplateFieldSource => ({ id, name, kind, typeId, fieldDefs })

describe('typeTemplateFields', () => {
  const metas = [
    tpl('t1', '读书笔记', 'note', [sel('xAAAAAA', '阶段'), sel('xBBBBBB', '来源')]),
    tpl('t2', '读书笔记 副本', 'note', [sel('xAAAAAA', '阶段')]), // 副本与原模板同键
    tpl('t3', '会议纪要', 'note', [sel('xCCCCCC', '阶段')]),
    tpl('t4', '缺陷登记', 'bug', [sel('xDDDDDD', '影响版本')]),
    tpl('t5', null, 'custom', [sel('xEEEEEE', '环境')], 'type-1'),
  ]

  it('REQ-ENTRY-033 只取绑该类型的模板的属性；同键去重；同名的标记 ambiguous 并带模板名', () => {
    const out = typeTemplateFields(metas, { kind: 'note', typeId: null }, [])
    expect(out.map((f) => [f.def.key, f.template, f.ambiguous])).toEqual([
      ['xAAAAAA', '读书笔记', true],
      ['xBBBBBB', '读书笔记', false],
      ['xCCCCCC', '会议纪要', true],
    ])
    expect(typeTemplateFields(metas, { kind: 'custom', typeId: 'type-1' }, [])).toMatchObject([
      { def: { key: 'xEEEEEE' }, template: null, ambiguous: false },
    ])
    expect(typeTemplateFields(metas, { kind: 'custom', typeId: 'type-2' }, [])).toEqual([])
  })

  it('REQ-ENTRY-033 与类型字段撞键的略去、同名的标记 ambiguous；正在用的键即使模板不绑该类型也保留', () => {
    const typeFields = [
      { name: 'xBBBBBB', label: '来源' },
      { name: 'status', label: '阶段' },
    ]
    const out = typeTemplateFields(metas, { kind: 'note', typeId: null }, typeFields, ['xDDDDDD'])
    expect(out.map((f) => [f.def.key, f.ambiguous])).toEqual([
      ['xAAAAAA', true],
      ['xCCCCCC', true],
      ['xDDDDDD', false],
    ])
  })
})

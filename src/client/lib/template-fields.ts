/**
 * 记录页筛选 / 分组里的模板属性（ADR-0040、REQ-ENTRY-033）：选中单一类型时，绑这个类型的模板的自有字段
 * 与类型字段并列，可用来筛选与分组。纯函数，不依赖 React（单测直接调）。
 */
import type { FieldDef } from '../../shared/schemas/fieldDefs.ts'

export interface TemplateFieldSource {
  id: string
  /** 模板名；读者读不到该模板（别人的个人模板）时为 null */
  name: string | null
  kind: string
  typeId: string | null
  fieldDefs: FieldDef[]
}

export interface TypeTemplateField {
  def: FieldDef
  /** 所属模板名（同键出现在多个模板时取第一个） */
  template: string | null
  /** 与类型字段或别的模板属性同名：界面上要带模板名区分 */
  ambiguous: boolean
}

/**
 * 某类型下可供筛选 / 分组的模板属性：
 * - 来源 = 绑该类型的模板（`kind` + `typeId` 一致）；
 * - `keep` = 正在用的键（当前筛选 / 分组）：即使它所属的模板不绑这个类型也保留，免得选项凭空消失；
 * - 同键只留一个（「复制到我的」的副本与原模板同键）；与类型字段撞键的略去（以类型的为准）。
 */
export function typeTemplateFields(
  metas: readonly TemplateFieldSource[],
  type: { kind: string; typeId: string | null },
  typeFields: readonly { name: string; label: string }[],
  keep: readonly string[] = [],
): TypeTemplateField[] {
  const typeKeys = new Set(typeFields.map((f) => f.name))
  const seen = new Set<string>()
  const out: { def: FieldDef; template: string | null }[] = []
  const take = (m: TemplateFieldSource, d: FieldDef) => {
    if (typeKeys.has(d.key) || seen.has(d.key)) return
    seen.add(d.key)
    out.push({ def: d, template: m.name })
  }
  for (const m of metas)
    if (m.kind === type.kind && (m.typeId ?? null) === (type.typeId ?? null))
      for (const d of m.fieldDefs) take(m, d)
  for (const m of metas) for (const d of m.fieldDefs) if (keep.includes(d.key)) take(m, d)
  const count = new Map<string, number>()
  for (const l of [...typeFields.map((f) => f.label), ...out.map((o) => o.def.label)])
    count.set(l, (count.get(l) ?? 0) + 1)
  return out.map((o) => ({ ...o, ambiguous: (count.get(o.def.label) ?? 0) > 1 }))
}

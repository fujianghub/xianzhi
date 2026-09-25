/** 记录模板查询（ADR-0011 §2、02 §9 /templates）：内置 + 个人 + 工作区。写入后失效 ['templates']。 */
import type { QueryClient } from '@tanstack/react-query'
import type { TemplateView } from '../../server/services/templates.ts'
import type { SpaceKind } from '../../shared/schemas/enums.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { api, unwrap } from './api.ts'

export type Template = TemplateView
export type TemplateDetail = TemplateView & { body: PmNode }

export const templatesQuery = {
  queryKey: ['templates'] as const,
  queryFn: () =>
    unwrap<{ items: Template[] }>(api.templates.$get({ query: {} })).then((r) => r.items),
  staleTime: 60_000,
}

export const templateQuery = (id: string) => ({
  queryKey: ['templates', id] as const,
  queryFn: () => unwrap<TemplateDetail>(api.templates[':id'].$get({ param: { id } })),
  staleTime: 60_000,
})

export const invalidateTemplates = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ['templates'] })

/** 排序：当前空间类型推荐的在前 → 内置在前 → 其余按原序。 */
export function sortTemplates(items: Template[], spaceKind?: SpaceKind): Template[] {
  const score = (t: Template) =>
    (spaceKind && t.spaceKinds.includes(spaceKind) ? 0 : 2) + (t.source === 'builtin' ? 0 : 1)
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => score(a.t) - score(b.t) || a.i - b.i)
    .map((x) => x.t)
}

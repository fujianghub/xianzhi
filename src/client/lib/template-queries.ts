/** 记录模板查询（ADR-0011 §2 · ADR-0023、02 §9 /templates）：内置 + 个人 + 工作区共享。写入后失效 ['templates']。 */
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { TemplateView } from '../../server/services/templates.ts'
import type { BuiltinEntryKind, SpaceKind, TemplateScope } from '../../shared/schemas/enums.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { ApiError, api, unwrap } from './api.ts'
import { newId } from './uuid.ts'

export type Template = TemplateView
export type TemplateDetail = TemplateView & { body: PmNode }

export interface TemplateList {
  items: Template[]
  /** 当前用户能否共享到工作区（服务端 can() 判定，ADR-0023；前端不比较角色） */
  canShare: boolean
}

/** 完整列表（含 canShare）；`templatesQuery` 与它共用缓存，只取 items。 */
export const templateListQuery = {
  queryKey: ['templates'] as const,
  queryFn: () => unwrap<TemplateList>(api.templates.$get({ query: {} })),
  staleTime: 60_000,
}

export const templatesQuery = {
  ...templateListQuery,
  select: (r: TemplateList) => r.items,
}

export const templateQuery = (id: string) => ({
  queryKey: ['templates', id] as const,
  queryFn: () => unwrap<TemplateDetail>(api.templates[':id'].$get({ param: { id } })),
  staleTime: 60_000,
})

export const invalidateTemplates = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ['templates'] })

/** 失效模板与空间（取消共享 / 删除会清掉引用它的空间默认模板，REQ-TPL-009）。 */
export const invalidateTemplatesAndSpaces = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['templates'] }),
    qc.invalidateQueries({ queryKey: ['spaces'] }),
  ])

/** search param `?preview=` 的模板 id：内置 `builtin:<key>` 或 uuid；非法丢弃。 */
export const optTemplateId = (v: unknown): string | undefined =>
  typeof v === 'string' &&
  (/^builtin:[a-z][a-z-]{1,40}$/.test(v) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
    ? v
    : undefined

export interface TemplatePatch {
  name?: string
  description?: string
  scope?: TemplateScope
  spaceKind?: SpaceKind | null
  kind?: BuiltinEntryKind
  body?: PmNode
}

/** PATCH 带乐观锁（ADR-0023）：ifUpdatedAt 取自列表 / 详情里的 updatedAt。 */
export const patchTemplate = (tpl: Pick<Template, 'id' | 'updatedAt'>, patch: TemplatePatch) =>
  unwrap<Template>(
    api.templates[':id'].$patch({
      param: { id: tpl.id },
      // body 是编辑器导出的 doc 节点（type 恒为 'doc'）；PmNode 的 type 是宽 string
      json: {
        ...patch,
        body: patch.body as { type: 'doc'; content?: unknown[] } | undefined,
        ifUpdatedAt: tpl.updatedAt ?? '',
      },
    }),
  )

/** 复制到我的（REQ-TPL-008）：内置或可见模板 → 个人模板。 */
export const copyTemplate = (id: string, name: string) =>
  unwrap<Template>(
    api.templates.$post(
      { json: { name, fromTemplateId: id, scope: 'personal', description: '' } },
      { headers: { 'idempotency-key': newId() } },
    ),
  )

/** 409 CONFLICT_STALE → 提示并刷新；其余通用失败提示。 */
export const templateSaveError = (qc: QueryClient, t: (k: string) => string) => (err: unknown) => {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE') {
    toast.error(t('template.stale'))
    void invalidateTemplates(qc)
  } else toast.error(t('task.saveFailed'))
}

/** 排序：当前空间类型推荐的在前 → 内置在前 → 其余按原序。 */
export function sortTemplates(items: Template[], spaceKind?: SpaceKind): Template[] {
  const score = (t: Template) =>
    (spaceKind && t.spaceKinds.includes(spaceKind) ? 0 : 2) + (t.source === 'builtin' ? 0 : 1)
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => score(a.t) - score(b.t) || a.i - b.i)
    .map((x) => x.t)
}

import { z } from 'zod'
import { isoDateTime, uuidSchema } from './common.ts'
import {
  BUILTIN_ENTRY_KINDS,
  type BuiltinEntryKind,
  PALETTE_COLORS,
  SPACE_KINDS,
  SPACE_ROLES,
  SPACE_VISIBILITIES,
  type SpaceKind,
} from './enums.ts'
import { bool01, pageParams, sortParam } from './query.ts'
import { templateIdSchema } from './templates.ts'

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, '只允许小写字母、数字与中划线')

/**
 * 空间图标（REQ-SPACE-008、01 §3.1）：单个 emoji（一个字素，含 ZWJ 组合 / 肤色 / 旗帜）或 Lucide 图标名（kebab-case）。
 * Lucide 只校验名字形态，不枚举全集（避免服务端打包图标清单）；前端选择器只提供真实存在的名字。
 */
const EMOJI_RE =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3)*$/u
const LUCIDE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const spaceIconSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => EMOJI_RE.test(v) || LUCIDE_RE.test(v), '图标须为单个 emoji 或 Lucide 图标名')

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: slugSchema.optional(),
  kind: z.enum(SPACE_KINDS),
  icon: spaceIconSchema.nullable().optional(),
  color: z.enum(PALETTE_COLORS).nullable().optional(),
  visibility: z.enum(SPACE_VISIBILITIES).default('workspace'),
  description: z.string().trim().max(500).nullable().optional(),
  /** 所属大类（ADR-0012）；缺省 / null = 未分类 */
  groupId: uuidSchema.nullable().optional(),
})
/** 启用清单的一项：内置 kind 名或 `type:<uuid>` */
export const enabledKindItem = z.union([
  z.enum(BUILTIN_ENTRY_KINDS),
  z.string().regex(/^type:[0-9a-f-]{36}$/, '类型项无效'),
])

/**
 * 启用清单为 null 时按空间种类推导的默认（ADR-0036、REQ-KB-014；不做数据迁移，与原空间首页版块一致）。
 * 个人空间：全部内置类型（本人的个人类型由前端追加）。
 */
export const DEFAULT_ENABLED_KINDS: Record<SpaceKind, readonly BuiltinEntryKind[]> = {
  project: ['bug', 'iteration', 'changelog', 'decision', 'optimize', 'note'],
  work: ['bug', 'iteration', 'changelog', 'decision', 'optimize', 'note'],
  learning: ['plan', 'note', 'journal', 'review'],
}
export function resolveEnabledKinds(opts: {
  raw: readonly string[] | null
  spaceKind: string
  isPersonal: boolean
  /** 本空间的空间类型 id（null 清单时全部启用） */
  spaceTypeIds: readonly string[]
  /** 可用的类型 id（悬空的 `type:` 项被去掉）；不给 = 不过滤 */
  knownTypeIds?: readonly string[]
  /** 已删除的内置类型 */
  deletedKinds?: readonly string[]
}): string[] {
  const base = opts.raw
    ? [...opts.raw]
    : [
        ...(opts.isPersonal
          ? BUILTIN_ENTRY_KINDS
          : (DEFAULT_ENABLED_KINDS[opts.spaceKind as SpaceKind] ?? DEFAULT_ENABLED_KINDS.project)),
        ...opts.spaceTypeIds.map((id) => `type:${id}`),
      ]
  const known = opts.knownTypeIds ? new Set(opts.knownTypeIds) : null
  const deleted = new Set(opts.deletedKinds ?? [])
  return [...new Set(base)].filter((k) =>
    k.startsWith('type:') ? !known || known.has(k.slice(5)) : !deleted.has(k),
  )
}
export const patchSpaceSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    /** ADR-0012：类型决定空间首页形态，建好后可改 */
    kind: z.enum(SPACE_KINDS).optional(),
    groupId: uuidSchema.nullable().optional(),
    icon: spaceIconSchema.nullable().optional(),
    color: z.enum(PALETTE_COLORS).nullable().optional(),
    visibility: z.enum(SPACE_VISIBILITIES).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /** ADR-0019：在此空间新建记录的默认类型（内置）与默认模板（内置 / 工作区模板） */
    defaultKind: z.enum(BUILTIN_ENTRY_KINDS).nullable().optional(),
    defaultTemplateId: templateIdSchema.nullable().optional(),
    /** ADR-0036：默认类型为本空间的空间类型（与 defaultKind 互斥：给了一个，另一个清空） */
    defaultTypeId: uuidSchema.nullable().optional(),
    /** ADR-0036、REQ-KB-014：启用类型清单（有序）；null = 恢复按空间种类推导的默认 */
    enabledKinds: z.array(enabledKindItem).max(40).nullable().optional(),
    ifUpdatedAt: isoDateTime,
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少一个字段', path: ['name'] })

export const SPACE_SORT = ['sortKey', 'name', 'createdAt'] as const
export const listSpacesQuery = pageParams.extend({
  archived: bool01,
  deleted: bool01,
  sort: sortParam(SPACE_SORT, { field: 'sortKey', dir: 'asc' }),
})
/**
 * `after` = 放在哪个空间之后；null = 放到最前（REQ-SPACE-005，只改被拖项一行）。
 * `groupId`（ADR-0012）：同时移入该大类（null = 未分类）；省略 = 不改大类。
 */
export const reorderSpaceSchema = z.object({
  id: uuidSchema,
  after: uuidSchema.nullable(),
  groupId: uuidSchema.nullable().optional(),
})
export const addSpaceMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(SPACE_ROLES).default('member'),
})
export const patchSpaceMemberSchema = z.object({ role: z.enum(SPACE_ROLES) })

/** GET /spaces/:idOrSlug：UUID 按 id 查，否则按 slug（前端路由是 `/spaces/$spaceSlug`）。 */
export const spaceKeyParam = z.object({ id: z.string().trim().min(1).max(64) })
export const spaceMemberParam = z.object({
  id: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64),
})

/**
 * POST /spaces/batch（ADR-0021、REQ-SPACE-010 ~ 012）：≤ 100 个，逐个鉴权，单个失败不影响其它。
 * archive / unarchive / move（groupId null = 未分类）/ delete（软删）/ restore（回收站恢复）/ purge（彻底删除，只接受回收站里的）。
 * `dryRun`：只鉴权并统计将受影响的记录 / 任务数，不写库（删除确认弹层用）。
 */
const spaceBatchIds = z.array(uuidSchema).min(1).max(100)
const dryRun = z.boolean().optional()
export const batchSpacesSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('archive'), ids: spaceBatchIds, dryRun }),
  z.object({ op: z.literal('unarchive'), ids: spaceBatchIds, dryRun }),
  z.object({ op: z.literal('move'), ids: spaceBatchIds, groupId: uuidSchema.nullable(), dryRun }),
  z.object({ op: z.literal('delete'), ids: spaceBatchIds, dryRun }),
  z.object({ op: z.literal('restore'), ids: spaceBatchIds, dryRun }),
  z.object({ op: z.literal('purge'), ids: spaceBatchIds, dryRun }),
])

/**
 * POST /spaces/:id/merge（ADR-0022、REQ-SPACE-013 ~ 015）：把本空间（源）整体并入 `into`（目标）。
 * `dryRun`：只校验并返回将搬移的记录 / 任务数、将并入的成员数、是否扩大可见范围，不写库（确认弹层用）。
 */
export const mergeSpaceSchema = z.object({ into: uuidSchema, dryRun: z.boolean().optional() })

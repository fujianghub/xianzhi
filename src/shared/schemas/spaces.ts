import { z } from 'zod'
import { isoDateTime, uuidSchema } from './common.ts'
import { PALETTE_COLORS, SPACE_KINDS, SPACE_ROLES, SPACE_VISIBILITIES } from './enums.ts'
import { bool01, pageParams, sortParam } from './query.ts'

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
  /** 所属大类（ADR-0012）；缺省 / null = 其他（未归入大类） */
  groupId: uuidSchema.nullable().optional(),
})
export const patchSpaceSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    /** ADR-0012：类型决定分类首页形态，建好后可改 */
    kind: z.enum(SPACE_KINDS).optional(),
    groupId: uuidSchema.nullable().optional(),
    icon: spaceIconSchema.nullable().optional(),
    color: z.enum(PALETTE_COLORS).nullable().optional(),
    visibility: z.enum(SPACE_VISIBILITIES).optional(),
    description: z.string().trim().max(500).nullable().optional(),
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
 * `groupId`（ADR-0012）：同时移入该大类（null = 其他（未归入大类））；省略 = 不改大类。
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

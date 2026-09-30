/**
 * 记录类型（ADR-0016）：内置 9 种 + 工作区自定义类型。`GET /entry-types` 一次取回（数量级几十，不分页）。
 * 显示统一走 `useKindLabel`（KindIcon / KindBadge 内部也用它）：自定义类型取其名 / 色，内置类型取 i18n 与固定色。
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { EntryTypesList, EntryTypeView } from '../../server/services/entry-types.ts'
import type { PaletteColor } from '../../shared/schemas/enums.ts'
import type { FieldDef } from '../../shared/schemas/fieldDefs.ts'
import { resolveEnabledKinds } from '../../shared/schemas/spaces.ts'
import { api, unwrap } from './api.ts'
import { ENTRY_KINDS, type EntryKind } from './entry-queries.ts'
import type { Space } from './space-queries.ts'

export type EntryType = EntryTypeView
export type { EntryTypesList }

export const entryTypesQuery = {
  queryKey: ['entry-types'] as const,
  queryFn: () => unwrap<EntryTypesList>(api['entry-types'].$get()),
  staleTime: 60_000,
}

/** 内置类型固定色（04 §2.1 色板；KindIcon 复用） */
export const ENTRY_KIND_TONE: Record<string, PaletteColor> = {
  decision: 'blue',
  iteration: 'cyan',
  bug: 'red',
  changelog: 'orange',
  journal: 'green',
  note: 'yellow',
  review: 'purple',
  optimize: 'pink',
  plan: 'gray',
}

export interface KindMeta {
  kind: EntryKind
  typeId: string | null
  label: string
  tone: PaletteColor
  /** 自定义类型的状态列表；内置类型为 null（状态取自 fields schema） */
  statuses: string[] | null
  /** 状态颜色（自定义类型，ADR-0036）：状态名 → 色板色；未设按位置轮换 */
  statusColors: Record<string, string> | null
  /** 自定义字段定义（自定义 / 空间类型的属性，或内置类型追加的属性，ADR-0036） */
  fieldDefs: FieldDef[]
}

type WithDefs = { fieldDefs?: FieldDef[]; statusColors?: Record<string, string> }

/** (kind, typeId) → 名 / 色；内置类型取工作区改过的名 / 色（ADR-0017），否则 i18n 名与固定色；自定义类型已删或未加载时退回「自定义」灰色。 */
export function useKindLabel() {
  const { t } = useTranslation()
  const { data } = useQuery(entryTypesQuery)
  return useCallback(
    (kind: string, typeId?: string | null): KindMeta => {
      if (kind === 'custom') {
        const ty = data?.items.find((x) => x.id === typeId)
        return {
          kind: 'custom',
          typeId: typeId ?? null,
          label: ty?.name ?? t('entry.kind.custom'),
          tone: (ty?.color ?? 'gray') as PaletteColor,
          statuses: ty?.statuses ?? [],
          statusColors: (ty as WithDefs | undefined)?.statusColors ?? null,
          fieldDefs: (ty as WithDefs | undefined)?.fieldDefs ?? [],
        }
      }
      const ov = data?.builtin.find((b) => b.kind === kind)
      return {
        kind: kind as EntryKind,
        typeId: null,
        label: ov?.name ?? t(`entry.kind.${kind}`),
        tone: (ov?.color as PaletteColor | null) ?? ENTRY_KIND_TONE[kind] ?? 'gray',
        statuses: null,
        statusColors: null,
        fieldDefs: (ov as WithDefs | undefined)?.fieldDefs ?? [],
      }
    },
    [data, t],
  )
}

/** 空间的启用类型（ADR-0036、REQ-KB-014）所需字段 */
export type SpaceForKinds = Pick<Space, 'id' | 'kind' | 'isPersonal' | 'enabledKindsRaw'>

/**
 * 空间启用的类型项（`bug` / `type:<id>`），按清单顺序：null 清单 = 按空间种类推导 + 本空间全部空间类型
 * （个人空间另加本人的个人类型）；悬空项与已删除的内置类型去掉。与服务端 `resolveEnabledKinds` 同一规则。
 */
export function useEnabledKinds(space: SpaceForKinds | null | undefined): string[] | null {
  const { data } = useQuery(entryTypesQuery)
  if (!space) return null
  const items = data?.items ?? []
  const personal = space.isPersonal ? items.filter((ty) => ty.mine).map((ty) => ty.id) : []
  return resolveEnabledKinds({
    raw: space.enabledKindsRaw,
    spaceKind: space.kind,
    isPersonal: space.isPersonal,
    spaceTypeIds: [
      ...items.filter((ty) => ty.spaceId === space.id).map((ty) => ty.id),
      ...personal,
    ],
    knownTypeIds: data ? items.map((ty) => ty.id) : undefined,
    deletedKinds: data?.builtin.filter((b) => b.deleted).map((b) => b.kind),
  })
}

/**
 * 可选类型（新建 / 改类型 / 批量改类型 / 筛选条）：
 * - 给了空间：按该空间启用清单的顺序，自定义类型只留本人能在该空间用的（本人个人类型或本空间的空间类型）；
 *   `keep` = 当前值（记录现有类型即使未启用也保留在选项里）。
 * - 未给空间：未删除的内置 + 本人个人类型 + 本人可用的空间类型（`all` 时列出全部可见类型，筛选用）。
 */
export function useKindOptions(
  space?: SpaceForKinds | null,
  opts: {
    keep?: { kind: string; typeId: string | null } | null
    all?: boolean
    /** 空间内是否在启用类型后追加本人的个人类型（个人类型在任何空间都可用，ADR-0017）；筛选条传 false */
    personal?: boolean
  } = {},
): KindMeta[] {
  const meta = useKindLabel()
  const { data } = useQuery(entryTypesQuery)
  const enabled = useEnabledKinds(space)
  const deleted = new Set(data?.builtin.filter((b) => b.deleted).map((b) => b.kind) ?? [])
  const items = data?.items ?? []
  let out: KindMeta[]
  if (space && enabled) {
    const usable = (id: string) => {
      const ty = items.find((x) => x.id === id)
      return !!ty && (ty.spaceId ? ty.spaceId === space.id && ty.usable : ty.mine)
    }
    out = enabled.flatMap((k) =>
      k.startsWith('type:') ? (usable(k.slice(5)) ? [meta('custom', k.slice(5))] : []) : [meta(k)],
    )
    if (opts.personal !== false)
      for (const ty of items)
        if (ty.mine && !out.some((o) => o.typeId === ty.id)) out.push(meta('custom', ty.id))
  } else {
    out = [
      ...ENTRY_KINDS.filter((k) => !deleted.has(k)).map((k) => meta(k)),
      ...items.filter((ty) => (opts.all ? true : ty.usable)).map((ty) => meta('custom', ty.id)),
    ]
  }
  const keep = opts.keep
  if (keep && !out.some((o) => kindKey(o) === kindKey(keep)))
    out = [...out, meta(keep.kind, keep.typeId)]
  return out
}

/** 启用清单项 → 类型选项的键（kindKey 口径） */
export const enabledItemKey = (item: string) => (item.startsWith('type:') ? item.slice(5) : item)

/** 类型选项的稳定键：内置 = kind，自定义 = typeId */
export const kindKey = (m: { kind: string; typeId: string | null }) =>
  m.kind === 'custom' && m.typeId ? m.typeId : m.kind

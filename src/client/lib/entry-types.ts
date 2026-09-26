/**
 * 记录类型（ADR-0016）：内置 9 种 + 工作区自定义类型。`GET /entry-types` 一次取回（数量级几十，不分页）。
 * 显示统一走 `useKindLabel`（KindIcon / KindBadge 内部也用它）：自定义类型取其名 / 色，内置类型取 i18n 与固定色。
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { EntryTypesList, EntryTypeView } from '../../server/services/entry-types.ts'
import type { PaletteColor } from '../../shared/schemas/enums.ts'
import { api, unwrap } from './api.ts'
import { ENTRY_KINDS, type EntryKind } from './entry-queries.ts'

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
}

/** (kind, typeId) → 名 / 色；自定义类型已删或未加载时退回「自定义」灰色。 */
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
        }
      }
      return {
        kind: kind as EntryKind,
        typeId: null,
        label: t(`entry.kind.${kind}`),
        tone: ENTRY_KIND_TONE[kind] ?? 'gray',
        statuses: null,
      }
    },
    [data, t],
  )
}

/** 可选类型（筛选条 / 新建 / 批量改类型）：未隐藏的内置 + 全部自定义。`includeHidden` 用于管理页。 */
export function useKindOptions(opts: { includeHidden?: boolean } = {}): KindMeta[] {
  const meta = useKindLabel()
  const { data } = useQuery(entryTypesQuery)
  const hidden = new Set(data?.builtin.filter((b) => b.hidden).map((b) => b.kind) ?? [])
  return [
    ...ENTRY_KINDS.filter((k) => opts.includeHidden || !hidden.has(k)).map((k) => meta(k)),
    ...(data?.items ?? []).map((ty) => meta('custom', ty.id)),
  ]
}

/** 类型选项的稳定键：内置 = kind，自定义 = typeId */
export const kindKey = (m: { kind: string; typeId: string | null }) =>
  m.kind === 'custom' && m.typeId ? m.typeId : m.kind

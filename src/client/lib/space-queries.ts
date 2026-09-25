/**
 * 空间查询定义（无 React 依赖）：路由 loader 在主 chunk 里，只能引用这里，
 * 否则会把 useMutation 等 hook 连带拉进登录页首屏（REQ-UI-015，debug/2026-09-24-lighthouse-first-paint）。
 */
import type { SpaceGroupView } from '../../server/services/space-groups.ts'
import type { SpaceView } from '../../server/services/spaces.ts'
import { api, unwrap } from './api.ts'

export type Space = SpaceView
export type SpaceGroup = SpaceGroupView
export type SpaceKind = 'project' | 'learning' | 'work'
export type SpaceVisibility = 'workspace' | 'members'

export const spacesKey = (archived: boolean) => ['spaces', { archived }] as const

export const spacesQuery = (archived = false) => ({
  queryKey: spacesKey(archived),
  queryFn: () =>
    unwrap<{ items: Space[] }>(
      api.spaces.$get({ query: archived ? { archived: '1', limit: '200' } : { limit: '200' } }),
    ).then((r) => r.items),
  staleTime: 30_000,
})

export const spaceQuery = (key: string) => ({
  queryKey: ['space', key] as const,
  queryFn: () => unwrap<Space>(api.spaces[':id'].$get({ param: { id: key } })),
  staleTime: 30_000,
})

/** 大类（ADR-0012）：工作区共享，全员可读。 */
export const spaceGroupsQuery = {
  queryKey: ['space-groups'] as const,
  queryFn: () => unwrap<{ items: SpaceGroup[] }>(api['space-groups'].$get()).then((r) => r.items),
  staleTime: 60_000,
}

export interface SpaceSection {
  /** null = 其他（未归入大类） */
  group: SpaceGroup | null
  items: Space[]
}

/**
 * 按大类分区（ADR-0012、REQ-KB-002）：大类按 sort_key；区内沿用空间 sort_key 顺序；个人空间不参与；
 * 「其他」只在有内容时放最后；空大类也返回（侧栏可折叠 / 可拖入，列表页「在此新建」）。
 */
export function groupSpaces(
  spaces: readonly Space[],
  groups: readonly SpaceGroup[],
): SpaceSection[] {
  const known = new Set(groups.map((g) => g.id))
  const rest = spaces.filter((s) => !s.isPersonal)
  const sections: SpaceSection[] = groups.map((g) => ({
    group: g,
    items: rest.filter((s) => s.groupId === g.id),
  }))
  const none = rest.filter((s) => !s.groupId || !known.has(s.groupId))
  if (none.length) sections.push({ group: null, items: none })
  return sections
}

export const sectionDropId = (g: SpaceGroup | null) => `group:${g?.id ?? 'none'}`

/**
 * 侧栏拖放 → 服务端参数（纯函数）：`overId` 为空间 id 或分区头 `group:<id|none>`。
 * 同区内与 moveAfter 一致；跨区时放到目标项之后，拖到分区头则放到该区最前。
 * 返回 `groupId`（仅跨区时给出；null = 其他（未归入大类））、`after` 与拖后的扁平顺序（乐观更新用）。
 */
export function planSpaceMove(
  sections: readonly SpaceSection[],
  activeId: string,
  overId: string,
): { after: string | null; groupId?: string | null; order: string[] } | null {
  const from = sections.findIndex((s) => s.items.some((x) => x.id === activeId))
  if (from < 0 || activeId === overId) return null
  const to = overId.startsWith('group:')
    ? sections.findIndex((s) => sectionDropId(s.group) === overId)
    : sections.findIndex((s) => s.items.some((x) => x.id === overId))
  if (to < 0) return null
  const ids = sections.map((s) => s.items.map((x) => x.id))
  const target = [...(ids[to] ?? [])].filter((id) => id !== activeId)
  // 拖到分区头 → 该区最前；同区 → 落到 over 的原位置（与 moveAfter 一致）；跨区 → over 之后
  const at = overId.startsWith('group:')
    ? 0
    : from === to
      ? (ids[from] ?? []).indexOf(overId)
      : target.indexOf(overId) + 1
  target.splice(at, 0, activeId)
  if (from === to && !overId.startsWith('group:') && target.join() === (ids[from] ?? []).join())
    return null
  const next = ids.map((l, i) =>
    i === to ? target : i === from ? l.filter((id) => id !== activeId) : l,
  )
  const pos = target.indexOf(activeId)
  const crossed = from !== to
  return {
    after: pos === 0 ? null : (target[pos - 1] ?? null),
    ...(crossed ? { groupId: sections[to]?.group?.id ?? null } : {}),
    order: next.flat(),
  }
}

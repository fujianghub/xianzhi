/**
 * 空间查询定义（无 React 依赖）：路由 loader 在主 chunk 里，只能引用这里，
 * 否则会把 useMutation 等 hook 连带拉进登录页首屏（REQ-UI-015，debug/2026-09-24-lighthouse-first-paint）。
 */
import type { SpaceView } from '../../server/services/spaces.ts'
import { api, unwrap } from './api.ts'

export type Space = SpaceView
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

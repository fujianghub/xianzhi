import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../lib/api.ts'

export interface Me {
  id: string
  email: string
  name: string
  displayName: string | null
  /** 用户名原样（ADR-0008；旧账号可能为空） */
  username: string | null
  /** 头像 URL（REQ-WS-023） */
  image: string | null
  locale: string
  timezone: string
  weekStartsOn: number
  workspaceId: string
  workspaceRole: 'owner' | 'admin' | 'member' | 'guest'
}

export const meQuery = {
  queryKey: ['me'] as const,
  queryFn: () => unwrap<Me>(api.me.$get()),
  staleTime: 60_000,
}
export const useMe = () => useQuery(meQuery)
/** owner 才有用户管理（ADR-0010；仅 UI 门禁，权限以服务端 can('user.manage') 为准） */
export const isOwner = (me: Pick<Me, 'workspaceRole'> | undefined) => me?.workspaceRole === 'owner'
export const isAdmin = (me: Pick<Me, 'workspaceRole'> | undefined) =>
  me?.workspaceRole === 'owner' || me?.workspaceRole === 'admin'

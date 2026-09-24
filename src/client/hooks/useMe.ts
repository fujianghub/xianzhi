import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../lib/api.ts'

export interface Me {
  id: string
  email: string
  name: string
  displayName: string | null
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
export const isAdmin = (me: Pick<Me, 'workspaceRole'> | undefined) =>
  me?.workspaceRole === 'owner' || me?.workspaceRole === 'admin'

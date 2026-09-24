/**
 * 成员与候选（指派 / @提及 / ⌘K 指派共用）：工作区成员 + 空间显式成员 → 可读该空间的在职成员（01 §5）。
 * members 可见空间：只有显式成员；workspace 可见空间：非 guest 全员 + 被加入的 guest。
 */
import { useQuery } from '@tanstack/react-query'
import type { MemberView } from '../../server/services/members.ts'
import { api, unwrap } from '../lib/api.ts'
import { spaceQuery } from '../lib/space-queries.ts'

export type Member = MemberView

export const membersQuery = {
  queryKey: ['workspace', 'members'] as const,
  queryFn: () => unwrap<{ items: Member[] }>(api.workspace.members.$get()).then((r) => r.items),
  staleTime: 60_000,
}

export function useSpaceCandidates(spaceId: string | undefined): Member[] {
  const { data: members = [] } = useQuery(membersQuery)
  const { data: space } = useQuery({ ...spaceQuery(spaceId ?? ''), enabled: !!spaceId })
  const { data: spaceMembers } = useQuery({
    queryKey: ['space', spaceId, 'members'],
    queryFn: () =>
      unwrap<{ items: { userId: string }[] }>(
        api.spaces[':id'].members.$get({ param: { id: spaceId ?? '' } }),
      ).then((r) => r.items),
    enabled: !!spaceId,
  })
  const ids = new Set((spaceMembers ?? []).map((m) => m.userId))
  return members.filter(
    (m) =>
      m.status === 'active' &&
      (space?.visibility === 'members'
        ? ids.has(m.userId)
        : m.role !== 'guest' || ids.has(m.userId)),
  )
}

export const memberName = (m: Pick<Member, 'displayName' | 'name'>) => m.displayName || m.name

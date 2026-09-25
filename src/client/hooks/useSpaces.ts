/**
 * 空间数据（02 §9、REQ-SPACE-001 · 004 · 005）：列表 / 创建 / 归档 / 拖动排序。
 * 拖动排序乐观更新：先改缓存顺序，发一条 `PATCH /spaces/reorder`，失败回滚并提示（REQ-SPACE-005）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../lib/api.ts'
import {
  type Space,
  type SpaceKind,
  type SpaceVisibility,
  spacesKey,
  spacesQuery,
} from '../lib/space-queries.ts'

export type {
  Space,
  SpaceGroup,
  SpaceKind,
  SpaceSection,
  SpaceVisibility,
} from '../lib/space-queries.ts'
export {
  groupSpaces,
  planSpaceMove,
  sectionDropId,
  spaceGroupsQuery,
  spaceQuery,
  spacesKey,
  spacesQuery,
} from '../lib/space-queries.ts'

export const useSpaces = (archived = false, enabled = true) =>
  useQuery({ ...spacesQuery(archived), enabled })

/**
 * 把 activeId 移到 overId 的位置后，返回新顺序与服务端需要的 `after`（新位置前一项；最前为 null）。
 * 纯函数，供侧栏与测试共用。
 */
export function moveAfter(
  ids: readonly string[],
  activeId: string,
  overId: string,
): { order: string[]; after: string | null } | null {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return null
  const order = [...ids]
  order.splice(from, 1)
  order.splice(to, 0, activeId)
  const at = order.indexOf(activeId)
  return { order, after: at === 0 ? null : (order[at - 1] ?? null) }
}

export function useReorderSpace() {
  const qc = useQueryClient()
  const key = spacesKey(false)
  return useMutation({
    mutationFn: (v: {
      id: string
      after: string | null
      groupId?: string | null
      order: string[]
    }) =>
      unwrap<Space>(
        api.spaces.reorder.$patch({
          json: {
            id: v.id,
            after: v.after,
            ...(v.groupId !== undefined ? { groupId: v.groupId } : {}),
          },
        }),
      ),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Space[]>(key)
      if (prev) {
        const rank = new Map(v.order.map((id, i) => [id, i]))
        // 只重排参与拖动的那组，其余保持原位
        const moving = prev
          .filter((s) => rank.has(s.id))
          .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
        let i = 0
        qc.setQueryData<Space[]>(
          key,
          prev
            .map((s) => (rank.has(s.id) ? (moving[i++] as Space) : s))
            // 跨大类拖放：同步改 groupId（ADR-0012）
            .map((s) =>
              s.id === v.id && v.groupId !== undefined ? { ...s, groupId: v.groupId } : s,
            ),
        )
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['spaces'] }),
  })
}

export function useCreateSpace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (json: {
      name: string
      slug?: string
      kind: SpaceKind
      visibility: SpaceVisibility
      color?: string | null
      icon?: string | null
      groupId?: string | null
    }) => unwrap<Space>(api.spaces.$post({ json: json as never })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['spaces'] }),
  })
}

export function useArchiveSpace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      unwrap<Space>(
        archived
          ? api.spaces[':id'].archive.$post({ param: { id } })
          : api.spaces[':id'].unarchive.$post({ param: { id } }),
      ),
    onSuccess: (s) => {
      qc.setQueryData(['space', s.slug], s)
      return qc.invalidateQueries({ queryKey: ['spaces'] })
    },
  })
}

/**
 * 空间数据（02 §9、REQ-SPACE-001 · 004 · 005）：列表 / 创建 / 归档 / 拖动排序。
 * 拖动排序乐观更新：先改缓存顺序，发一条 `PATCH /spaces/reorder`，失败回滚并提示（REQ-SPACE-005）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import type { batchSpacesSchema } from '../../shared/schemas/spaces.ts'
import { api, unwrap } from '../lib/api.ts'
import {
  type Space,
  type SpaceGroup,
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

export type SpaceBatchInput = z.infer<typeof batchSpacesSchema>
export interface SpaceBatchResult {
  ok: string[]
  failed: { id: string; code: string; message: string }[]
  counts: { entries: number; tasks: number }
}

/**
 * 空间批量操作（ADR-0021、REQ-SPACE-010 ~ 012）：`POST /spaces/batch`；dryRun 只取可操作项与影响计数。
 * 真正执行后刷新空间列表、侧栏与回收站。
 */
export function useSpaceBatch() {
  const qc = useQueryClient()
  return async (input: SpaceBatchInput): Promise<SpaceBatchResult> => {
    const r = await unwrap<SpaceBatchResult>(api.spaces.batch.$post({ json: input as never }))
    if (!input.dryRun)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['spaces'] }),
        qc.invalidateQueries({ queryKey: ['space'] }),
      ])
    return r
  }
}

/**
 * 大类增改删排（ADR-0012 · 0018、REQ-KB-001 · 008）：侧栏分区菜单与「管理大类」弹窗共用；
 * 权限在服务端 `can('group.manage')`（owner / admin），前端只决定是否显示入口。
 */
export function useSpaceGroupActions() {
  const qc = useQueryClient()
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['space-groups'] }),
      qc.invalidateQueries({ queryKey: ['spaces'] }),
    ])
  const create = useMutation({
    mutationFn: (json: { name: string; color?: string | null }) =>
      unwrap<SpaceGroup>(api['space-groups'].$post({ json: json as never })),
    onSuccess: refresh,
  })
  const patch = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string | null }) =>
      unwrap<SpaceGroup>(
        api['space-groups'][':id'].$patch({
          param: { id: v.id },
          json: {
            ...(v.name ? { name: v.name } : {}),
            ...(v.color !== undefined ? { color: v.color } : {}),
          } as never,
        }),
      ),
    onSuccess: refresh,
  })
  const move = useMutation({
    mutationFn: (v: { id: string; after: string | null }) =>
      unwrap<SpaceGroup>(api['space-groups'].reorder.$patch({ json: v })),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap<void>(api['space-groups'][':id'].$delete({ param: { id } })),
    onSuccess: refresh,
  })
  return { create, patch, move, remove }
}

/** 把空间移到某大类（null = 未分类）：`PATCH /spaces/:id { groupId, ifUpdatedAt }`，需 space.manage。 */
export function useMoveSpaceToGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ space, groupId }: { space: Space; groupId: string | null }) =>
      unwrap<Space>(
        api.spaces[':id'].$patch({
          param: { id: space.id },
          json: { groupId, ifUpdatedAt: space.updatedAt } as never,
        }),
      ),
    onSuccess: (s) => {
      qc.setQueryData(['space', s.slug], s)
      return qc.invalidateQueries({ queryKey: ['spaces'] })
    },
  })
}

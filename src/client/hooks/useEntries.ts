/** 记录元数据写操作（02 §9）：PATCH 乐观更新 + 409 覆盖；正文不走这里（collab）。 */
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, unwrap } from '../lib/api.ts'
import type { Entry, EntryKind } from '../lib/entry-queries.ts'
import { optimisticPatch } from '../lib/optimistic.ts'
import { newId } from '../lib/uuid.ts'

export type EntryPatch = Partial<
  Pick<Entry, 'title' | 'fields' | 'visibility' | 'spaceId' | 'pinned'>
> & {
  tagIds?: string[]
}

export type BatchInput =
  | { op: 'move'; ids: string[]; spaceId: string }
  | { op: 'tags'; ids: string[]; add: string[]; remove: string[] }
  | { op: 'archive' | 'unarchive' | 'delete'; ids: string[] }

export function useEntryActions() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['entries'] })

  const patch = (entry: Entry, change: EntryPatch) =>
    optimisticPatch<Entry>({
      qc,
      keys: [['entry', entry.id]],
      apply: (d) => (d ? { ...(d as Entry), ...(change as Partial<Entry>) } : d),
      settle: (_d, server) => server,
      request: () =>
        unwrap<Entry>(
          api.entries[':id'].$patch({
            param: { id: entry.id },
            json: { ...change, ifUpdatedAt: entry.updatedAt } as never,
          }),
        ),
      onConflict: () => toast.error(t('task.conflict')),
      onError: () => toast.error(t('task.saveFailed')),
    }).finally(() => void invalidate())

  const create = async (input: {
    kind: EntryKind
    title: string
    spaceId?: string
    fields?: Record<string, unknown>
    templateId?: string
    parentId?: string | null
  }) => {
    const r = await unwrap<{ id: string }>(
      api.entries.$post({ json: input as never }, { headers: { 'idempotency-key': newId() } }),
    )
    await invalidate()
    return r
  }

  const remove = async (entry: Pick<Entry, 'id'>) => {
    await unwrap<void>(api.entries[':id'].$delete({ param: { id: entry.id } }))
    await invalidate()
  }

  /** 回收站恢复（删除 Toast 的「撤销」）。 */
  const restore = async (id: string) => {
    await unwrap(api.entries[':id'].restore.$post({ param: { id } }))
    await invalidate()
  }

  const archive = async (entry: Pick<Entry, 'id'>, on: boolean) => {
    const p = { param: { id: entry.id } }
    await unwrap(on ? api.entries[':id'].archive.$post(p) : api.entries[':id'].unarchive.$post(p))
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['entry', entry.id] })])
  }

  /** 收藏（ADR-0014，个人）：详情缓存乐观翻转，列表随后失效。 */
  const favorite = async (entry: Pick<Entry, 'id'>, on: boolean) => {
    qc.setQueryData<Entry>(['entry', entry.id], (d) => (d ? { ...d, favorited: on } : d))
    try {
      const p = { param: { id: entry.id } }
      await unwrap(
        on ? api.entries[':id'].favorite.$put(p) : api.entries[':id'].favorite.$delete(p),
      )
    } catch (err) {
      qc.setQueryData<Entry>(['entry', entry.id], (d) => (d ? { ...d, favorited: !on } : d))
      toast.error(t('task.saveFailed'))
      throw err
    } finally {
      void invalidate()
    }
  }

  /** 目录位置（ADR-0012 move）：挂到 parentId 下 after 之后，或 detach 移出目录。 */
  const move = async (
    entry: Pick<Entry, 'id'>,
    to: { parentId: string | null; after: string | null } | { detach: true },
  ) => {
    await unwrap(api.entries[':id'].move.$patch({ param: { id: entry.id }, json: to }))
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['entry', entry.id] })])
  }

  /** 批量（ADR-0014、REQ-ENTRY-013）：返回 ok / failed 明细。 */
  const batch = async (input: BatchInput) => {
    const r = await unwrap<{ ok: string[]; failed: { id: string; message: string }[] }>(
      api.entries.batch.$post({ json: input as never }),
    )
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['entry'] })])
    return r
  }

  return { patch, create, remove, restore, archive, favorite, move, batch, invalidate }
}

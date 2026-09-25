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

  const remove = async (entry: Entry) => {
    await unwrap<void>(api.entries[':id'].$delete({ param: { id: entry.id } }))
    await invalidate()
  }

  return { patch, create, remove, invalidate }
}

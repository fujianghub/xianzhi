/**
 * 回收站（08 §2.14、T1-019、REQ-ENTRY-007 · REQ-TASK-013 · REQ-SPACE-007）：Tab 任务 / 记录 / 空间（`?tab=`）；
 * 每行剩余天数（30 天后硬删）、恢复；永久删除仅 owner/admin（确认弹层）。数据：`GET /tasks|/entries|/spaces?deleted=1`。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import type { Me } from '../hooks/useMe.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'

const TABS = ['tasks', 'entries', 'spaces'] as const
type Tab = (typeof TABS)[number]
const RETENTION_DAYS = 30

export const Route = createFileRoute('/_app/trash')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: optOneOf(TABS)(s.tab) }),
  component: TrashPage,
})

interface Row {
  id: string
  title?: string
  name?: string
  deletedAt: string | null
  spaceSlug?: string
}

const fetchers: Record<Tab, () => Promise<{ items: Row[] }>> = {
  tasks: () => unwrap(api.tasks.$get({ query: { deleted: '1', limit: '200' } as never })),
  entries: () => unwrap(api.entries.$get({ query: { deleted: '1', limit: '100' } as never })),
  spaces: () => unwrap(api.spaces.$get({ query: { deleted: '1', limit: '200' } as never })),
}
const paths: Record<Tab, string> = { tasks: 'tasks', entries: 'entries', spaces: 'spaces' }

function TrashPage() {
  const { t } = useTranslation()
  const { tab = 'tasks' } = Route.useSearch()
  const { me } = Route.useRouteContext() as { me: Me }
  const nav = useNavigate({ from: '/trash' })
  const qc = useQueryClient()
  const q = useQuery({ queryKey: [tab, { deleted: '1' }, 'trash'], queryFn: fetchers[tab] })
  const skeleton = useDelayedFlag(q.isPending)
  const [purging, setPurging] = useState<Row | null>(null)
  const admin = me.workspaceRole === 'owner' || me.workspaceRole === 'admin'

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: [tab] }),
      qc.invalidateQueries({ queryKey: ['spaces'] }),
    ])
  const restore = async (r: Row) => {
    try {
      await unwrap(
        fetch(`/api/v1/${paths[tab]}/${r.id}/restore`, {
          method: 'POST',
          credentials: 'same-origin',
        }),
      )
      toast.success(t('trash.restored'))
      await refresh()
    } catch {
      toast.error(t('task.saveFailed'))
    }
  }
  const purge = async (r: Row) => {
    try {
      await unwrap(
        fetch(`/api/v1/${paths[tab]}/${r.id}?permanent=1`, {
          method: 'DELETE',
          credentials: 'same-origin',
        }),
      )
      toast.success(t('trash.purged'))
      await refresh()
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 403 ? t('trash.forbidden') : t('task.saveFailed'),
      )
    }
  }
  const daysLeft = (iso: string | null) =>
    iso
      ? Math.max(
          0,
          RETENTION_DAYS - Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
        )
      : RETENTION_DAYS

  const items = q.data?.items ?? []
  return (
    <section className="mx-auto max-w-3xl" data-testid="trash-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl">{t('ui.page.trash')}</h1>
        <div
          role="tablist"
          aria-label={t('ui.page.trash')}
          className="flex rounded-full border border-border p-0.5"
        >
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              data-testid={`trash-tab-${k}`}
              onClick={() =>
                void nav({ search: { tab: k === 'tasks' ? undefined : k }, replace: true })
              }
              className={cn(
                'h-8 rounded-full px-3 text-sm',
                tab === k ? 'bg-selected font-medium' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t(`trash.tab.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-fg-muted text-sm">{t('trash.hint', { days: RETENTION_DAYS })}</p>
      {skeleton ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : !q.isPending && !items.length ? (
        <EmptyState illustration="trash" title={t('trash.empty')} />
      ) : (
        <ul className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-4 py-2.5"
              data-testid="trash-row"
              data-id={r.id}
            >
              <span className="min-w-0 flex-1 truncate">{r.title ?? r.name}</span>
              <span className="shrink-0 text-fg-muted text-xs">
                {t('trash.daysLeft', { count: daysLeft(r.deletedAt) })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void restore(r)}
                data-testid="trash-restore"
              >
                <RotateCcw className="size-4" />
                {t('trash.restore')}
              </Button>
              {admin ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setPurging(r)}
                  data-testid="trash-purge"
                >
                  <Trash2 className="size-4" />
                  {t('trash.purge')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!purging}
        onOpenChange={(v) => !v && setPurging(null)}
        title={t('trash.purgeTitle')}
        description={t('trash.purgeHint', { name: purging?.title ?? purging?.name ?? '' })}
        confirmLabel={t('trash.purge')}
        onConfirm={() => (purging ? purge(purging) : undefined)}
      />
    </section>
  )
}

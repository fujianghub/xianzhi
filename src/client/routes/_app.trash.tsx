/**
 * 回收站（08 §2.14、T1-019、REQ-ENTRY-007 · REQ-TASK-013 · REQ-SPACE-007）：Tab 任务 / 记录 / 空间（`?tab=`）；
 * 每行剩余天数（30 天后硬删）、恢复；永久删除仅 owner/admin（确认弹层）。数据：`GET /tasks|/entries|/spaces?deleted=1`。
 * 空间 Tab 可多选（ADR-0021、REQ-SPACE-012）：批量恢复 / 永久删除（`POST /spaces/batch`，永久删除先 dryRun 取记录 / 任务数写进确认弹层）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import type { Me } from '../hooks/useMe.ts'
import { type SpaceBatchResult, useSpaceBatch } from '../hooks/useSpaces.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'
import { fetchAllSpaces } from '../lib/space-queries.ts'

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
  // 空间批量永久删除在这里做，列表必须完整：逐页取完（ADR-0021）
  spaces: () => fetchAllSpaces({ deleted: '1' }).then((items) => ({ items: items as Row[] })),
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
  const spaceBatch = useSpaceBatch()
  const multi = tab === 'spaces' && admin
  const [selected, setSelected] = useState<string[]>([])
  const [purgeMany, setPurgeMany] = useState<SpaceBatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切 Tab 即清空选择
  useEffect(() => setSelected([]), [tab])

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
  const selSet = new Set(selected)
  const allOn = items.length > 0 && items.every((r) => selSet.has(r.id))
  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const runMany = async (op: 'restore' | 'purge', ids: string[]) => {
    setBusy(true)
    try {
      const r = await spaceBatch({ op, ids })
      if (r.failed.length)
        toast.error(
          t('trash.batchPartial', {
            ok: r.ok.length,
            failed: r.failed.length,
            reason: r.failed[0]?.message ?? '',
          }),
        )
      else toast.success(t('trash.batchResult', { ok: r.ok.length }))
      setSelected(r.failed.map((f) => f.id))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  const askPurgeMany = async () => {
    setBusy(true)
    try {
      setPurgeMany(await spaceBatch({ op: 'purge', ids: selected, dryRun: true }))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mx-auto max-w-5xl" data-testid="trash-page">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">{t('ui.page.trash')}</h1>
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
          {multi ? (
            <li
              className="flex flex-wrap items-center gap-3 bg-surface-2 px-4 py-2"
              data-testid="trash-batch-bar"
            >
              <Checkbox
                checked={allOn ? true : selected.length ? 'indeterminate' : false}
                onCheckedChange={() => setSelected(allOn ? [] : items.map((r) => r.id))}
                aria-label={t('trash.selectAll')}
                data-testid="trash-select-all"
              />
              <span className="flex-1 text-fg-muted text-sm tabular-nums">
                {selected.length
                  ? t('trash.selected', { count: selected.length })
                  : t('trash.selectAll')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!selected.length || busy}
                onClick={() => void runMany('restore', selected)}
                data-testid="trash-restore-many"
              >
                <RotateCcw className="size-4" />
                {t('trash.restoreSelected')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!selected.length || busy}
                onClick={() => void askPurgeMany()}
                data-testid="trash-purge-many"
              >
                <Trash2 className="size-4" />
                {t('trash.purgeSelected')}
              </Button>
            </li>
          ) : null}
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-4 py-2.5"
              data-testid="trash-row"
              data-id={r.id}
            >
              {multi ? (
                <Checkbox
                  checked={selSet.has(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                  aria-label={t('trash.select', { name: r.name ?? '' })}
                  data-testid="trash-select"
                />
              ) : null}
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
      <ConfirmDialog
        open={!!purgeMany}
        onOpenChange={(v) => !v && setPurgeMany(null)}
        title={t('trash.purgeManyTitle', { count: purgeMany?.ok.length ?? 0 })}
        description={t('trash.purgeManyHint', {
          entries: purgeMany?.counts.entries ?? 0,
          tasks: purgeMany?.counts.tasks ?? 0,
        })}
        confirmLabel={t('trash.purge')}
        onConfirm={() => (purgeMany ? runMany('purge', purgeMany.ok) : undefined)}
      />
    </section>
  )
}

/**
 * 空间概览（ADR-0012、REQ-KB-003、08 §2.5b）：进入空间的默认页（侧栏 / 卡片链接到此）。
 * 按空间类型给出不同面板：
 * - project / work（产品开发）：未关闭 Bug（按严重度）· 最近迭代 · 最新版本 · 决策与优化 · 最近更新；
 * - learning（学习）：学习计划进度 · 最近笔记 · 最近更新。
 * 每个面板「查看全部」跳到记录页并带上类型 / 字段过滤与表格视图；快捷新建带好类型与内置模板。
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { entryKindClass } from '../components/domain/EntryCard.tsx'
import { KbHeader } from '../components/domain/KbHeader.tsx'
import { Button } from '../components/ui/button.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { Entry, EntryKind, EntryPage } from '../lib/entry-queries.ts'
import { spaceQuery } from '../lib/space-queries.ts'
import { useNewEntry } from '../lib/stores.ts'

export const Route = createFileRoute('/_app/spaces/$spaceSlug_/home')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(spaceQuery(params.spaceSlug))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) throw notFound()
      throw err
    }
  },
  component: KbHome,
})

/** 严重度排序与色调（Bug 面板）。 */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-red-bg text-red-fg',
  high: 'bg-orange-bg text-orange-fg',
  medium: 'bg-yellow-bg text-yellow-fg',
  low: 'bg-gray-bg text-gray-fg',
}

function useEntryList(spaceId: string, query: Record<string, string>, limit: number) {
  return useQuery({
    queryKey: ['entries', { spaceId, ...query }, 'overview', limit],
    queryFn: () =>
      unwrap<EntryPage>(
        api.entries.$get({ query: { spaceId, ...query, limit: String(limit) } as never }),
      ).then((r) => r.items),
    staleTime: 15_000,
  })
}

function Panel({
  title,
  count,
  more,
  children,
  testId,
}: {
  title: string
  count?: number
  more?: ReactNode
  children: ReactNode
  testId: string
}) {
  return (
    <section className="paper flex flex-col gap-3 rounded-xl p-4" data-testid={testId}>
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-sm">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full bg-surface-2 px-1.5 text-fg-muted text-xs tabular-nums">
            {count}
          </span>
        ) : null}
        <div className="ms-auto text-xs">{more}</div>
      </div>
      {children}
    </section>
  )
}

function EntryLine({ e, meta }: { e: Entry; meta?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link
        to="/entries/$entryId"
        params={{ entryId: e.id }}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover"
      >
        <span className={cn('shrink-0 rounded-full px-1.5 text-[11px]', entryKindClass(e.kind))}>
          {t(`entry.kind.${e.kind}`)}
        </span>
        <span className="min-w-0 flex-1 truncate">{e.title}</span>
        {meta}
        <RelativeTime date={e.updatedAt} className="shrink-0 text-fg-muted text-xs" />
      </Link>
    </li>
  )
}

function List({
  items,
  loading,
  empty,
  meta,
}: {
  items: Entry[] | undefined
  loading: boolean
  empty: string
  meta?: (e: Entry) => ReactNode
}) {
  if (loading) return <Skeleton className="h-20 w-full" />
  if (!items?.length) return <p className="px-2 text-fg-muted text-sm">{empty}</p>
  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((e) => (
        <EntryLine key={e.id} e={e} meta={meta?.(e)} />
      ))}
    </ul>
  )
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

function KbHome() {
  const { t } = useTranslation()
  const { spaceSlug } = Route.useParams()
  const { data: space } = useQuery(spaceQuery(spaceSlug))
  const openNew = useNewEntry((s) => s.setOpen)
  const id = space?.id ?? ''
  const learning = space?.kind === 'learning'
  const bugs = useEntryList(id, { kind: 'bug', fields: 'status=open' }, 100)
  const iterations = useEntryList(id, { kind: 'iteration', sort: '-createdAt' }, 3)
  const releases = useEntryList(id, { kind: 'changelog', sort: '-createdAt' }, 3)
  const decisions = useEntryList(id, { kind: 'decision,optimize' }, 5)
  const plans = useEntryList(id, { kind: 'plan' }, 20)
  const notes = useEntryList(id, { kind: 'note,journal,review' }, 6)
  const recent = useEntryList(id, {}, 8)
  if (!space) return null

  const more = (query: Record<string, string>) => (
    <Link
      to="/spaces/$spaceSlug/entries"
      params={{ spaceSlug }}
      search={query}
      className="text-primary-text hover:underline"
    >
      {t('kb.viewAll')}
    </Link>
  )
  const quick = (kind: EntryKind, templateId?: string) => (
    <Button
      key={`${kind}-${templateId ?? ''}`}
      size="sm"
      variant="ghost"
      onClick={() => openNew(true, { spaceId: space.id, kind, templateId })}
      data-testid={`kb-quick-${kind}`}
    >
      <Plus className="size-4" />
      {t(`entry.kind.${kind}`)}
    </Button>
  )
  const bySeverity = SEVERITIES.map((s) => ({
    s,
    n: (bugs.data ?? []).filter((e) => e.fields.severity === s).length,
  }))
  const topBugs = [...(bugs.data ?? [])]
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.fields.severity as never) -
          SEVERITIES.indexOf(b.fields.severity as never) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 6)

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="kb-home">
      <KbHeader space={space} active="home" />
      <div className="mt-4 flex flex-wrap gap-1" data-testid="kb-quick">
        {learning
          ? [
              quick('plan', 'builtin:learning-plan'),
              quick('note', 'builtin:study-note'),
              quick('journal', 'builtin:learning-weekly'),
            ]
          : [
              quick('bug', 'builtin:bug-fix'),
              quick('iteration'),
              quick('changelog'),
              quick('decision'),
              quick('optimize', 'builtin:product-optimize'),
            ]}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {learning ? (
          <>
            <Panel
              title={t('kb.panel.plans')}
              count={plans.data?.length}
              more={more({ kind: 'plan', view: 'table' })}
              testId="kb-panel-plans"
            >
              {plans.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : plans.data?.length ? (
                <ul className="flex flex-col gap-3">
                  {plans.data.map((e) => {
                    const p = Math.max(0, Math.min(100, Number(e.fields.progress ?? 0)))
                    return (
                      <li key={e.id}>
                        <Link
                          to="/entries/$entryId"
                          params={{ entryId: e.id }}
                          className="block rounded-md px-2 py-1 hover:bg-hover"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{e.title}</span>
                            <span className="text-fg-muted text-xs">
                              {t(`entry.fieldValue.${str(e.fields.status)}`, {
                                defaultValue: str(e.fields.status),
                              })}
                              {e.fields.endDate ? ` · ${str(e.fields.endDate)}` : ''}
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
                            role="progressbar"
                            aria-valuenow={p}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={e.title}
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${p}%` }}
                            />
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="px-2 text-fg-muted text-sm">{t('kb.empty.plans')}</p>
              )}
            </Panel>
            <Panel
              title={t('kb.panel.notes')}
              more={more({ kind: 'note,journal,review' })}
              testId="kb-panel-notes"
            >
              <List items={notes.data} loading={notes.isPending} empty={t('kb.empty.notes')} />
            </Panel>
          </>
        ) : (
          <>
            <Panel
              title={t('kb.panel.bugs')}
              count={bugs.data?.length}
              more={more({ kind: 'bug', fields: 'status=open', view: 'table' })}
              testId="kb-panel-bugs"
            >
              <div className="flex flex-wrap gap-1.5" data-testid="kb-bug-severity">
                {bySeverity.map(({ s, n }) => (
                  <Link
                    key={s}
                    to="/spaces/$spaceSlug/entries"
                    params={{ spaceSlug }}
                    search={{ kind: 'bug', fields: `status=open,severity=${s}`, view: 'table' }}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs tabular-nums',
                      SEVERITY_TONE[s],
                    )}
                    data-severity={s}
                  >
                    {t(`entry.fieldValue.${s}`)} {n}
                  </Link>
                ))}
              </div>
              <List
                items={topBugs}
                loading={bugs.isPending}
                empty={t('kb.empty.bugs')}
                meta={(e) => (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 text-[11px]',
                      SEVERITY_TONE[str(e.fields.severity)],
                    )}
                  >
                    {t(`entry.fieldValue.${str(e.fields.severity)}`, { defaultValue: '' })}
                  </span>
                )}
              />
            </Panel>
            <Panel
              title={t('kb.panel.iterations')}
              more={more({ kind: 'iteration', view: 'table' })}
              testId="kb-panel-iterations"
            >
              <List
                items={iterations.data}
                loading={iterations.isPending}
                empty={t('kb.empty.iterations')}
                meta={(e) => (
                  <span className="shrink-0 text-fg-muted text-xs">
                    {[
                      str(e.fields.version),
                      [str(e.fields.periodStart), str(e.fields.periodEnd)]
                        .filter(Boolean)
                        .join(' ~ '),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              />
            </Panel>
            <Panel
              title={t('kb.panel.releases')}
              more={more({ kind: 'changelog', view: 'table' })}
              testId="kb-panel-releases"
            >
              <List
                items={releases.data}
                loading={releases.isPending}
                empty={t('kb.empty.releases')}
                meta={(e) => (
                  <span className="shrink-0 font-mono text-fg-muted text-xs">
                    {[str(e.fields.version), str(e.fields.releasedAt)].filter(Boolean).join(' · ')}
                  </span>
                )}
              />
            </Panel>
            <Panel
              title={t('kb.panel.decisions')}
              more={more({ kind: 'decision,optimize', view: 'table' })}
              testId="kb-panel-decisions"
            >
              <List
                items={decisions.data}
                loading={decisions.isPending}
                empty={t('kb.empty.decisions')}
                meta={(e) => (
                  <span className="shrink-0 text-fg-muted text-xs">
                    {t(`entry.fieldValue.${str(e.fields.status)}`, {
                      defaultValue: str(e.fields.status),
                    })}
                  </span>
                )}
              />
            </Panel>
          </>
        )}
        <Panel title={t('kb.panel.recent')} more={more({})} testId="kb-panel-recent">
          <List items={recent.data} loading={recent.isPending} empty={t('kb.empty.recent')} />
        </Panel>
      </div>
    </section>
  )
}

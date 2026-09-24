/** 审计日志（08 §2.13、T1-043、REQ-WS-005）：游标分页「加载更多」；按动作 / 操作人筛选（`?action=&actor=`）；admin+。 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/button.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { memberName, membersQuery } from '../hooks/useMembers.ts'
import { api, unwrap } from '../lib/api.ts'
import { optString } from '../lib/search.ts'
import { requireAdmin } from './-components/admin-gate.ts'

type Search = { action?: string; actor?: string }
export const Route = createFileRoute('/_app/settings/workspace/audit')({
  beforeLoad: requireAdmin,
  validateSearch: (s: Record<string, unknown>): Search => ({
    action: optString(s.action)?.slice(0, 64),
    actor: optString(s.actor)?.slice(0, 64),
  }),
  component: Audit,
})

interface Row {
  id: string
  actorId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  ip: string | null
  createdAt: string
}

function Audit() {
  const { t, i18n } = useTranslation()
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/settings/workspace/audit' })
  const members = useQuery(membersQuery)
  const nameOf = (id: string | null) => {
    const m = members.data?.find((x) => x.userId === id)
    return m ? memberName(m) : id ? t('settings.audit.unknownActor') : t('settings.audit.system')
  }
  const q = useInfiniteQuery({
    queryKey: ['workspace', 'audit', search],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap<{ items: Row[]; nextCursor: string | null }>(
        api.workspace['audit-log'].$get({
          query: {
            limit: '50',
            ...(search.action ? { action: search.action } : {}),
            ...(search.actor ? { actorId: search.actor } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          } as never,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  })
  const rows = q.data?.pages.flatMap((p) => p.items) ?? []
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' })
  return (
    <section className="max-w-5xl" data-testid="settings-audit">
      <h1 className="mb-4 font-semibold text-2xl">{t('settings.nav.audit')}</h1>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          defaultValue={search.action ?? ''}
          placeholder={t('settings.audit.action')}
          aria-label={t('settings.audit.action')}
          className="h-9 w-56"
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              void nav({
                search: (s) => ({ ...s, action: e.currentTarget.value.trim() || undefined }),
                replace: true,
              })
          }}
        />
        <select
          value={search.actor ?? ''}
          aria-label={t('settings.audit.actor')}
          onChange={(e) =>
            void nav({
              search: (s) => ({ ...s, actor: e.target.value || undefined }),
              replace: true,
            })
          }
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">{t('settings.audit.allActors')}</option>
          {(members.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {memberName(m)}
            </option>
          ))}
        </select>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !rows.length ? (
        <EmptyState illustration="inbox" title={t('settings.audit.empty')} />
      ) : (
        <>
          <div className="paper overflow-x-auto rounded-lg border border-divider">
            <table className="w-full text-sm" data-testid="audit-table">
              <thead className="text-fg-muted text-xs">
                <tr className="border-divider border-b">
                  <th className="px-4 py-2 text-left font-normal">{t('settings.audit.time')}</th>
                  <th className="px-3 py-2 text-left font-normal">{t('settings.audit.actor')}</th>
                  <th className="px-3 py-2 text-left font-normal">{t('settings.audit.action')}</th>
                  <th className="px-3 py-2 text-left font-normal">{t('settings.audit.target')}</th>
                  <th className="px-3 py-2 text-left font-normal">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-divider border-b last:border-0"
                    data-testid="audit-row"
                  >
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                      {fmt.format(new Date(r.createdAt))}
                    </td>
                    <td className="px-3 py-2">{nameOf(r.actorId)}</td>
                    <td className="px-3 py-2">
                      <code className="text-xs">{r.action}</code>
                    </td>
                    <td className="px-3 py-2 text-fg-muted text-xs">
                      {r.targetType ? `${r.targetType}:${(r.targetId ?? '').slice(0, 8)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-fg-muted text-xs">{r.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="ghost"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
                data-testid="audit-more"
              >
                {t('entry.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

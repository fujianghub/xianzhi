/**
 * 通知中心（08 §2.12、T1-027、REQ-NOTIF-005）：Tab 全部 / 提及 / 未读（`?tab=`）；点击跳深链并标已读；全部已读；归档。
 * SSE `invalidate ['notifications']` 到达时列表自动重取（useRealtime）。
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NotificationItem } from '../components/domain/NotificationItem.tsx'
import { Button } from '../components/ui/button.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { type NotificationPage, useNotificationActions } from '../hooks/useNotifications.ts'
import { api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'

const TABS = ['all', 'mentions', 'unread'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/_app/notifications')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: optOneOf(TABS)(s.tab) }),
  component: NotificationsPage,
})

function NotificationsPage() {
  const { t } = useTranslation()
  const { tab = 'all' } = Route.useSearch()
  const nav = useNavigate({ from: '/notifications' })
  const actions = useNotificationActions()
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'page', tab],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap<NotificationPage>(
        api.notifications.$get({
          query: {
            limit: '30',
            ...(tab === 'unread' ? { unread: '1' } : {}),
            ...(tab === 'mentions' ? { kind: 'mention.created' } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          } as never,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: NotificationPage) => last.nextCursor ?? undefined,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const unread = q.data?.pages[0]?.unreadCount ?? 0
  const skeleton = useDelayedFlag(q.isPending)
  return (
    <section className="mx-auto max-w-3xl" data-testid="notifications-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl">{t('ui.page.notifications')}</h1>
        <div
          role="tablist"
          aria-label={t('ui.page.notifications')}
          className="flex rounded-full border border-border p-0.5"
        >
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              data-testid={`notif-tab-${k}`}
              onClick={() =>
                void nav({ search: { tab: k === 'all' ? undefined : k }, replace: true })
              }
              className={cn(
                'h-8 rounded-full px-3 text-sm',
                tab === k ? 'bg-selected font-medium' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t(`notif.tab.${k}`)}
            </button>
          ))}
        </div>
        <Button
          className="ml-auto"
          size="sm"
          variant="ghost"
          disabled={!unread}
          onClick={() => void actions.readAll()}
          data-testid="read-all"
        >
          {t('notif.markAllRead')}
        </Button>
      </div>
      {skeleton ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="flex items-center gap-3 text-sm">
          {t('notif.loadError')}
          <Button size="sm" variant="ghost" onClick={() => void q.refetch()}>
            {t('ui.action.retry')}
          </Button>
        </div>
      ) : !q.isPending && !items.length ? (
        <EmptyState illustration="inbox" title={t('notif.quiet')} />
      ) : (
        <>
          <ul className="paper flex flex-col gap-0.5 rounded-lg border border-divider p-1">
            {items.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                onOpen={(x) => void actions.open(x)}
                onArchive={(x) => void actions.archive(x)}
              />
            ))}
          </ul>
          {q.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="ghost"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
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

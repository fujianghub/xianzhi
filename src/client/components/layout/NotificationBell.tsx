/**
 * 通知铃铛（04 §6、REQ-NOTIF-005）：未读数来自 `GET /notifications?unread=1` 的 unreadCount；SSE 帧触发失效（useRealtime）。
 * 面板列未读，点击跳深链并标已读；底部「全部已读」「查看全部」。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type NotificationPage, useNotificationActions } from '../../hooks/useNotifications.ts'
import { api, unwrap } from '../../lib/api.ts'
import { NotificationItem } from '../domain/NotificationItem.tsx'
import { Button } from '../ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'

export function NotificationBell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const actions = useNotificationActions()
  const q = useQuery({
    queryKey: ['notifications', { unread: true }],
    queryFn: () =>
      unwrap<NotificationPage>(api.notifications.$get({ query: { unread: '1', limit: '20' } })),
    staleTime: 30_000,
  })
  const count = q.data?.unreadCount ?? 0
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="icon"
          aria-label={count ? t('notif.unread', { count }) : t('notif.bell')}
          className="relative"
          data-testid="bell"
        >
          <Bell />
          {count ? (
            <span
              data-testid="bell-count"
              className="absolute top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center font-medium text-[10px] text-primary-fg leading-4"
            >
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2" data-testid="bell-panel">
        {q.data?.items.length ? (
          <ul className="flex max-h-96 flex-col overflow-y-auto">
            {q.data.items.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                compact
                onOpen={(x) => {
                  setOpen(false)
                  void actions.open(x)
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-fg-muted text-sm">{t('notif.empty')}</p>
        )}
        <div className="mt-1 flex items-center justify-between border-divider border-t px-1 pt-2 text-sm">
          <button
            type="button"
            className="rounded px-2 py-1 text-fg-muted hover:bg-hover disabled:opacity-50"
            onClick={() => void actions.readAll()}
            disabled={!count}
          >
            {t('notif.markAllRead')}
          </button>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-primary hover:bg-hover"
          >
            {t('notif.viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

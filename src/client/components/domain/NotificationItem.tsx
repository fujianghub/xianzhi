/** 通知条目（08 §2.12）：标题、正文、相对时间；未读左侧 3px 主色条；点击跳转并标已读。 */
import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Notification } from '../../hooks/useNotifications.ts'
import { cn } from '../../lib/cn.ts'
import { RelativeTime } from '../ui/relative-time.tsx'

export function NotificationItem({
  n,
  onOpen,
  onArchive,
  compact,
}: {
  n: Notification
  onOpen: (n: Notification) => void
  onArchive?: (n: Notification) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  return (
    <li
      className={cn(
        'group relative flex items-start gap-2 rounded-md hover:bg-hover',
        !n.readAt &&
          'before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary',
      )}
      data-testid="notification-item"
      data-unread={n.readAt ? undefined : 'true'}
    >
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn('min-w-0 flex-1 text-left', compact ? 'px-3 py-2' : 'px-4 py-3')}
      >
        <span className={cn('block text-sm', !n.readAt && 'font-medium')}>
          {n.title}
          {n.count > 1 ? <span className="ml-1 text-fg-muted text-xs">×{n.count}</span> : null}
        </span>
        {n.body && !compact ? (
          <span className="mt-0.5 line-clamp-2 block text-fg-muted text-sm">{n.body}</span>
        ) : null}
        <RelativeTime date={n.createdAt} className="mt-0.5 block text-fg-muted text-xs" />
      </button>
      {onArchive ? (
        <button
          type="button"
          onClick={() => onArchive(n)}
          aria-label={t('notif.archive')}
          className="mt-2 mr-2 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Archive className="size-4" />
        </button>
      ) : null}
    </li>
  )
}

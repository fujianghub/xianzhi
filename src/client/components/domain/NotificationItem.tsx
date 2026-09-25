/**
 * 通知条目（08 §2.12）：类型图标、标题、正文、相对时间；未读 = 图标右上角主色圆点 + 标题加粗；点击跳转并标已读。
 * 图标底色取语义 soft 色（04 §2.1），不单靠颜色区分——标题文案本身说明类型。
 */
import {
  AlarmClock,
  AlertTriangle,
  Archive,
  AtSign,
  Bell,
  CheckCircle2,
  Download,
  KeyRound,
  type LucideIcon,
  MessageSquare,
  RotateCcw,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Notification } from '../../hooks/useNotifications.ts'
import { cn } from '../../lib/cn.ts'
import { RelativeTime } from '../ui/relative-time.tsx'

type Tone = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral'
const TONE: Record<Tone, string> = {
  primary: 'bg-primary-soft text-primary-text',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  // warning / accent 在各自 soft 底上日场仅 2.7:1，改取色板 amber / ochre（fg/bg 已过 AA）
  warning: 'bg-amber-bg text-amber-fg',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-ochre-bg text-ochre-fg',
  neutral: 'bg-surface-2 text-fg-muted',
}
const KIND: Record<string, [LucideIcon, Tone]> = {
  'task.assigned': [UserPlus, 'info'],
  'task.unassigned': [UserMinus, 'neutral'],
  'task.due_soon': [AlarmClock, 'warning'],
  'task.completed': [CheckCircle2, 'success'],
  'task.commented': [MessageSquare, 'primary'],
  'entry.commented': [MessageSquare, 'primary'],
  'mention.created': [AtSign, 'primary'],
  'space.invited': [Users, 'info'],
  'member.joined': [Users, 'info'],
  'workspace.owner_transferred': [KeyRound, 'accent'],
  'cycle.review_due': [RotateCcw, 'accent'],
  'system.export_done': [Download, 'success'],
  'system.backup_failed': [AlertTriangle, 'danger'],
  'system.outbox_stalled': [AlertTriangle, 'danger'],
}

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
  const [Icon, tone] = KIND[n.kind] ?? [Bell, 'neutral']
  const unread = !n.readAt
  return (
    <li
      className="group relative flex items-start gap-2 rounded-md transition-colors duration-(--xz-dur-fast) hover:bg-hover"
      data-testid="notification-item"
      data-unread={unread ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-3 text-left',
          compact ? 'px-2.5 py-2' : 'px-3 py-3',
        )}
      >
        <span
          className={cn(
            'relative mt-0.5 grid shrink-0 place-items-center rounded-full',
            compact ? 'size-7' : 'size-8',
            TONE[tone],
          )}
          aria-hidden
        >
          <Icon className={compact ? 'size-3.5' : 'size-4'} strokeWidth={2} />
          {unread ? (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-(--xz-surface-solid)" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm', unread ? 'font-medium' : 'text-fg-muted')}>
            {n.title}
            {n.count > 1 ? <span className="ml-1 text-fg-muted text-xs">×{n.count}</span> : null}
          </span>
          {n.body && !compact ? (
            <span className="mt-0.5 line-clamp-2 block text-fg-muted text-sm">{n.body}</span>
          ) : null}
          <RelativeTime date={n.createdAt} className="mt-1 block text-fg-faint text-xs" />
        </span>
      </button>
      {onArchive ? (
        <button
          type="button"
          onClick={() => onArchive(n)}
          aria-label={t('notif.archive')}
          className="mt-2.5 mr-2 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted opacity-0 transition-opacity duration-(--xz-dur-fast) hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Archive className="size-4" />
        </button>
      ) : null}
    </li>
  )
}

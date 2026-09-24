/** 优先级（04 §2.1、REQ-TASK-009）：颜色 + 图标，不单靠颜色；无 = 不显示。 */
import { AlertTriangle, ChevronDown, ChevronsUp, ChevronUp, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'

const MAP = {
  0: { Icon: Minus, cls: 'text-fg-muted' },
  1: { Icon: ChevronDown, cls: 'text-info' },
  2: { Icon: ChevronUp, cls: 'text-primary' },
  3: { Icon: ChevronsUp, cls: 'text-warning' },
  4: { Icon: AlertTriangle, cls: 'text-danger' },
} as const

export function PriorityIcon({
  priority,
  className,
  showNone = false,
}: {
  priority: number
  className?: string
  showNone?: boolean
}) {
  const { t } = useTranslation()
  if (!priority && !showNone) return null
  const p = (Math.min(4, Math.max(0, priority)) as keyof typeof MAP) ?? 0
  const { Icon, cls } = MAP[p]
  const label = `${t('task.priorityLabel')}：${t(`task.priority.${p}`)}`
  return (
    <span className={cn('inline-flex shrink-0', cls, className)} title={label} data-priority={p}>
      <Icon className="size-4" strokeWidth={2} aria-label={label} />
    </span>
  )
}

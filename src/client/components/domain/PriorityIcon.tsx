/**
 * 优先级（04 §2.1、REQ-TASK-009；ADR-0052 鲜艳色 + 胶囊）：颜色 + 图标（胶囊再加文字），不单靠颜色；无 = 不显示。
 * 颜色经 `data-priority` 取 `--xz-prio-*`（app.css），只来自 tokens（不变量 5）。
 */
import { AlertTriangle, ChevronDown, ChevronsUp, ChevronUp, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'

const ICONS = {
  0: Minus,
  1: ChevronDown,
  2: ChevronUp,
  3: ChevronsUp,
  4: AlertTriangle,
} as const

const level = (p: number) => Math.min(4, Math.max(0, Math.round(p))) as keyof typeof ICONS

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
  const p = level(priority)
  const Icon = ICONS[p]
  const label = `${t('task.priorityLabel')}：${t(`task.priority.${p}`)}`
  return (
    <span
      className={cn('xz-prio-icon inline-flex shrink-0', className)}
      title={label}
      data-priority={p}
    >
      <Icon className="size-4" aria-label={label} />
    </span>
  )
}

/**
 * 优先级胶囊：图标 + 「紧急 / 高 / 中 / 低」（任务行 · 看板卡片 · Peek）。
 * `compact`：窄屏只留图标（文字 sm 以上才显示）。
 */
export function PriorityChip({
  priority,
  className,
  compact = false,
}: {
  priority: number
  className?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  if (!priority) return null
  const p = level(priority)
  const Icon = ICONS[p]
  const name = t(`task.priority.${p}`)
  return (
    <span
      className={cn('xz-prio-chip', className)}
      title={`${t('task.priorityLabel')}：${name}`}
      data-priority={p}
      data-testid="task-prio-chip"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className={cn(compact && 'hidden sm:inline')}>{name}</span>
    </span>
  )
}

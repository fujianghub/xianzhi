/**
 * 页头（04 §3）：题记（可选，展示字小号）· 标题 · 行内附件（Tab / 筛选）· 右侧动作；下方可带一行说明。
 * 各一级页统一字号与间距，不再各写一套 h1。
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export function PageHeader({
  title,
  eyebrow,
  description,
  inline,
  actions,
  className,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  /** 紧跟标题的附件，如 Tab 组 */
  inline?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-6', className)}>
      {eyebrow ? <p className="xz-eyebrow mb-1">{eyebrow}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {inline}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="mt-1.5 text-fg-muted text-sm">{description}</p> : null}
    </header>
  )
}

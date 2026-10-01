/** 清单色点（ADR-0044）：任务行 / 清单栏 / 选择器共用；单独成模块，任务行不必连带加载选择器。 */
import { cn } from '../../lib/cn.ts'
import type { TaskList } from '../../lib/task-list-queries.ts'
import { PALETTE_DOT, type PaletteName } from './SpaceIcon.tsx'

export function ListDot({
  list,
  className,
}: {
  list: Pick<TaskList, 'color'>
  className?: string
}) {
  return (
    <span
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        PALETTE_DOT[(list.color as PaletteName) ?? 'gray'] ?? PALETTE_DOT.gray,
        className,
      )}
      aria-hidden
    />
  )
}

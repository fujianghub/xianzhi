import { cn } from '../../lib/cn.ts'

/** Skeleton（06 §4）：surface-solid-2 + --xz-dur-shimmer 微光（系统减弱或用户「减弱」档下静止，见 app.css）。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-md', className)} aria-hidden />
}

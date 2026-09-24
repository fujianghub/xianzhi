import { cn } from '../../lib/cn.ts'

/** Skeleton（06 §4）：surface-solid-2 + 1.4s 微光（reduced-motion 下静止）。 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('skeleton-shimmer rounded-md motion-reduce:animate-none', className)}
      aria-hidden
    />
  )
}

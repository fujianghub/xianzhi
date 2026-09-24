/** KeyHint（06 §4）：glass-thin 底色但无 blur + border，只在 ⌘K 与快捷键面板内。 */
import { cn } from '../../lib/cn.ts'

export function KeyHint({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-(--xz-glass-thin) px-1 font-mono text-[11px] text-fg-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

/** Input（06 §5.2）：纸面底 + border；focus = outline + selected-border；玻璃上用 glass 变体。 */
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export function Input({
  className,
  invalid,
  onGlass,
  ...props
}: ComponentProps<'input'> & { invalid?: boolean; onGlass?: boolean }) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border px-3 text-fg text-sm outline-none transition-[border-color] duration-(--xz-dur-fast) placeholder:text-fg-faint focus-visible:border-selected-border disabled:opacity-50',
        onGlass ? 'border-divider bg-(--xz-glass-thin)' : 'border-border bg-surface',
        invalid && 'border-danger',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

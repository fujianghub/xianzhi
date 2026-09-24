/** Checkbox（06 §4 §5.3）：纸面底 + border；选中 primary-gradient，勾线描画。 */
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-surface transition-[background] duration-(--xz-dur-base) ease-(--xz-ease-spring) data-[state=checked]:border-transparent data-[state=checked]:bg-(image:--xz-primary-gradient)',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <svg viewBox="0 0 16 16" className="size-3.5 text-primary-fg" aria-hidden>
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="[stroke-dasharray:1] [animation:xz-draw_160ms_var(--xz-ease-out)_both] motion-reduce:animate-none"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

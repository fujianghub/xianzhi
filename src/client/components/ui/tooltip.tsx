/** Tooltip（06 §4）：glass-opaque（不 blur、不计入预算），portal 到 body。 */
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  ...props
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
} & ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Root delayDuration={400} {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          data-xz-exit=""
          className={cn(
            'glass-opaque z-(--xz-z-toast) origin-(--radix-tooltip-content-transform-origin) rounded-md px-2 py-1 text-fg text-xs data-[state=delayed-open]:animate-[xz-pop-in_var(--xz-dur-fast)_var(--xz-ease-out)] data-[state=instant-open]:animate-[xz-fade-in_var(--xz-dur-fast)_var(--xz-ease-out)] data-[state=closed]:animate-[xz-fade-out_var(--xz-dur-fast)_var(--xz-ease-out)_forwards]',
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

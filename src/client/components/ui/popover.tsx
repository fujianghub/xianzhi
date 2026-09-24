/** Popover（06 §4）：glass-thick，portal 到 body。 */
import { Popover as PopoverPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'glass-thick z-(--xz-z-dropdown) w-72 rounded-lg p-4 text-fg outline-none data-[state=open]:animate-[xz-pop-in_var(--xz-dur-base)_var(--xz-ease-out)]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

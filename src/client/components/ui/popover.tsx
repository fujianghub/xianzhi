/** Popover（06 §4）：glass-thick，portal 到 body；高度不超过视口可用空间，内容过长时内部滚动（大类等列表会随数据增长）。 */
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
          'glass-thick z-(--xz-z-dropdown) max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto rounded-lg p-4 text-fg outline-none data-[state=open]:animate-[xz-pop-in_var(--xz-dur-base)_var(--xz-ease-out)]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

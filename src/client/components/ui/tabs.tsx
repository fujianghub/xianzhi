/** Tabs（06 §4）：透明；选中项 selected-bg 胶囊。 */
import { Tabs as TabsPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export const Tabs = TabsPrimitive.Root
export const TabsContent = TabsPrimitive.Content
export const TabsList = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('inline-flex items-center gap-1', className)} {...props} />
)
export const TabsTrigger = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      'h-8 rounded-full px-3 text-fg-muted text-sm transition-colors duration-(--xz-dur-fast) hover:bg-hover hover:text-fg data-[state=active]:bg-selected data-[state=active]:text-fg',
      className,
    )}
    {...props}
  />
)

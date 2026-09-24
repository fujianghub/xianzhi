/** Command ⌘K（06 §4）：glass-thick blur 28 + 光标高光，宽 640，z cmdk；portal 到 body。 */
import { Command as CommandPrimitive } from 'cmdk'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { useCursorSheen } from '../../hooks/useCursorSheen.ts'
import { cn } from '../../lib/cn.ts'

export function CommandDialog({
  open,
  onOpenChange,
  title,
  children,
  value,
  onValueChange,
  shouldFilter,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
  /** 受控高亮项与过滤（⌘K 自行过滤并在候选变化时回到首项） */
  value?: string
  onValueChange?: (v: string) => void
  shouldFilter?: boolean
}) {
  const sheen = useCursorSheen<HTMLDivElement>()
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim fixed inset-0 z-(--xz-z-scrim)" />
        <DialogPrimitive.Content
          ref={sheen}
          className="glass-thick glass-cursor-sheen fixed top-[16vh] left-1/2 z-(--xz-z-cmdk) w-[min(92vw,40rem)] -translate-x-1/2 overflow-hidden rounded-xl text-fg outline-none [--xz-blur-thick:var(--xz-blur-cmdk)]"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <CommandPrimitive
            className="flex flex-col"
            value={value}
            onValueChange={onValueChange}
            shouldFilter={shouldFilter}
          >
            {children}
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export const CommandInput = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) => (
  <CommandPrimitive.Input
    className={cn(
      'h-12 w-full border-divider border-b bg-transparent px-4 text-fg outline-none placeholder:text-fg-faint',
      className,
    )}
    {...props}
  />
)
export const CommandList = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List className={cn('max-h-80 overflow-y-auto p-2', className)} {...props} />
)
export const CommandEmpty = (props: ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty className="px-3 py-6 text-center text-fg-muted text-sm" {...props} />
)
export const CommandGroup = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    className={cn(
      '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-fg-faint [&_[cmdk-group-heading]]:text-xs',
      className,
    )}
    {...props}
  />
)
export const CommandItem = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn(
      'flex h-10 cursor-default items-center gap-2 rounded-md px-2 text-sm aria-selected:bg-selected',
      className,
    )}
    {...props}
  />
)

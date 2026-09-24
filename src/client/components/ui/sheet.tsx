/**
 * Sheet（06 §4）：modal 版 = glass-thick + Scrim；非 modal 版（PeekPanel，04 §6）= 无 Scrim、不锁滚动、不抢焦点，z peek。
 * 原型结论（T0-019）：Radix Dialog `modal={false}` + `onOpenAutoFocus` preventDefault 即可满足非 modal 需求，无需自写。
 */
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export function SheetContent({
  className,
  children,
  side = 'right',
  modal = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'right' | 'bottom' | 'left'
  modal?: boolean
}) {
  const { t } = useTranslation()
  const pos =
    side === 'right'
      ? 'inset-y-0 right-0 h-full w-[min(100vw,30rem)] rounded-l-xl data-[state=open]:animate-[xz-slide-left_var(--xz-dur-slow)_var(--xz-ease-out)]'
      : side === 'left'
        ? 'inset-y-0 left-0 h-full w-[min(86vw,var(--xz-sidebar-w))] rounded-r-xl data-[state=open]:animate-[xz-slide-right_var(--xz-dur-slow)_var(--xz-ease-out)]'
        : 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[xz-slide-up_var(--xz-dur-slow)_var(--xz-ease-out)]'
  return (
    <DialogPrimitive.Portal>
      {modal ? <DialogPrimitive.Overlay className="scrim fixed inset-0 z-(--xz-z-scrim)" /> : null}
      <DialogPrimitive.Content
        className={cn(
          'glass-thick fixed overflow-y-auto p-6 text-fg outline-none',
          modal ? 'z-(--xz-z-modal)' : 'z-(--xz-z-peek)',
          pos,
          className,
        )}
        onOpenAutoFocus={modal ? undefined : (e) => e.preventDefault()}
        onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          aria-label={t('ui.action.close')}
        >
          <XIcon className="size-5" strokeWidth={1.75} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const SheetTitle = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn('font-semibold text-lg', className)} {...props} />
)
export const SheetDescription = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn('mt-1 text-fg-muted text-sm', className)} {...props} />
)

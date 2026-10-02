/**
 * Sheet（06 §4）：modal 版 = glass-thick + Scrim；非 modal 版（PeekPanel，04 §6）= 无 Scrim、不锁滚动、不抢焦点，z peek。
 * 原型结论（T0-019）：Radix Dialog `modal={false}` + `onOpenAutoFocus` preventDefault 即可满足非 modal 需求，无需自写。
 */
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { buttonVariants } from './button.tsx'

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
      ? 'inset-y-0 right-0 h-full w-[min(100vw,30rem)] rounded-l-xl data-[state=open]:animate-[xz-slide-left_var(--xz-dur-slow)_var(--xz-ease-out)] data-[state=closed]:animate-[xz-slide-left-out_var(--xz-dur-base)_var(--xz-ease-out)_forwards]'
      : side === 'left'
        ? 'inset-y-0 left-0 h-full w-[min(86vw,var(--xz-sidebar-w))] rounded-r-xl data-[state=open]:animate-[xz-slide-right_var(--xz-dur-slow)_var(--xz-ease-out)] data-[state=closed]:animate-[xz-slide-right-out_var(--xz-dur-base)_var(--xz-ease-out)_forwards]'
        : 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[xz-slide-up_var(--xz-dur-slow)_var(--xz-ease-out)] data-[state=closed]:animate-[xz-slide-down-out_var(--xz-dur-base)_var(--xz-ease-out)_forwards]'
  return (
    <DialogPrimitive.Portal>
      {modal ? (
        <DialogPrimitive.Overlay
          data-xz-exit=""
          className="scrim fixed inset-0 z-(--xz-z-scrim) data-[state=open]:animate-[xz-fade-in_var(--xz-dur-base)_var(--xz-ease-out)] data-[state=closed]:animate-[xz-fade-out_var(--xz-dur-fast)_var(--xz-ease-out)_forwards]"
        />
      ) : null}
      <DialogPrimitive.Content
        data-xz-exit=""
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
          className={cn(buttonVariants({ variant: 'icon' }), 'absolute top-3 right-3')}
          aria-label={t('ui.action.close')}
        >
          <XIcon className="size-5" />
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

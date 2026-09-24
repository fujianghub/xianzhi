/** Dialog（06 §4）：glass-thick + 光标高光 + Scrim（计入 blur 预算）；portal 到 body（REQ-UI-023）；打开时根加 data-dialog-open（Aside 自动折叠、光晕下移）。 */
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ComponentProps, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCursorSheen } from '../../hooks/useCursorSheen.ts'
import { cn } from '../../lib/cn.ts'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

function OpenMarker() {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.dialogOpen = String(Number(root.dataset.dialogOpen ?? '0') + 1)
    return () => {
      const n = Number(root.dataset.dialogOpen ?? '1') - 1
      if (n <= 0) delete root.dataset.dialogOpen
      else root.dataset.dialogOpen = String(n)
    }
  }, [])
  return null
}

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  const { t } = useTranslation()
  const sheen = useCursorSheen<HTMLDivElement>()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="scrim fixed inset-0 z-(--xz-z-scrim) data-[state=open]:animate-[xz-fade-in_var(--xz-dur-base)_var(--xz-ease-out)]" />
      <DialogPrimitive.Content
        ref={sheen}
        className={cn(
          'glass-thick glass-cursor-sheen fixed top-1/2 left-1/2 z-(--xz-z-modal) w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 text-fg outline-none data-[state=open]:animate-[xz-pop-in_var(--xz-dur-slow)_var(--xz-ease-out)]',
          className,
        )}
        {...props}
      >
        <OpenMarker />
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            aria-label={t('ui.action.close')}
          >
            <XIcon className="size-5" strokeWidth={1.75} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('font-semibold text-lg', className)} {...props} />
}
export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-fg-muted text-sm', className)}
      {...props}
    />
  )
}

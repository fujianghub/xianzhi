/** 破坏性操作确认弹层（04 §6）：标题 + 说明 + 取消 / 危险按钮。 */
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog.tsx'

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => Promise<unknown> | unknown
  /** 说明与按钮之间的附加内容（如删除类型时选择转入目标） */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,26rem)]" data-testid="confirm-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mt-2 text-fg-muted text-sm">{description}</DialogDescription>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('ui.action.cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            data-testid="confirm-ok"
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

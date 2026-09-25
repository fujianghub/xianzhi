/**
 * 重复日程的修改 / 删除范围（macOS 语义，REQ-CAL-005）：仅此日程 · 将来所有日程 · 所有日程。
 * `useScopePrompt()` 返回 [弹层元素, ask(action) → Promise<scope | null>]，null = 取消。
 */
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalEditScope } from '../../lib/calendar-queries.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'

type Action = 'save' | 'delete'

export function useScopePrompt() {
  const { t } = useTranslation()
  const [action, setAction] = useState<Action | null>(null)
  const resolver = useRef<((s: CalEditScope | null) => void) | null>(null)
  const ask = useCallback(
    (a: Action) =>
      new Promise<CalEditScope | null>((resolve) => {
        resolver.current = resolve
        setAction(a)
      }),
    [],
  )
  const done = (s: CalEditScope | null) => {
    resolver.current?.(s)
    resolver.current = null
    setAction(null)
  }
  const element = (
    <Dialog open={!!action} onOpenChange={(v) => !v && done(null)}>
      <DialogContent className="w-[min(92vw,26rem)]" data-testid="cal-scope-dialog" hideClose>
        <DialogTitle>
          {action === 'delete' ? t('calendar.scope.deleteTitle') : t('calendar.scope.saveTitle')}
        </DialogTitle>
        <DialogDescription>
          {action === 'delete' ? t('calendar.scope.deleteBody') : t('calendar.scope.saveBody')}
        </DialogDescription>
        <div className="mt-5 flex flex-col gap-2">
          {(['this', 'future', 'all'] as const).map((s) => (
            <Button
              key={s}
              variant={s === 'this' ? 'primary' : action === 'delete' ? 'destructive' : 'secondary'}
              onClick={() => done(s)}
              data-testid={`cal-scope-${s}`}
            >
              {t(`calendar.scope.${s}`)}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => done(null)}>
            {t('ui.action.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
  return [element, ask] as const
}

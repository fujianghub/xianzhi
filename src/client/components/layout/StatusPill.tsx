/**
 * StatusPill + Toast 形变（04 §6、06 §4）：只复用 Sonner 的 toast() 队列（useSonner 读状态），容器自建在 Topbar 内；
 * Toast 与胶囊同一 Motion LayoutGroup，layoutId 共享 → 从胶囊形变生长、完成后缩回。Toast 在 L1 玻璃内，自身不 blur。
 * 原型结论（T0-019）：useSonner 提供完整队列与 dismiss，无需 Toaster；reduced-motion 下 Motion 自动退化为淡入。
 */
import { CircleCheck, CloudOff, Loader2, Lock, TriangleAlert } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast, useSonner } from 'sonner'
import { cn } from '../../lib/cn.ts'
import { useStatus } from '../../lib/stores.ts'
import { XzMotionConfig } from '../ui/motion-config.tsx'

const SPRING = { type: 'spring', stiffness: 260, damping: 26 } as const

/** toast(…, { action: { label, onClick } })：Toast 内渲染为一个文字按钮，点后收起。 */
type ToastAction = { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }
const isAction = (a: unknown): a is ToastAction =>
  !!a && typeof a === 'object' && 'label' in a && 'onClick' in a

export function StatusPill() {
  const { t } = useTranslation()
  const status = useStatus((s) => s.status)
  const { toasts } = useSonner()
  const active = toasts.filter((x) => !x.delete).at(-1)
  useEffect(() => {
    if (!active) return
    const ms = typeof active.duration === 'number' ? active.duration : 4000 // 04 §6：4s 后缩回
    const id = setTimeout(() => toast.dismiss(active.id), ms)
    return () => clearTimeout(id)
  }, [active])
  const icon =
    status === 'offline' ? (
      <CloudOff className="size-4" />
    ) : status === 'connecting' ? (
      <Loader2 className="size-4 animate-spin" />
    ) : status === 'readOnly' ? (
      <Lock className="size-4" />
    ) : (
      <CircleCheck className="size-4 text-success" />
    )
  const isError = active?.type === 'error'
  return (
    <XzMotionConfig>
      <LayoutGroup>
        <div className="relative" data-testid="status-pill-host" aria-live="polite">
          <AnimatePresence initial={false} mode="popLayout">
            {active ? (
              <motion.div
                key={`toast-${active.id}`}
                layoutId="status-pill"
                transition={SPRING}
                className={cn(
                  'glass-thick-flat flex min-h-9 max-w-[min(70vw,28rem)] items-center gap-2 rounded-lg px-3 py-2 text-fg text-sm',
                  // 红条用伪元素：glass-thick-flat 的 border 简写会盖掉 border-l-*（06 §5 错误态）
                  isError &&
                    'relative overflow-hidden pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-danger',
                )}
                role={isError ? 'alert' : 'status'}
                data-testid="toast"
              >
                {isError ? (
                  <TriangleAlert className="size-4 shrink-0 text-danger" />
                ) : (
                  <CircleCheck className="size-4 shrink-0 text-success" />
                )}
                <span className="truncate">{String(active.title ?? '')}</span>
                {isAction(active.action) ? (
                  <button
                    type="button"
                    data-testid="toast-action"
                    className="ms-1 shrink-0 rounded px-1.5 py-0.5 font-medium text-primary-text hover:bg-hover"
                    onClick={(e) => {
                      const a = active.action as ToastAction
                      a.onClick(e)
                      toast.dismiss(active.id)
                    }}
                  >
                    {(active.action as ToastAction).label}
                  </button>
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="pill"
                layoutId="status-pill"
                transition={SPRING}
                className="glass-thick-flat flex h-8 items-center gap-1.5 rounded-full px-3 text-fg-muted text-xs"
                data-testid="status-pill"
                data-status={status}
              >
                {icon}
                <span className="hidden sm:inline">{t(`ui.statusPill.${status}`)}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </XzMotionConfig>
  )
}

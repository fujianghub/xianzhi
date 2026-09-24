/**
 * 展开指示（REQ-UI-030）：圆角实心小三角，表示「下方还有内容」；展开时弹簧转 90°（减弱档时长为 0 即瞬转）。
 * 只表达展开 / 收起；纯方向用 lucide Chevron。
 */
import { cn } from '../../lib/cn.ts'

export function Disclosure({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      data-open={open || undefined}
      className={cn(
        'size-3 shrink-0 text-fg-muted transition-transform duration-(--xz-dur-base) ease-(--xz-ease-spring) data-open:rotate-90',
        className,
      )}
    >
      <path
        fill="currentColor"
        d="M5.6 3.2c-.5-.4-1.3 0-1.3.6v8.4c0 .7.8 1 1.3.6l5.5-4.2c.4-.3.4-.9 0-1.2z"
      />
    </svg>
  )
}

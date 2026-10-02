/** Spinner（ADR-0046）：全站唯一转圈——currentColor 圆环缺一角；尺寸跟随 className（默认 size-4）。减弱档仍转（表示进行中，不属装饰动效）。 */
import { cn } from '../../lib/cn.ts'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      aria-hidden
    />
  )
}

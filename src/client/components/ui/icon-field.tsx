/**
 * 带前置图标的输入框（登录 / 邀请页，简斋式）：48px 高、左图标槽、标签仅供读屏（sr-only，getByLabel 仍可用）；
 * 可选尾部按钮（如密码显隐）。聚焦时图标转主色、外圈 3px 主色柔光。
 */
import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export function IconField({
  id,
  label,
  icon: Icon,
  trailing,
  className,
  ...props
}: ComponentProps<'input'> & {
  id: string
  label: string
  icon: LucideIcon
  trailing?: ReactNode
}) {
  return (
    <div className={cn('group relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-fg-muted transition-colors duration-(--xz-dur-fast) group-focus-within:text-primary-text"
      />
      <input
        id={id}
        placeholder={label}
        className={cn(
          'h-12 w-full rounded-lg border border-border bg-(--xz-glass-thin) pl-11 text-[15px] text-fg outline-none transition-[border-color,box-shadow] duration-(--xz-dur-fast) placeholder:text-fg-muted focus-visible:border-selected-border focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--xz-primary)_22%,transparent)]',
          trailing ? 'pr-11' : 'pr-3.5',
        )}
        {...props}
      />
      {trailing ? (
        <div className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</div>
      ) : null}
    </div>
  )
}

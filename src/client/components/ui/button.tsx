/** Button（06 §5.1）：primary / secondary / ghost / destructive / icon。颜色 dur-fast，位移 dur-base + ease-spring；禁止 transition: all。 */
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'
import { Spinner } from './spinner.tsx'

export const buttonVariants = cva(
  'xz-press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-[background-color,color,box-shadow,transform,opacity] duration-(--xz-dur-fast) ease-(--xz-ease-spring) disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*=size-])]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-(image:--xz-primary-gradient) text-primary-fg shadow-[inset_0_1px_0_var(--xz-sheen)] hover:-translate-y-px hover:shadow-[var(--xz-glow-primary)] active:scale-[.985] active:shadow-none',
        // 06 §5.1 secondary = glass-thick 外观；按钮小且常成排出现，去掉 backdrop blur（同 Toast 做法），否则同屏 blur 超 §8 预算
        // ADR-0046：hover 用 hover-veil 叠一层，不把玻璃底换成 6% 透明色（「掏空」）
        secondary:
          'glass-thick-flat hover-veil text-fg [--xz-mat-drop:0_0_transparent] active:scale-[.985] active:[--xz-veil:var(--xz-active-bg)]',
        ghost: 'bg-transparent text-fg hover:bg-hover active:scale-[.985] active:bg-active',
        destructive:
          'bg-danger-soft text-danger hover:bg-[color-mix(in_srgb,var(--xz-danger)_18%,var(--xz-danger-soft))] active:scale-[.985]',
        // ADR-0046：图标随悬停轻放大（同侧栏导航图标），减弱档静止（app.css）
        icon: 'size-9 bg-transparent p-0 text-fg-muted hover:bg-hover hover:text-fg active:scale-[.92] active:bg-active [&_svg]:transition-transform [&_svg]:duration-(--xz-dur-base) [&_svg]:ease-(--xz-ease-spring) hover:[&_svg]:scale-[1.06]',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-11 px-5 text-base' },
    },
    compoundVariants: [{ variant: 'icon', class: 'h-9 px-0' }],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  // asChild：Slot 只接受单个子元素，不能再并排渲染加载圈（否则整页崩 "Slot failed to slot"，见 debug/2026-09-28-button-aschild-slot）
  if (asChild)
    return (
      <Slot.Root
        className={cn(buttonVariants({ variant, size }), className)}
        aria-busy={loading || undefined}
        data-variant={variant ?? 'secondary'}
        {...props}
      >
        {children}
      </Slot.Root>
    )
  const Comp = 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant ?? 'secondary'}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </Comp>
  )
}

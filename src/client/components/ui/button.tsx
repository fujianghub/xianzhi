/** Button（06 §5.1）：primary / secondary / ghost / destructive / icon。颜色 dur-fast，位移 dur-base + ease-spring；禁止 transition: all。 */
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-[background-color,color,box-shadow,transform,opacity] duration-(--xz-dur-fast) ease-(--xz-ease-spring) disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]',
  {
    variants: {
      variant: {
        primary:
          'bg-(image:--xz-primary-gradient) text-primary-fg shadow-[inset_0_1px_0_color-mix(in_srgb,var(--xz-primary-fg)_25%,transparent)] hover:-translate-y-px hover:shadow-[var(--xz-glow-primary)] active:scale-[.985] active:shadow-none',
        // 06 §5.1 secondary = glass-thick 外观；按钮小且常成排出现，去掉 backdrop blur（同 Toast 做法），否则同屏 blur 超 §8 预算
        secondary: 'glass-thick-flat text-fg shadow-none hover:bg-hover active:bg-active',
        ghost: 'bg-transparent text-fg hover:bg-hover active:bg-active',
        destructive:
          'bg-danger-soft text-danger hover:bg-[color-mix(in_srgb,var(--xz-danger)_18%,var(--xz-danger-soft))]',
        icon: 'size-9 bg-transparent p-0 text-fg-muted hover:bg-hover hover:text-fg active:bg-active',
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
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant ?? 'secondary'}
      {...props}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </Comp>
  )
}

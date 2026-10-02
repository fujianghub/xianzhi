/** Popover（06 §4）：glass-thick，portal 到 body；高度不超过视口可用空间，内容过长时内部滚动（大类等列表会随数据增长）。 */
import { Popover as PopoverPrimitive } from 'radix-ui'
import { type ComponentProps, type Ref, useCallback, useLayoutEffect, useRef } from 'react'
import { cn } from '../../lib/cn.ts'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ref,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  // ADR-0046：退出动画期间内容仍挂着；这时再次打开（同一个 Popover 换锚点、连点触发钮），Radix 不重挂、不再跑 onOpenAutoFocus——在这里补跑一次
  const node = useRef<HTMLDivElement | null>(null)
  const lastState = useRef<string | undefined>(undefined)
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      node.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as { current: HTMLDivElement | null }).current = el
    },
    [ref],
  )
  const onOpenAutoFocus = props.onOpenAutoFocus
  useLayoutEffect(() => {
    const el = node.current
    const state = el?.dataset.state
    if (el && lastState.current === 'closed' && state === 'open') {
      const e = new Event('focusScope.autoFocusOnMount', { cancelable: true })
      onOpenAutoFocus?.(e)
      if (!e.defaultPrevented)
        (
          el.querySelector<HTMLElement>(
            'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
          ) ?? el
        ).focus()
    }
    lastState.current = state
  })
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        data-xz-exit=""
        ref={setRef as Ref<HTMLDivElement>}
        className={cn(
          'glass-thick z-(--xz-z-dropdown) max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto origin-(--radix-popover-content-transform-origin) rounded-lg p-4 text-fg outline-none data-[state=open]:animate-[xz-pop-in_var(--xz-dur-base)_var(--xz-ease-out)] data-[state=closed]:animate-[xz-pop-out_var(--xz-dur-fast)_var(--xz-ease-out)_forwards]',
          className,
        )}
        {...props}
        onCloseAutoFocus={(e) => {
          props.onCloseAutoFocus?.(e)
          if (e.defaultPrevented) return
          // ADR-0046：退出动画让卸载晚 dur-fast；这期间焦点若已被菜单项移到别处（行内改名输入框、新开的弹层），不再抢回触发钮
          const a = document.activeElement
          if (a && a !== document.body && !a.closest('[data-radix-popper-content-wrapper]'))
            e.preventDefault()
        }}
      />
    </PopoverPrimitive.Portal>
  )
}

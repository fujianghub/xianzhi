/** Avatar（06 §4）：full 圆角 + 1px border 环；无图时取首字母，底色按 userId 哈希 8 色板。 */
import { Avatar as AvatarPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn.ts'

const PALETTE = ['moss', 'amber', 'indigo', 'ochre', 'teal', 'plum', 'gray', 'pine'] as const
export function paletteOf(id: string): (typeof PALETTE)[number] {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as (typeof PALETTE)[number]
}
const BG: Record<(typeof PALETTE)[number], string> = {
  moss: 'bg-moss-bg text-moss-fg',
  amber: 'bg-amber-bg text-amber-fg',
  indigo: 'bg-indigo-bg text-indigo-fg',
  ochre: 'bg-ochre-bg text-ochre-fg',
  teal: 'bg-teal-bg text-teal-fg',
  plum: 'bg-plum-bg text-plum-fg',
  gray: 'bg-gray-bg text-gray-fg',
  pine: 'bg-pine-bg text-pine-fg',
}

export function Avatar({
  id,
  name,
  src,
  size = 32,
  className,
}: {
  id: string
  name: string
  src?: string | null
  size?: number
  className?: string
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn(
          'flex size-full items-center justify-center font-medium text-xs',
          BG[paletteOf(id)],
        )}
      >
        {name.slice(0, 1).toUpperCase()}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

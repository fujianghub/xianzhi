/** Avatar（06 §4）：full 圆角 + 1px border 环；有头像显示图片，否则取首字母，底色按 userId 哈希色板（ADR-0010）。 */
import { useQuery } from '@tanstack/react-query'
import { Avatar as AvatarPrimitive } from 'radix-ui'
import { PALETTE_COLORS, type PaletteColor } from '../../../shared/schemas/enums.ts'
import { membersQuery } from '../../hooks/useMembers.ts'
import { cn } from '../../lib/cn.ts'
import { PALETTE_CLASS } from '../domain/SpaceIcon.tsx'

export function paletteOf(id: string): PaletteColor {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE_COLORS[h % PALETTE_COLORS.length] as PaletteColor
}
const BG = PALETTE_CLASS

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
  // 未显式给 src（任务指派人、评论作者等序列化里没有头像）→ 从成员列表缓存按 id 取（REQ-WS-023）
  const { data: members } = useQuery({ ...membersQuery, enabled: src === undefined })
  const url = src === undefined ? members?.find((m) => m.userId === id)?.image : src
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url ? (
        <AvatarPrimitive.Image src={url} alt={name} className="size-full object-cover" />
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

/**
 * 跨空间列表里的空间标注（今日 / 记录 / 搜索）：空间色圆点 + 空间名；空间列表未加载或不可见时回退 slug。
 * 读 spacesQuery 缓存（侧栏已拉取），不额外发请求。
 */
import { useQuery } from '@tanstack/react-query'
import { cn } from '../../lib/cn.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { PALETTE_DOT, type PaletteName } from './SpaceIcon.tsx'

export function SpaceTag({ slug, className }: { slug: string; className?: string }) {
  const { data } = useQuery(spacesQuery())
  const space = data?.find((s) => s.slug === slug)
  const tone: PaletteName =
    space?.color && space.color in PALETTE_DOT ? (space.color as PaletteName) : 'gray'
  const label = space?.name ?? slug
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-fg-muted text-xs', className)}
      title={label}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', PALETTE_DOT[tone])} aria-hidden />
      <span className="max-w-32 truncate">{label}</span>
    </span>
  )
}

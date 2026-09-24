/**
 * 燕印（ADR-0005 §2、REQ-UI-024）：翡翠渐变方印 + 深墨衔枝燕剪影。尺寸 28 / 42 / 56；
 * 宿主 hover 时印章轻转（`.xz-seal-host:hover`，减弱档静止）。favicon 用同一路径（public/favicon.svg）。
 */
import { cn } from '../../lib/cn.ts'

export const SWALLOW_PATH =
  'M26.6 10.6 24.2 9.4c-1.6-.7-3.3-.1-4.4 1.2C16.9 7.9 13.2 5.2 8.2 3.6c2.9 3 5.1 6 6.7 9.3-1.5 1.4-3.3 2.5-5.3 3.2L1.2 13.9l7.2 4.1-5.6 5.9c5.5-1.6 10.4-2.8 14.2-4.3 3-1.1 5.4-3.5 6.7-6.5z'

export function Swallow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <g transform="translate(.4 3)">
        <path fill="currentColor" d={SWALLOW_PATH} />
        <path
          d="M24.6 12.4 29.6 15.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path fill="currentColor" d="M27.2 14c.5-1.5 1.7-2.3 3-2.2-.4 1.4-1.6 2.3-3 2.2z" />
      </g>
    </svg>
  )
}

const SIZE = { sm: 'xz-seal-sm', md: 'xz-seal-md', lg: 'xz-seal-lg' } as const

export function Seal({ size = 'sm', className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span className={cn('xz-seal', SIZE[size], className)} aria-hidden>
      <Swallow className="xz-seal-mark" />
    </span>
  )
}

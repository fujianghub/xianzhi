/**
 * 燕印（ADR-0007，取代 ADR-0005 §2 的配色、REQ-UI-024）：翡翠深渐变方印 + 右上晨光 + 暖白春燕衔嫩芽枝。
 * 尺寸 28 / 42 / 56；md / lg 为完整版（三片嫩叶），sm 与 favicon 为小尺寸简化版（一片大叶，public/favicon.svg 同形）。
 * 颜色只取 `--xz-seal-*`（两主题同值）；宿主 hover 时印章轻转（`.xz-seal-host:hover`，减弱档静止）。
 */
import { cn } from '../../lib/cn.ts'

/** 燕身（剪刀尾）+ 上翼 + 下翼，64 × 64 坐标；外层 `translate(.5 7) scale(.9)` 居中。 */
export const SWALLOW_PATHS = [
  'M51 20.5 47.5 19C45 17.5 41.5 18.5 40.5 21.5 36 25 30 30 25 33.5L7 36.5 20 38.2 10 47 27 38.5C33 37 40 32 45 26 47 24 49 22 51 20.5Z',
  'M42 22.5C37 14 29 8 14 5.5 23.5 10.5 29 17 30.5 28Z',
  'M39.5 27C39 35.5 35 43 27 50.5 34 43.5 34 36 31 31Z',
] as const
const LEAF = 'M0 0C1.6-2.4 4.8-2.6 6.6 0 4.8 2.6 1.6 2.4 0 0Z'

export function Swallow({ simple = false, className }: { simple?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g transform="translate(.5 7) scale(.9)">
        <g className="xz-seal-bird">
          {SWALLOW_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {simple ? (
          <>
            <path
              className="xz-seal-twig"
              d="M48 21.5C52 22.5 55 24 58 26.5"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              className="xz-seal-leaf"
              d={LEAF}
              transform="translate(52 23) rotate(-55) scale(1.9)"
            />
          </>
        ) : (
          <>
            <path
              className="xz-seal-twig"
              d="M48.3 21.4C52 22.4 56 24 60.5 27.6"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              className="xz-seal-leaf"
              d={LEAF}
              transform="translate(53 23) rotate(-52) scale(1.25)"
            />
            <path
              className="xz-seal-leaf-2"
              d={LEAF}
              transform="translate(56.6 25.4) rotate(38) scale(1.15)"
            />
            <path
              className="xz-seal-leaf"
              d={LEAF}
              transform="translate(60.3 27.4) rotate(-10) scale(.7)"
            />
          </>
        )}
      </g>
    </svg>
  )
}

const SIZE = { sm: 'xz-seal-sm', md: 'xz-seal-md', lg: 'xz-seal-lg' } as const

export function Seal({ size = 'sm', className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span className={cn('xz-seal', SIZE[size], className)} aria-hidden>
      <Swallow simple={size === 'sm'} className="xz-seal-mark" />
    </span>
  )
}

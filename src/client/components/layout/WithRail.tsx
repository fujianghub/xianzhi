/**
 * 「主列 + 右侧速览栏」页面骨架（REQ-UI-034）：≥ xl 两栏（主列自适应 + 20rem 速览栏吸顶），以下单栏。
 * 主列最宽 96rem 居中，列表行随宽度伸展；速览栏只在宽屏出现，窄屏不增加滚动长度。
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { GlanceRail } from './GlanceRail.tsx'

export function WithRail({
  tz,
  weekStartsOn,
  children,
  className,
  testId,
}: {
  tz: string
  weekStartsOn: number
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div
      className={cn(
        'mx-auto grid w-full max-w-[96rem] gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]',
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0">{children}</div>
      <div className="hidden xl:block">
        <div className="sticky top-4">
          <GlanceRail tz={tz} weekStartsOn={weekStartsOn} />
        </div>
      </div>
    </div>
  )
}

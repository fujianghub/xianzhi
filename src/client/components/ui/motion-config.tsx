/** Motion 统一配置（04 §2.4、REQ-UI-028）：用户选「减弱」时强制关闭 Motion 动画，否则跟随系统 reduced-motion。 */
import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { useLayout } from '../../lib/stores.ts'

export function XzMotionConfig({ children }: { children: ReactNode }) {
  const motion = useLayout((s) => s.motion)
  return (
    <MotionConfig reducedMotion={motion === 'reduce' ? 'always' : 'user'}>{children}</MotionConfig>
  )
}

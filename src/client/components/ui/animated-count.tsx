/** 滚动数字（08 §2.6 列头计数，NumberFlow 式）：数值变化时新数字从下方滑入；reduced-motion 下直接替换。 */
import { AnimatePresence, MotionConfig, motion } from 'motion/react'

export function AnimatedCount({ value, className }: { value: number; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <span
        className={`relative inline-flex overflow-hidden tabular-nums ${className ?? ''}`}
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: '60%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-60%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
    </MotionConfig>
  )
}

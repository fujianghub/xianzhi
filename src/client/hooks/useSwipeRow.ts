/**
 * 行手势（04 §6、REQ-MOBILE-002）：仅触摸指针。左滑超过行宽 40% → onLeft（完成）；右滑超过 40% → onRight（改期）；
 * 按住 500ms 不动 → onLong（多选）。纵向移动优先交给页面滚动（touch-action: pan-y）。
 */
import { type PointerEvent, useEffect, useRef, useState } from 'react'

export const SWIPE_RATIO = 0.4
const LONG_MS = 500

export function useSwipeRow(opts: {
  onLeft?: () => void
  onRight?: () => void
  onLong?: () => void
}) {
  const [dx, setDx] = useState(0)
  const dxRef = useRef(0)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const start = useRef<{ x: number; y: number; w: number; moved: boolean } | null>(null)
  const longTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(longTimer.current), [])

  const set = (v: number) => {
    dxRef.current = v
    setDx(v)
  }
  const reset = () => {
    clearTimeout(longTimer.current)
    start.current = null
    set(0)
  }
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return
    start.current = {
      x: e.clientX,
      y: e.clientY,
      w: e.currentTarget.getBoundingClientRect().width,
      moved: false,
    }
    clearTimeout(longTimer.current)
    longTimer.current = setTimeout(() => {
      if (start.current && !start.current.moved) {
        optsRef.current.onLong?.()
        reset()
      }
    }, LONG_MS)
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = start.current
    if (!s || e.pointerType !== 'touch') return
    const x = e.clientX - s.x
    const y = e.clientY - s.y
    if (!s.moved) {
      if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) return reset() // 纵向滚动
      if (Math.abs(x) > 8) {
        s.moved = true
        clearTimeout(longTimer.current)
      }
    }
    if (s.moved) set(x)
  }
  const onPointerUp = () => {
    const s = start.current
    const ratio = s ? dxRef.current / s.w : 0
    const moved = !!s?.moved
    reset()
    if (!moved) return
    if (ratio <= -SWIPE_RATIO) optsRef.current.onLeft?.()
    else if (ratio >= SWIPE_RATIO) optsRef.current.onRight?.()
  }
  return {
    dx,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset },
  }
}

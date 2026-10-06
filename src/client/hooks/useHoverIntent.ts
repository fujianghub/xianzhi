/**
 * 悬停意图（04 §6 Peek；ADR-0050 改为「停留」意图）：指针在元素上**静止** `ms` 才触发，移动即重新计时、移开取消——
 * 鼠标只是扫过列表、或在行上移动去点按钮时不弹。返回可直接展开到元素上的事件处理。
 * `ms` 可给函数：每次重新计时时取值（例如 Peek 已打开时换行预览用更短的停留）。
 * 触发过一次或按下过鼠标后，直到移开前不再计时（关掉 Peek 后在原地动一动不会又弹出来；点按钮 / 改名时不弹）。
 */
import { useEffect, useRef } from 'react'

export const PEEK_HOVER_MS = 1000
/** Peek 已打开时，换到另一行的停留时间 */
export const PEEK_SWITCH_MS = 350
/** 小于该位移（px）的抖动不算移动 */
const JITTER = 4

export function useHoverIntent(fire: () => void, ms: number | (() => number) = PEEK_HOVER_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const at = useRef<{ x: number; y: number } | null>(null)
  const quiet = useRef(false)
  const fireRef = useRef(fire)
  fireRef.current = fire
  const msRef = useRef(ms)
  msRef.current = ms
  useEffect(() => () => clearTimeout(timer.current), [])
  const arm = (x: number, y: number) => {
    at.current = { x, y }
    if (quiet.current) return
    clearTimeout(timer.current)
    const wait = typeof msRef.current === 'function' ? msRef.current() : msRef.current
    timer.current = setTimeout(() => {
      quiet.current = true
      fireRef.current()
    }, wait)
  }
  return {
    onMouseEnter: (e: { clientX: number; clientY: number }) => arm(e.clientX, e.clientY),
    onMouseMove: (e: { clientX: number; clientY: number }) => {
      const p = at.current
      if (p && Math.abs(e.clientX - p.x) < JITTER && Math.abs(e.clientY - p.y) < JITTER) return
      arm(e.clientX, e.clientY)
    },
    onMouseDown: () => {
      quiet.current = true
      clearTimeout(timer.current)
    },
    onMouseLeave: () => {
      at.current = null
      quiet.current = false
      clearTimeout(timer.current)
    },
  }
}

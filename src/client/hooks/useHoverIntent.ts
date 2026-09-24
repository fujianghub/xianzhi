/** 悬停意图（04 §6 Peek：悬停 600ms 触发，移开取消）。返回可直接展开到元素上的事件处理。 */
import { useEffect, useRef } from 'react'

export const PEEK_HOVER_MS = 600

export function useHoverIntent(fire: () => void, ms = PEEK_HOVER_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fireRef = useRef(fire)
  fireRef.current = fire
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    onMouseEnter: () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => fireRef.current(), ms)
    },
    onMouseLeave: () => clearTimeout(timer.current),
  }
}

/** 光标跟随高光（06 §3.2，仅 ⌘K 与 Dialog）：pointermove → rAF 节流写 --mx/--my，不触发布局；reduced-motion 下关闭。 */
import { useCallback, useRef } from 'react'
import { reducedMotion } from '../lib/theme.ts'

export function useCursorSheen<T extends HTMLElement>() {
  const frame = useRef(0)
  return useCallback((el: T | null) => {
    if (!el || reducedMotion()) return
    const onMove = (e: PointerEvent) => {
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${e.clientX - r.left}px`)
        el.style.setProperty('--my', `${e.clientY - r.top}px`)
      })
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [])
}

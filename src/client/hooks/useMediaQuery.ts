/** 媒体查询是否命中（随窗口变化更新）；SSR / 无 matchMedia 时为 false。 */
import { useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
    () => false,
  )
}

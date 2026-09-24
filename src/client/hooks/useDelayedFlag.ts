/** 骨架屏规则（04 §6、REQ-UI-010）：请求超过 400ms 才显示骨架，避免快请求闪一下。 */
import { useEffect, useState } from 'react'

export const SKELETON_DELAY_MS = 400

export function useDelayedFlag(active: boolean, ms = SKELETON_DELAY_MS): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) {
      setOn(false)
      return
    }
    const id = setTimeout(() => setOn(true), ms)
    return () => clearTimeout(id)
  }, [active, ms])
  return on
}

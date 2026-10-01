/**
 * 「刚变空先别卸载」（ADR-0045）：列表 / 分组里最后一条被完成或移走后，再保留 ms 毫秒，
 * 让任务列表的淡出折叠与行内「撤销」条走完（否则一空就卸载，撤销状态随组件一起丢掉）。
 * 渲染时同步判断「刚才还有、现在空了」——若只靠 effect 置位，空的那一帧已经把列表卸载了。
 */
import { useEffect, useRef, useState } from 'react'

export function useLinger(count: number, ms = 8_500): boolean {
  const [linger, setLinger] = useState(false)
  const had = useRef(count > 0)
  useEffect(() => {
    if (count) {
      had.current = true
      setLinger(false)
      return
    }
    if (!had.current) return
    had.current = false
    setLinger(true)
    const id = setTimeout(() => setLinger(false), ms)
    return () => clearTimeout(id)
  }, [count, ms])
  return linger || (had.current && count === 0)
}

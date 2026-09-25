/**
 * 按住拖选日期范围（REQ-CAL-010）：月格 / 全天行里鼠标按下空白处，拖过的日期高亮，松开即以 [起, 止] 新建全天日程。
 * 只认鼠标 / 笔（触屏拖动留给滚动，单击仍走 onClick 新建单日）；按在按钮（日程条、日期号）上不起选；Esc 取消。
 * 格子须带 `data-range-key="YYYY-MM-DD"`；拖过多日后吞掉随后那一次 click，避免再建单日。
 */
import { useEffect, useRef, useState } from 'react'

interface Sel {
  a: string
  b: string
}

export function useRangeSelect(onRange: (from: string, to: string) => void) {
  const [sel, setSel] = useState<Sel | null>(null)
  const selRef = useRef<Sel | null>(null)
  selRef.current = sel
  const cb = useRef(onRange)
  cb.current = onRange
  const swallow = useRef(false)
  const active = sel !== null

  useEffect(() => {
    if (!active) return
    const move = (e: PointerEvent) => {
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>('[data-range-key]')
      const k = el?.dataset.rangeKey
      if (k) setSel((s) => (s && s.b !== k ? { ...s, b: k } : s))
    }
    const up = () => {
      const s = selRef.current
      setSel(null)
      if (!s || s.a === s.b) return
      swallow.current = true
      setTimeout(() => {
        swallow.current = false
      }, 0)
      const [from, to] = s.a < s.b ? [s.a, s.b] : [s.b, s.a]
      cb.current(from, to)
    }
    const cancel = () => setSel(null)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [active])

  const lo = sel ? (sel.a < sel.b ? sel.a : sel.b) : ''
  const hi = sel ? (sel.a < sel.b ? sel.b : sel.a) : ''
  return {
    /** 格子 onPointerDown。 */
    start(e: React.PointerEvent, key: string) {
      if (e.button !== 0 || e.pointerType === 'touch') return
      if ((e.target as HTMLElement).closest('button, a, input')) return
      e.preventDefault() // 防止拖出文字选区
      setSel({ a: key, b: key })
    },
    /** 拖选中且覆盖该日。 */
    covers: (key: string) => active && key >= lo && key <= hi,
    active,
    /** 格子 onClick 先问：刚拖完多日则吞掉这次 click。 */
    consumeClick: () => swallow.current,
  }
}

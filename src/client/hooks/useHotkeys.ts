/**
 * 全局快捷键（04 §6、REQ-UI-006）：单键（`c`、`?`）、组合键（`mod+k`）与序列（`g t`，前缀 1s 内有效）。
 * 输入框 / 编辑器聚焦时只响应 mod 组合；已被下层（ProseMirror 等）处理（defaultPrevented）的按键不再响应，
 * 例如编辑器里的 Mod+K 是链接而不是命令面板。
 */
import { useEffect } from 'react'

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    !!el.closest('[contenteditable="true"]'))

/** 序列前缀：出现在任意 `x y` 键里的首键。 */
const prefixes = (map: Record<string, unknown>) =>
  new Set(
    Object.keys(map)
      .filter((k) => k.includes(' '))
      .map((k) => k.split(' ')[0]),
  )

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>): void {
  useEffect(() => {
    const pre = prefixes(map)
    let pending: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
      const combo = `${mod ? 'mod+' : ''}${e.key === '?' ? '?' : key}`
      if (!mod && editable(e.target)) return
      if (pending && !mod) {
        const seq = `${pending} ${combo}`
        pending = null
        clearTimeout(timer)
        const fn = map[seq]
        if (fn) {
          e.preventDefault()
          fn(e)
          return
        }
      }
      if (!mod && !e.altKey && pre.has(combo)) {
        pending = combo
        clearTimeout(timer)
        timer = setTimeout(() => {
          pending = null
        }, 1000)
        return
      }
      const fn = map[combo]
      if (!fn) return
      e.preventDefault()
      fn(e)
    }
    window.addEventListener('keydown', on)
    return () => {
      window.removeEventListener('keydown', on)
      clearTimeout(timer)
    }
  }, [map])
}

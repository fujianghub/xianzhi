/**
 * 右键菜单锚点（ADR-0035、REQ-KB-011 · 013）：⋯ 菜单也可在行上右键打开，弹层锚到指针位置。
 * 用法：行 `onContextMenu={ctx.open}`，菜单 Popover 内放 `<ContextAnchor point={ctx.point} />`，关闭时 `ctx.clear()`。
 * 不引 ContextMenu 依赖：复用同一个 Popover，只是把锚点换成指针处的 0×0 定位元素。
 */
import { type MouseEvent, useCallback, useState } from 'react'
import { PopoverAnchor } from './popover.tsx'

export interface Point {
  x: number
  y: number
}

export function useContextPoint() {
  const [point, setPoint] = useState<Point | null>(null)
  const open = useCallback((e: MouseEvent) => {
    // 输入框里保留浏览器原生菜单（复制 / 粘贴）
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
    setPoint({ x: e.clientX, y: e.clientY })
  }, [])
  const clear = useCallback(() => setPoint(null), [])
  return { point, open, clear }
}

export function ContextAnchor({ point }: { point: Point | null }) {
  if (!point) return null
  return (
    <PopoverAnchor asChild>
      <span
        aria-hidden
        className="pointer-events-none fixed size-0"
        style={{ left: point.x, top: point.y }}
      />
    </PopoverAnchor>
  )
}

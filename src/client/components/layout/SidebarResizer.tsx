/**
 * 侧栏右缘拖动条（ADR-0058、REQ-UI-054）：拖动调宽（200 ~ 400px），双击还原 240；
 * 键盘：聚焦后 ← / → 每次 16px（Shift 48px），Home / End 到最窄 / 最宽。
 * 拖动中逐帧改 html 上的 `--xz-sidebar-w`（rAF 合帧），松手才写本机存储；`html[data-xz-resizing]` 关掉文本选择。
 */
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  applySidebarWidth,
  clampSidebarWidth,
  currentSidebarWidth,
  SIDEBAR_W,
  saveSidebarWidth,
  storedSidebarWidth,
} from '../../lib/sidebar-width.ts'

export function SidebarResizer({ controls }: { controls: string }) {
  const { t } = useTranslation()
  const [width, setWidth] = useState(currentSidebarWidth)
  const drag = useRef<{ x: number; w: number; next: number; raf: number } | null>(null)

  const end = (commit: boolean) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    cancelAnimationFrame(d.raf)
    delete document.documentElement.dataset.xzResizing
    if (commit && d.next !== d.w) {
      saveSidebarWidth(d.next)
      setWidth(d.next)
    } else applySidebarWidth(storedSidebarWidth()) // 取消（pointercancel）：回到已存的宽度
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const w = currentSidebarWidth()
    drag.current = { x: e.clientX, w, next: w, raf: 0 }
    document.documentElement.dataset.xzResizing = ''
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.next = clampSidebarWidth(d.w + e.clientX - d.x)
    cancelAnimationFrame(d.raf)
    d.raf = requestAnimationFrame(() => applySidebarWidth(d.next))
  }
  const set = (px: number | null) => {
    saveSidebarWidth(px)
    setWidth(px === null ? SIDEBAR_W.def : clampSidebarWidth(px))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? SIDEBAR_W.step * 3 : SIDEBAR_W.step
    const next =
      e.key === 'ArrowLeft'
        ? width - step
        : e.key === 'ArrowRight'
          ? width + step
          : e.key === 'Home'
            ? SIDEBAR_W.min
            : e.key === 'End'
              ? SIDEBAR_W.max
              : null
    if (next === null) return
    e.preventDefault()
    set(next)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: 可聚焦的分隔条（APG window splitter）没有对应的原生元素；<hr> 不能聚焦与拖动
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('ui.nav.resizeSidebar')}
      aria-controls={controls}
      aria-valuemin={SIDEBAR_W.min}
      aria-valuemax={SIDEBAR_W.max}
      aria-valuenow={width}
      tabIndex={0}
      title={t('ui.nav.resizeSidebarHint')}
      className="xz-resizer"
      data-testid="sidebar-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(true)}
      onDoubleClick={() => set(null)}
      onKeyDown={onKeyDown}
    />
  )
}
